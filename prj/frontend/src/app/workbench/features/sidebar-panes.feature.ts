import { computed } from '@angular/core';
import { UiSidebarPanesFeature } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/** The sidebars whose panes can be rearranged (PRD 002, §5.1). */
export type SidebarId = 'explorer' | 'details';

/**
 * The sidebars' panes (PRD 002, §5; PRD 001, §9.2) — the library's
 * `UiSidebarPanesFeature` over the panes `trFileWorkbenchConfig` names — and
 * where the Details sidebar puts the entry's card.
 */
export class SidebarPanesFeature extends UiSidebarPanesFeature {
  constructor(protected override readonly parent: WorkbenchService) {
    super(parent);
  }

  /**
   * The Details pane the entry's card goes above: the first one shown about the
   * entry, so Git — about the folder — can stand above the card or below it.
   * `undefined` when none of them is shown: the card then goes last.
   */
  readonly detailsCardBefore = computed(() => this.shown('details').find((id) => id !== 'git'));

  /** The details sidebar collapses entirely when nothing is selected. */
  readonly detailsVisible = computed(() => this.parent.detailsFt.hasDetails());
}
