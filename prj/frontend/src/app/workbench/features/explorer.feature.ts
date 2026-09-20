import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiIconAction, UiTreeNode } from '@tr-file/ui';
import type { MockFileNode } from '../mock-data/mock-data.model';
import type { WorkbenchService } from '../workbench.service';

/**
 * The left sidebar's directory tree.
 *
 * Owns which directories are expanded and flattens the nested mock tree into
 * the one-row-per-node list `ui-tree` renders. Flattening here (rather than
 * inside the component) keeps the component render-only and leaves the door
 * open for virtual scrolling over a large directory later.
 */
export class ExplorerFeature {
  /**
   * Eager state is assigned in the constructor, not in field initializers:
   * with native class fields those run before `parent` is assigned.
   */
  private readonly expandedPaths: WritableSignal<ReadonlySet<string>>;

  readonly title: string;
  readonly actions: readonly UiIconAction[];

  constructor(private readonly parent: WorkbenchService) {
    this.expandedPaths = signal<ReadonlySet<string>>(new Set(parent.mockWorkbench.layout.expandedPaths));
    this.title = parent.mockFileSystem.workspaceName;
    this.actions = parent.mockWorkbench.explorerActions;
  }

  /** Flat, depth-ordered rows for `ui-tree`. */
  readonly nodes = computed<readonly UiTreeNode[]>(() => {
    const expanded = this.expandedPaths();
    const selectedId = this.parent.selectedEntryId();
    const rows: UiTreeNode[] = [];

    const walk = (nodes: readonly MockFileNode[], depth: number): void => {
      for (const node of nodes) {
        const isExpanded = expanded.has(node.id);
        rows.push(this.toRow(node, depth, isExpanded, selectedId));
        if (node.children && isExpanded) {
          walk(node.children, depth + 1);
        }
      }
    };

    walk(this.parent.mockFileSystem.tree, 0);
    return rows;
  });

  /** Expands or collapses one directory. */
  toggle(id: string): void {
    this.expandedPaths.update((paths) => {
      const next = new Set(paths);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /** Selects a row; the details sidebar follows the workbench-wide selection. */
  activate(id: string): void {
    this.parent.selectedEntryId.set(id);
  }

  private toRow(node: MockFileNode, depth: number, expanded: boolean, selectedId: string): UiTreeNode {
    const files = this.parent.fileViewModel;
    const expandable = node.kind === 'directory';
    const meta = files.treeMeta(node, expanded);
    return {
      id: node.id,
      label: node.name,
      depth,
      icon: files.icon(node, expanded),
      tint: files.tint(node),
      expandable,
      ...(expandable ? { expanded } : {}),
      selected: node.id === selectedId,
      focused: node.id === selectedId,
      ...(node.cut ? { cut: true } : {}),
      ...(node.decoration ? { decoration: node.decoration } : {}),
      ...(meta === undefined ? {} : { meta }),
      // One guide per ancestor level, all drawn — VS Code's indent guides.
      guides: Array.from({ length: depth }, () => true),
    };
  }
}
