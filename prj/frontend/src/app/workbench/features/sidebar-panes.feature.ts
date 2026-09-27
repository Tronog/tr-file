import { computed, signal, type WritableSignal } from '@angular/core';
import type { WorkbenchService } from '../workbench.service';

/** Panes that start expanded; everything else starts collapsed. */
const INITIALLY_EXPANDED = [
  'bookmarks',
  'explorer-tree',
  'search-results',
  'properties',
  'permissions',
  'tags',
  'git',
  'open-with',
] as const;

/**
 * Which collapsible sidebar panes are open.
 *
 * `ui-pane` is stateless — it renders the `expanded` it is given — so the open/
 * closed state of every pane in both sidebars lives here.
 */
export class SidebarPanesFeature {
  private readonly expanded: WritableSignal<ReadonlySet<string>>;

  constructor(private readonly parent: WorkbenchService) {
    // Places are the desktop's (PRD 003, §6): a server names its root and no
    // more, so in a browser the pane starts closed — and asks when opened.
    this.expanded = signal<ReadonlySet<string>>(
      new Set([...INITIALLY_EXPANDED, ...(parent.fileSystem.transport.systemShell ? ['places'] : [])]),
    );
  }

  /** Read in templates as `panes.isExpanded('tags')`. */
  isExpanded(id: string): boolean {
    return this.expanded().has(id);
  }

  /** Every open pane, for the session to remember (PRD 003, §6). */
  expandedIds(): readonly string[] {
    return [...this.expanded()].sort();
  }

  /** Opens exactly these panes, as a restored session had them. */
  restore(ids: readonly string[]): void {
    this.expanded.set(new Set(ids));
  }

  /** Opens a pane, if it is not open already. */
  expand(id: string): void {
    if (!this.isExpanded(id)) {
      this.toggle(id);
    }
  }

  toggle(id: string): void {
    this.expanded.update((ids) => {
      const next = new Set(ids);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });
  }

  /** The details sidebar collapses entirely when nothing is selected. */
  readonly detailsVisible = computed(() => this.parent.detailsFt.hasDetails());
}
