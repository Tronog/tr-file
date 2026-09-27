import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiIconAction, UiTreeNode } from '@tr-file/ui';
import type { FsEntry } from '../../file-system/file-system.model';
import type { WorkbenchService } from '../workbench.service';
import { isFolder } from '../../file-system/fs-entry-kind';

/** The workspace root, which the backend addresses as the empty path. */
const ROOT = '';

/**
 * The left sidebar's directory tree, backed by `/api/fs/list`.
 *
 * Expansion drives fetching: a directory is listed the first time it is opened
 * and then served from the shared cache, so a folder already open in a panel
 * costs nothing here. The flattening happens in this class rather than in the
 * component, which keeps `ui-tree` render-only and leaves room for virtual
 * scrolling over a large directory later.
 */
export class ExplorerFeature {
  private readonly expandedPaths: WritableSignal<ReadonlySet<string>>;

  /**
   * The folder the tree highlights (§9.1.2). Its own, not the workbench-wide
   * selection: selecting an entry in a panel — a single click — leaves the
   * tree where it is, and only *opening* a folder there, or walking a panel's
   * history, moves it (`reveal`). The details sidebar follows every click.
   */
  private readonly highlighted = signal<string | null>(null);

  readonly actions: readonly UiIconAction[];

  constructor(private readonly parent: WorkbenchService) {
    this.expandedPaths = signal<ReadonlySet<string>>(new Set([ROOT]));
    this.actions = parent.mockWorkbench.explorerActions;
  }

  /** What the tree's root is called — the backend's name for it (PRD 003, §6). */
  get title(): string {
    return this.parent.workspaceName();
  }

  /** Flat, depth-ordered rows for `ui-tree`. */
  readonly nodes = computed<readonly UiTreeNode[]>(() => {
    const rows: UiTreeNode[] = [];
    this.collect(ROOT, 0, rows);
    return rows;
  });

  /** Nothing to show yet: the root has never been read. A reload keeps the tree up. */
  readonly loading = computed(() => {
    const state = this.parent.fsDataFt.listingState(ROOT);
    return state?.status === 'loading' && state.listing === undefined;
  });

  /** The message to show instead of a tree when the root cannot be read. */
  readonly error = computed(() => this.parent.fsDataFt.listingState(ROOT)?.error?.message);

  /** Loads the root; called once the workbench is up. */
  start(): void {
    this.parent.fsDataFt.ensureListing(ROOT);
  }

  /** Expands or collapses a directory, fetching it the first time. */
  toggle(path: string): void {
    const expanded = this.expandedPaths();
    if (expanded.has(path)) {
      this.expandedPaths.update((paths) => {
        const next = new Set(paths);
        next.delete(path);
        return next;
      });
      return;
    }

    this.expandedPaths.update((paths) => new Set(paths).add(path));
    this.parent.fsDataFt.ensureListing(path);
  }

  /** Opens a directory without closing one that is already open. */
  expand(path: string): void {
    if (this.expandedPaths().has(path)) {
      return;
    }
    this.expandedPaths.update((paths) => new Set(paths).add(path));
    this.parent.fsDataFt.ensureListing(path);
  }

  /** A row of the tree itself was chosen. */
  select(path: string): void {
    this.highlighted.set(path);
  }

  /**
   * A panel opened `path` (§9.1.2): the tree highlights it, with every folder
   * above it opened so it can be seen — and `UiTree` scrolls it into view. The
   * folder itself is left as it was; revealing is not expanding.
   */
  reveal(path: string): void {
    this.highlighted.set(path);
    const parts = path === '' ? [] : path.split('/');
    for (let depth = 1; depth < parts.length; depth += 1) {
      this.expand(parts.slice(0, depth).join('/'));
    }
  }

  /** Whether a directory is currently showing its children. */
  isExpanded(path: string): boolean {
    return this.expandedPaths().has(path);
  }

  /** Re-reads every directory currently on screen (the Refresh action). */
  refresh(): void {
    for (const path of this.expandedPaths()) {
      void this.parent.fsDataFt.reloadListing(path);
    }
  }

  /** A folder was renamed: what was open under its old name stays open under the new one. */
  relocate(move: (path: string) => string): void {
    const expanded = [...this.expandedPaths()];
    if (expanded.some((path) => move(path) !== path)) {
      this.expandedPaths.set(new Set(expanded.map(move)));
    }
    const highlighted = this.highlighted();
    if (highlighted !== null && move(highlighted) !== highlighted) {
      this.highlighted.set(move(highlighted));
    }
  }

  /**
   * The folders whose listings the tree shows: every open one whose own
   * folders are all open too — what auto-refresh watches (PRD 003, §5).
   */
  foldersShown(): readonly string[] {
    const expanded = this.expandedPaths();
    return [...expanded].filter((path) => {
      const parts = path === '' ? [] : path.split('/');
      for (let depth = 1; depth < parts.length; depth += 1) {
        if (!expanded.has(parts.slice(0, depth).join('/'))) {
          return false;
        }
      }
      return path === ROOT || expanded.has(ROOT);
    });
  }

  /** Collapses everything but the root. */
  collapseAll(): void {
    this.expandedPaths.set(new Set([ROOT]));
  }

  runAction(actionId: string): void {
    if (actionId === 'refresh') {
      this.refresh();
    } else if (actionId === 'collapse') {
      this.collapseAll();
    } else if (actionId === 'new-file' || actionId === 'new-folder') {
      // Into the folder the tree highlights, as VS Code's explorer does (PRD 003, §5).
      const folder = this.highlighted() ?? ROOT;
      const edit = this.parent.fileEditFt;
      void (actionId === 'new-file' ? edit.createFile(folder, this.parent.activeGroupId()) : edit.createFolder(folder, this.parent.activeGroupId()));
    }
  }

  /**
   * The tree is a map of the workspace, not a second file list: files show up
   * in the panels, so only directories are collected here (§9.1.1).
   */
  private collect(path: string, depth: number, rows: UiTreeNode[]): void {
    for (const entry of this.parent.fsDataFt.entries(path)) {
      if (!isFolder(entry)) {
        continue;
      }
      const expanded = this.expandedPaths().has(entry.path);
      rows.push(this.toRow(entry, depth, expanded));
      if (expanded) {
        this.collect(entry.path, depth + 1, rows);
      }
    }
  }

  private toRow(entry: FsEntry, depth: number, expanded: boolean): UiTreeNode {
    const files = this.parent.fileViewModel;
    const expandable = isFolder(entry);
    const state = expandable ? this.parent.fsDataFt.listingState(entry.path) : undefined;
    const selected = entry.path === this.highlighted();
    const meta = state?.status === 'error' ? 'unreadable' : files.treeMeta(entry);

    return {
      id: entry.path,
      label: entry.name,
      depth,
      icon: files.icon(entry, expanded),
      tint: files.tint(entry),
      expandable,
      ...(expandable ? { expanded } : {}),
      ...(expanded && state?.status === 'loading' && !state.listing ? { busy: true } : {}),
      selected,
      focused: selected,
      ...(entry.hidden ? { decoration: 'ignored' as const } : {}),
      ...(meta === undefined ? {} : { meta }),
      // One guide per ancestor level, all drawn — VS Code's indent guides.
      guides: Array.from({ length: depth }, () => true),
    };
  }

}
