import { computed, signal, type WritableSignal } from '@angular/core';
import type { WorkbenchService } from '../workbench.service';

/** Panes that start expanded; everything else starts collapsed. */
const INITIALLY_EXPANDED = ['explorer-tree', 'properties', 'permissions', 'tags', 'git', 'open-with'] as const;

/**
 * Which collapsible sidebar panes are open.
 *
 * `ui-pane` is stateless — it renders the `expanded` it is given — so the open/
 * closed state of every pane in both sidebars lives here.
 */
export class SidebarPanesFeature {
  private readonly expanded: WritableSignal<ReadonlySet<string>>;

  constructor(private readonly parent: WorkbenchService) {
    this.expanded = signal<ReadonlySet<string>>(new Set(INITIALLY_EXPANDED));
  }

  /** Read in templates as `panes.isExpanded('tags')`. */
  isExpanded(id: string): boolean {
    return this.expanded().has(id);
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
