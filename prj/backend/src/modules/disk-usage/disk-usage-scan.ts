import type { Dirent, Stats } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DISK_USAGE_LIMITS,
  DISK_USAGE_MAX_DEPTH,
  type DiskUsageFolderState,
  type DiskUsageNodeDto,
  type DiskUsageScanState,
  type DiskUsageTotalsDto,
} from './disk-usage.model.js';

/** `stat.blocks` is in 512-byte units whatever the file system's block size. */
const BLOCK_SIZE = 512;

/** A file kept by name: one of a folder's largest. */
interface FileItem {
  readonly name: string;
  readonly size: number;
  readonly onDisk: number;
}

/**
 * A folder of the tree. Its sizes and counts are of everything beneath it,
 * kept up to date as files are found — added up the chain of parents — so a
 * report of any folder is read off, never summed.
 */
class FolderNode {
  readonly folders = new Map<string, FolderNode>();
  /** The largest files directly in it, by name; see `addFile`. */
  files: FileItem[] = [];
  /** Files directly in it not kept by name, summed. */
  readonly smaller = { count: 0, size: 0, onDisk: 0 };
  size = 0;
  onDisk = 0;
  fileCount = 0;
  folderCount = 0;
  /** Folders at or beneath it still to be read; `0` is all of it in. */
  pending = 0;
  state: Exclude<DiskUsageFolderState, 'scanning' | 'done'> | null = null;

  constructor(
    readonly name: string,
    readonly parent: FolderNode | null,
    readonly depth: number,
  ) {}

  *chain(): Generator<FolderNode> {
    for (let node: FolderNode | null = this; node !== null; node = node.parent) {
      yield node;
    }
  }
}

/**
 * One disk usage scan (PRD 013, §1): the folder `absolute`, gone through to
 * `DISK_USAGE_MAX_DEPTH` levels below it, a few folders read at once.
 *
 * Links are counted as themselves, never followed, and another file system
 * met on the way — a mount, `/proc` — is not gone into: it is its own disk,
 * scanned by starting on it (as `du -x`). A file with several hard links is
 * counted once.
 */
export class DiskUsageScan {
  readonly startedAt = new Date();
  finishedAt: Date | null = null;
  state: DiskUsageScanState = 'running';
  error: string | undefined;
  /** When a client last asked about it. */
  lastAsked = Date.now();
  /** The folder being read, root-relative, while running. */
  current: string | null = null;

  private readonly root: FolderNode;
  private readonly queue: { readonly node: FolderNode; readonly absolute: string }[] = [];
  private readonly seenLinks = new Set<string>();
  private errors = 0;
  private skipped = 0;
  private device: number | undefined;
  private cancelled = false;
  /** Workers with nothing to take, woken when a folder is queued or one is done. */
  private idle: (() => void)[] = [];
  /** Resolves when the scan has stopped, however it stopped. */
  readonly finished: Promise<void>;

  constructor(
    readonly id: string,
    /** The folder scanned, root-relative. */
    readonly path: string,
    private readonly absolute: string,
    /** Names in the folder scanned that are never gone into — the server's trash, at the root. */
    private readonly skip: ReadonlySet<string> = new Set(),
  ) {
    this.root = new FolderNode(path.slice(path.lastIndexOf('/') + 1), null, 0);
    this.enqueue(this.root, absolute);
    this.finished = this.run();
  }

  cancel(): void {
    if (this.state === 'running') {
      this.cancelled = true;
      this.wake();
    }
  }

  get totals(): DiskUsageTotalsDto {
    const root = this.root;
    return {
      size: root.size,
      onDisk: root.onDisk,
      files: root.fileCount,
      folders: root.folderCount,
      errors: this.errors,
      skipped: this.skipped,
    };
  }

  /**
   * The tree under `path` — root-relative, the folder scanned or one inside
   * it — `depth` levels deep: `undefined` when `path` is not in the scan at
   * all, `null` when it is but has not been reached yet.
   */
  report(path: string, depth: number): DiskUsageNodeDto | null | undefined {
    const rest = path === this.path ? '' : this.path === '' ? path : path.startsWith(`${this.path}/`) ? path.slice(this.path.length + 1) : null;
    if (rest === null) {
      return undefined;
    }
    let node: FolderNode | undefined = this.root;
    for (const segment of rest === '' ? [] : rest.split('/')) {
      node = node.folders.get(segment);
      if (node === undefined) {
        return null;
      }
    }
    return this.describe(node, path, depth);
  }

  /* -- reading ------------------------------------------------------------ */

  private async run(): Promise<void> {
    try {
      const rootStats = await lstat(this.absolute);
      this.device = rootStats.dev;
      await Promise.all(Array.from({ length: DISK_USAGE_LIMITS.concurrency }, () => this.worker()));
      this.state = this.cancelled ? 'cancelled' : 'done';
    } catch (error) {
      this.state = 'failed';
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.finishedAt = new Date();
      this.current = null;
      this.queue.length = 0;
    }
  }

  /**
   * Takes folders off the queue, deepest first, until there are none left
   * and none being read could add more. Taking the last one queued walks the
   * tree depth first, which keeps the queue short.
   */
  private async worker(): Promise<void> {
    for (;;) {
      if (this.cancelled) {
        return;
      }
      const next = this.queue.pop();
      if (next === undefined) {
        if (this.root.pending === 0) {
          return;
        }
        // Another worker is reading a folder that may queue more.
        await new Promise<void>((resolve) => this.idle.push(resolve));
        continue;
      }
      await this.read(next.node, next.absolute);
    }
  }

  private enqueue(node: FolderNode, absolute: string): void {
    for (const above of node.chain()) {
      above.pending += 1;
    }
    this.queue.push({ node, absolute });
    this.wake();
  }

  private wake(): void {
    const idle = this.idle;
    this.idle = [];
    for (const resume of idle) {
      resume();
    }
  }

  private async read(node: FolderNode, absolute: string): Promise<void> {
    this.current = this.pathOf(node);
    try {
      let entries: Dirent[];
      try {
        entries = await readdir(absolute, { withFileTypes: true });
      } catch {
        node.state = 'unreadable';
        this.errors += 1;
        return;
      }
      for (let start = 0; start < entries.length && !this.cancelled; start += DISK_USAGE_LIMITS.statBatch) {
        const batch = entries.slice(start, start + DISK_USAGE_LIMITS.statBatch);
        const stats = await Promise.all(batch.map((entry) => lstat(join(absolute, entry.name)).catch(() => null)));
        batch.forEach((entry, index) => this.add(node, absolute, entry, stats[index] ?? null));
      }
      DiskUsageScan.trimFiles(node, true);
    } finally {
      for (const above of node.chain()) {
        above.pending -= 1;
      }
      this.wake();
    }
  }

  private add(parent: FolderNode, parentAbsolute: string, entry: Dirent, stats: Stats | null): void {
    if (stats?.isDirectory() ?? entry.isDirectory()) {
      if (parent === this.root && this.skip.has(entry.name)) {
        return;
      }
      const child = new FolderNode(entry.name, parent, parent.depth + 1);
      parent.folders.set(entry.name, child);
      for (const above of parent.chain()) {
        above.folderCount += 1;
      }
      if (stats === null) {
        child.state = 'unreadable';
        this.errors += 1;
      } else if (this.device !== undefined && stats.dev !== this.device) {
        child.state = 'mount';
        this.skipped += 1;
      } else if (child.depth > DISK_USAGE_MAX_DEPTH) {
        child.state = 'too-deep';
        this.skipped += 1;
      } else {
        this.enqueue(child, join(parentAbsolute, entry.name));
      }
      return;
    }
    if (stats === null) {
      return; // Gone between the listing and the look at it.
    }
    let size = stats.size;
    let onDisk = Number.isFinite(stats.blocks) && stats.blocks > 0 ? stats.blocks * BLOCK_SIZE : stats.size;
    // A file with several names takes its room once.
    if (stats.nlink > 1 && stats.isFile()) {
      const key = `${stats.dev}:${stats.ino}`;
      if (this.seenLinks.has(key)) {
        size = 0;
        onDisk = 0;
      } else {
        this.seenLinks.add(key);
      }
    }
    parent.files.push({ name: entry.name, size, onDisk });
    DiskUsageScan.trimFiles(parent, false);
    for (const above of parent.chain()) {
      above.size += size;
      above.onDisk += onDisk;
      above.fileCount += 1;
    }
  }

  /**
   * Keeps a folder's largest files by name and sums the rest — at twice the
   * limit while it is being read, so the sort is not made for every file, and
   * to the limit once it is.
   */
  private static trimFiles(node: FolderNode, final: boolean): void {
    const limit = DISK_USAGE_LIMITS.filesPerFolder;
    if (node.files.length <= (final ? limit : limit * 2)) {
      return;
    }
    node.files.sort((a, b) => b.size - a.size);
    for (const dropped of node.files.slice(limit)) {
      node.smaller.count += 1;
      node.smaller.size += dropped.size;
      node.smaller.onDisk += dropped.onDisk;
    }
    node.files = node.files.slice(0, limit);
  }

  /* -- reporting ---------------------------------------------------------- */

  private pathOf(node: FolderNode): string {
    const names: string[] = [];
    for (let at: FolderNode | null = node; at !== null && at !== this.root; at = at.parent) {
      names.push(at.name);
    }
    names.reverse();
    return [this.path, ...names].filter((segment) => segment !== '').join('/');
  }

  private stateOf(node: FolderNode): DiskUsageFolderState {
    if (node.state !== null) {
      return node.state;
    }
    // A scan stopped short leaves its unread folders as they are: not all in.
    return node.pending === 0 && this.state !== 'cancelled' && this.state !== 'failed' ? 'done' : 'scanning';
  }

  private describe(node: FolderNode, path: string, depth: number): DiskUsageNodeDto {
    const own: DiskUsageNodeDto = {
      kind: 'folder',
      name: node.name,
      path,
      size: node.size,
      onDisk: node.onDisk,
      files: node.fileCount,
      folders: node.folderCount,
      state: this.stateOf(node),
    };
    if (depth <= 0) {
      return own;
    }
    const join = (name: string): string => (path === '' ? name : `${path}/${name}`);
    const entries: DiskUsageNodeDto[] = [
      ...[...node.folders.values()].map((child) => this.describe(child, join(child.name), depth - 1)),
      ...node.files.map(
        (file): DiskUsageNodeDto => ({ kind: 'file', name: file.name, path: join(file.name), size: file.size, onDisk: file.onDisk, files: 1, folders: 0 }),
      ),
    ].sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));

    const limit = DISK_USAGE_LIMITS.childrenPerFolder;
    const shown = entries.slice(0, limit);
    const rest = { count: node.smaller.count, size: node.smaller.size, onDisk: node.smaller.onDisk, files: node.smaller.count, folders: 0 };
    for (const entry of entries.slice(limit)) {
      rest.count += 1;
      rest.size += entry.size;
      rest.onDisk += entry.onDisk;
      rest.files += entry.kind === 'file' ? 1 : entry.files;
      rest.folders += entry.kind === 'folder' ? entry.folders + 1 : 0;
    }
    if (rest.count > 0) {
      shown.push({
        kind: 'rest',
        name: `${rest.count.toLocaleString('en-US')} more`,
        path: null,
        size: rest.size,
        onDisk: rest.onDisk,
        files: rest.files,
        folders: rest.folders,
        count: rest.count,
      });
    }
    return { ...own, children: shown };
  }
}
