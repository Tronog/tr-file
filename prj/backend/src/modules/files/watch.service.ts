import { randomUUID } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { lstat, opendir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { HttpError, type Logger } from '../../core/index.js';
import type { FilePathResolver } from './file-path.resolver.js';

/** The most folders one watch call may name: more than a screen can show. */
export const WATCH_MAX_PATHS = 256;

/** A session nobody has asked about for this long is dropped, and its watchers with it. */
const WATCH_IDLE_MS = 60_000;

/** Sessions kept at once; past this, the one idle longest makes room. */
const MAX_SESSIONS = 1024;

/**
 * A folder with this many entries or more is not snapshotted when watched
 * (it would cost as much as listing it): only entries coming, going or being
 * renamed count as changes in it — see `WatchedFolder.children`. The same
 * line as a large listing's (PRD 004, §3.1).
 */
export const WATCH_SNAPSHOT_MAX = 1000;

/** Content changes checked per folder per poll; the rest wait for the next poll. */
const VERIFY_PER_POLL = 256;

/** Serialised shape returned by `POST /fs/watch`. */
export interface WatchResultDto {
  /** The session to name next time — a new one when the old was unknown. */
  readonly watchId: string;
  /** The folders asked about, as they were asked, that must be read again. */
  readonly changed: readonly string[];
}

/** Tuning, for tests; the defaults are what the API promises. */
export interface WatchServiceOptions {
  readonly idleMs?: number;
  /** `fs.watch`, replaceable so the fallback can be exercised. */
  readonly watch?: typeof watch;
}

/**
 * One folder being watched, shared by every session that watches it.
 *
 * Normally an `fs.watch` watcher. Where the system will not give one — the
 * inotify limit (`ENOSPC`), a file system without notifications — the folder's
 * `mtimeMs` + `ctimeMs` are compared on each call instead: coarser, but a
 * listing changes both when an entry is added, removed or renamed.
 */
interface WatchedFolder {
  readonly relative: string;
  readonly absolute: string;
  readonly sessions: Set<WatchSession>;
  watcher: FSWatcher | null;
  /** The polling fallback's last stamp; `null` while a watcher does the work. */
  stamp: string | null;
  /** Which folder this is: a folder deleted and made again is another one. */
  identity: string;
  /**
   * What a listing shows of each child — type, size, modified — as it was
   * when the watcher started, and as each change was checked since; `null`
   * for a folder too large to snapshot, where a child's content changes are
   * not watched at all. A `'change'` event is only a change if this differs:
   * Windows reports access-time and attribute updates as `'change'` too, and
   * a share whose files are dated ahead of its server's clock updates access
   * times on every read — reading the folder, which would report it changed,
   * which would read it again, for ever.
   */
  children: Map<string, string> | null;
  /** Children a `'change'` event named, to be checked at the next poll. */
  readonly pending: Set<string>;
}

/** One client's view: what it watches, and what has changed since it last asked. */
interface WatchSession {
  readonly id: string;
  folders: Set<string>;
  readonly changed: Set<string>;
  timer: ReturnType<typeof setTimeout> | null;
}

/**
 * Auto-refresh (PRD 003, §5), by polling: a client names the folders it has
 * on screen every couple of seconds and hears back which of them changed
 * since it last asked — nothing to keep open, so it works the same over HTTP,
 * through a proxy, and over the desktop bridge.
 *
 * Each client is a *session*, by the `watchId` this hands out. A call
 * replaces the session's folders with the ones named and answers with those
 * that changed since the previous call. A `watchId` the server does not know
 * — it restarted, or the session went idle — starts a new session and answers
 * *every* folder as changed: whatever happened in between was missed, so the
 * client must read them all again.
 *
 * Watching is `fs.watch`, not recursive — a listing only shows a folder's
 * direct children, and that is exactly what a folder's watcher reports —
 * shared between sessions and closed when the last one lets go. A watcher
 * that fails, or a folder that is not the one it was (deleted, made again),
 * counts as a change and is set up afresh on the next call. Watchers and
 * timers never keep the process alive; `close` releases everything.
 */
export class WatchService {
  private readonly sessions = new Map<string, WatchSession>();
  private readonly folders = new Map<string, WatchedFolder>();
  private readonly idleMs: number;
  private readonly watchFn: typeof watch;
  private closed = false;

  constructor(
    private readonly resolver: FilePathResolver,
    private readonly logger: Logger,
    options: WatchServiceOptions = {},
  ) {
    this.idleMs = options.idleMs ?? WATCH_IDLE_MS;
    this.watchFn = options.watch ?? watch;
  }

  /**
   * One poll: `paths` are the folders the client now shows. Paths that are
   * not a readable folder in the root are passed over — the client will find
   * out when it reads them — rather than failing the rest.
   */
  async watch(watchId: string | null, paths: readonly string[]): Promise<WatchResultDto> {
    if (this.closed) {
      throw HttpError.internal('Watching has stopped');
    }
    if (paths.length > WATCH_MAX_PATHS) {
      throw HttpError.badRequest(`At most ${WATCH_MAX_PATHS} folders can be watched at once`);
    }

    const requested = [...new Set(paths)];
    const known = watchId === null ? undefined : this.sessions.get(watchId);
    const resync = known === undefined && watchId !== null;
    const session = known ?? this.open();
    this.touch(session);

    // Folders already watched whose change a watcher cannot report: polled here.
    await this.check(session);

    const keyed = requested.map((path) => ({ path, key: this.keyOf(path) }));
    const changed = resync
      ? requested
      : keyed
          .filter(({ key }) => key !== null && session.folders.has(key) && session.changed.has(key))
          .map(({ path }) => path);
    session.changed.clear();

    const next = new Set<string>();
    for (const { path, key } of keyed) {
      if (key !== null && !next.has(key) && (await this.acquire(session, path))) {
        next.add(key);
      }
    }
    for (const key of session.folders) {
      if (!next.has(key)) {
        this.release(session, key);
      }
    }
    session.folders = next;

    return { watchId: session.id, changed };
  }

  /** Stops every watcher and forgets every session. */
  close(): void {
    this.closed = true;
    for (const session of this.sessions.values()) {
      WatchService.idle(session);
    }
    this.sessions.clear();
    for (const folder of this.folders.values()) {
      WatchService.stop(folder);
    }
    this.folders.clear();
  }

  /** How many folders have a watcher or a stamp right now; for tests and logs. */
  get watchedFolders(): number {
    return this.folders.size;
  }

  /* -- sessions ------------------------------------------------------------- */

  private open(): WatchSession {
    if (this.sessions.size >= MAX_SESSIONS) {
      // Map order is insertion order, and `touch` re-inserts: the first is the idlest.
      const [idlest] = this.sessions.keys();
      if (idlest !== undefined) {
        this.expire(idlest);
      }
    }
    const session: WatchSession = {
      id: randomUUID(),
      folders: new Set(),
      changed: new Set(),
      timer: null,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  private touch(session: WatchSession): void {
    WatchService.idle(session);
    session.timer = setTimeout(() => this.expire(session.id), this.idleMs);
    session.timer.unref?.();
    this.sessions.delete(session.id);
    this.sessions.set(session.id, session);
  }

  private expire(id: string): void {
    const session = this.sessions.get(id);
    if (session === undefined) {
      return;
    }
    WatchService.idle(session);
    this.sessions.delete(id);
    for (const key of session.folders) {
      this.release(session, key);
    }
    this.logger.debug('watch session expired', { watchId: id });
  }

  /* -- folders --------------------------------------------------------------- */

  /** The key a path is watched under, or `null` for a path the resolver refuses. */
  private keyOf(path: string): string | null {
    try {
      return this.resolver.resolve(path).relative;
    } catch {
      return null;
    }
  }

  /**
   * Adds `session` to the folder's watchers, setting one up if it is the
   * first — or if the last one broke. `false` when `path` is not a folder the
   * session may watch.
   */
  private async acquire(session: WatchSession, path: string): Promise<boolean> {
    let absolute: string;
    let identity: string;
    let relative: string;
    try {
      const target = await this.resolver.resolveReal(path);
      const stats = await stat(target.absolute);
      if (!stats.isDirectory()) {
        return false;
      }
      absolute = target.absolute;
      relative = target.relative;
      identity = `${stats.dev}:${stats.ino}`;
    } catch {
      return false;
    }

    let folder = this.folders.get(relative);
    if (folder === undefined) {
      folder = { relative, absolute, sessions: new Set(), watcher: null, stamp: null, identity, children: null, pending: new Set() };
      this.folders.set(relative, folder);
    }
    if (folder.watcher === null && folder.stamp === null) {
      folder.identity = identity;
      await this.start(folder);
    }
    folder.sessions.add(session);
    return true;
  }

  private release(session: WatchSession, key: string): void {
    const folder = this.folders.get(key);
    if (folder === undefined) {
      return;
    }
    folder.sessions.delete(session);
    if (folder.sessions.size === 0) {
      WatchService.stop(folder);
      this.folders.delete(key);
    }
  }

  /** A watcher, or — when the system has none to give — the polling fallback. */
  private async start(folder: WatchedFolder): Promise<void> {
    try {
      const watcher = this.watchFn(folder.absolute, { persistent: false }, (event, filename) => this.noticed(folder, event, filename));
      watcher.on('error', (error: unknown) => {
        this.logger.debug('folder watcher failed', {
          path: folder.relative || '/',
          reason: error instanceof Error ? error.message : String(error),
        });
        this.broken(folder, watcher);
      });
      watcher.on('close', () => this.broken(folder, watcher));
      folder.watcher = watcher;
      folder.pending.clear();
      folder.children = await WatchService.snapshotOf(folder.absolute);
    } catch (error) {
      this.logger.debug('cannot watch folder; comparing its times instead', {
        path: folder.relative || '/',
        reason: error instanceof Error ? error.message : String(error),
      });
      folder.stamp = (await WatchService.stampOf(folder.absolute)) ?? 'missing';
    }
  }

  /**
   * Polls what a watcher cannot tell: a fallback folder's times, and whether
   * each folder is still the one that was watched. A folder deleted and made
   * again under the same name has a dead watcher on the old one.
   */
  private async check(session: WatchSession): Promise<void> {
    for (const key of session.folders) {
      const folder = this.folders.get(key);
      if (folder === undefined) {
        continue;
      }
      await this.verify(folder);
      let identity: string | null = null;
      let stamp: string | null = null;
      try {
        const stats = await stat(folder.absolute);
        identity = `${stats.dev}:${stats.ino}`;
        stamp = WatchService.stampFrom(stats);
      } catch {
        // Gone: that is a change, and there is nothing left to watch.
      }
      if (identity !== folder.identity) {
        this.changed(folder);
        WatchService.stop(folder);
        folder.stamp = null;
      } else if (folder.stamp !== null && stamp !== folder.stamp) {
        folder.stamp = stamp;
        this.changed(folder);
      }
    }
  }

  /**
   * A watcher's event. An entry coming, going or renamed (`'rename'`) is a
   * change; a `'change'` — its content, or only its access time — is checked
   * at the next poll against what a listing shows of it, and in a folder too
   * large to snapshot, not watched at all.
   */
  private noticed(folder: WatchedFolder, event: string, filename: string | Buffer | null): void {
    const name = filename === null ? null : filename.toString();
    if (event === 'rename' || name === null) {
      if (name !== null) {
        folder.children?.delete(name);
      }
      this.changed(folder);
    } else if (folder.children !== null) {
      folder.pending.add(name);
    }
  }

  /** Checks the children `'change'` events named: a change only if what a listing shows of one differs. */
  private async verify(folder: WatchedFolder): Promise<void> {
    const children = folder.children;
    if (children === null || folder.pending.size === 0) {
      return;
    }
    const names = [...folder.pending].slice(0, VERIFY_PER_POLL);
    let ignored = 0;
    for (const name of names) {
      folder.pending.delete(name);
      const seen = await WatchService.shownOf(join(folder.absolute, name));
      if (seen === children.get(name)) {
        ignored++;
        continue;
      }
      if (seen === null) {
        children.delete(name);
      } else {
        children.set(name, seen);
      }
      this.changed(folder);
    }
    if (ignored > 0) {
      this.logger.debug('ignored folder events that change nothing a listing shows', { path: folder.relative || '/', ignored });
    }
  }

  /** What a listing shows of one child — or `null` when it is gone. */
  private static async shownOf(absolute: string): Promise<string | null> {
    try {
      const stats = await lstat(absolute);
      const type = stats.isSymbolicLink() ? 'l' : stats.isDirectory() ? 'd' : stats.isFile() ? 'f' : 'o';
      return `${type}:${stats.size}:${stats.mtimeMs}`;
    } catch {
      return null;
    }
  }

  /** What a listing shows of every child of a folder — `null` once there are `WATCH_SNAPSHOT_MAX` of them. */
  private static async snapshotOf(absolute: string): Promise<Map<string, string> | null> {
    const names: string[] = [];
    try {
      for await (const dirent of await opendir(absolute, { bufferSize: 256 })) {
        names.push(dirent.name);
        if (names.length >= WATCH_SNAPSHOT_MAX) {
          return null;
        }
      }
    } catch {
      return null;
    }
    const shown = await Promise.all(names.map((name) => WatchService.shownOf(join(absolute, name))));
    const children = new Map<string, string>();
    names.forEach((name, index) => {
      const seen = shown[index];
      if (seen !== null && seen !== undefined) {
        children.set(name, seen);
      }
    });
    return children;
  }

  private changed(folder: WatchedFolder): void {
    for (const session of folder.sessions) {
      session.changed.add(folder.relative);
    }
  }

  /** A watcher that errored or closed on its own: a change, and set up again next time. */
  private broken(folder: WatchedFolder, watcher: FSWatcher): void {
    if (folder.watcher !== watcher) {
      return; // Closed by us, or already replaced.
    }
    this.changed(folder);
    WatchService.stop(folder);
  }

  private static idle(session: WatchSession): void {
    if (session.timer !== null) {
      clearTimeout(session.timer);
      session.timer = null;
    }
  }

  private static stop(folder: WatchedFolder): void {
    const watcher = folder.watcher;
    folder.watcher = null;
    watcher?.close();
  }

  private static async stampOf(absolute: string): Promise<string | null> {
    try {
      return WatchService.stampFrom(await stat(absolute));
    } catch {
      return null;
    }
  }

  private static stampFrom(stats: { mtimeMs: number; ctimeMs: number }): string {
    return `${stats.mtimeMs}:${stats.ctimeMs}`;
  }
}
