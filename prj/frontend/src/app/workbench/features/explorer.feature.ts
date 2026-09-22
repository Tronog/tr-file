import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiIconAction, UiTreeNode } from '@tr-file/ui';
import type { FsEntry } from '../../file-system/file-system.model';
import type { WorkbenchService } from '../workbench.service';

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

  readonly title: string;
  readonly actions: readonly UiIconAction[];

  constructor(private readonly parent: WorkbenchService) {
    this.expandedPaths = signal<ReadonlySet<string>>(new Set([ROOT]));
    this.title = parent.mockWorkbench.workspaceName;
    this.actions = parent.mockWorkbench.explorerActions;
  }

  /** Flat, depth-ordered rows for `ui-tree`. */
  readonly nodes = computed<readonly UiTreeNode[]>(() => {
    const rows: UiTreeNode[] = [];
    this.collect(ROOT, 0, rows);
    return rows;
  });

  /** True while the root listing has not arrived yet. */
  readonly loading = computed(() => this.parent.fsDataFt.listingState(ROOT)?.status === 'loading');

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

  /** Whether a directory is currently showing its children. */
  isExpanded(path: string): boolean {
    return this.expandedPaths().has(path);
  }

  /** Re-reads every directory currently on screen (the Refresh action). */
  refresh(): void {
    for (const path of this.expandedPaths()) {
      this.parent.fsDataFt.reloadListing(path);
    }
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
    }
  }

  /**
   * The tree is a map of the workspace, not a second file list: files show up
   * in the panels, so only directories are collected here (§9.1.1).
   */
  private collect(path: string, depth: number, rows: UiTreeNode[]): void {
    for (const entry of this.parent.fsDataFt.entries(path)) {
      if (entry.type !== 'directory') {
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
    const expandable = entry.type === 'directory';
    const state = expandable ? this.parent.fsDataFt.listingState(entry.path) : undefined;
    const selected = entry.path === this.parent.selectedEntryId();
    const meta = state?.status === 'error' ? 'unreadable' : files.treeMeta(entry);

    return {
      id: entry.path,
      label: entry.name,
      depth,
      icon: files.icon(entry, expanded),
      tint: files.tint(entry),
      expandable,
      ...(expandable ? { expanded } : {}),
      ...(expanded && state?.status === 'loading' ? { busy: true } : {}),
      selected,
      focused: selected,
      ...(entry.hidden ? { decoration: 'ignored' as const } : {}),
      ...(meta === undefined ? {} : { meta }),
      // One guide per ancestor level, all drawn — VS Code's indent guides.
      guides: Array.from({ length: depth }, () => true),
    };
  }

}
