import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiIconAction, UiPanelTab, UiTransfer } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/**
 * The bottom panel: the Transfers list and the Problems list.
 *
 * Both are views over live state — uploads from `TransfersFeature`, failed
 * requests from the file-system cache — so the counts in the tab bar are
 * always the real ones.
 */
export class BottomPanelFeature {
  private readonly activeTabId: WritableSignal<string>;

  readonly actions: readonly UiIconAction[];

  constructor(private readonly parent: WorkbenchService) {
    this.activeTabId = signal('transfers');
    this.actions = [
      { id: 'clear', label: 'Clear finished transfers', icon: 'trash' },
      { id: 'close', label: 'Close panel', icon: 'x' },
    ];
  }

  readonly tabs = computed<readonly UiPanelTab[]>(() => {
    const activeId = this.activeTabId();
    const problems = this.parent.fsDataFt.errors().length;
    const transfers = this.parent.transfersFt.rows().length;
    return [
      {
        id: 'transfers',
        label: 'Transfers',
        ...(transfers > 0 ? { count: transfers } : {}),
        ...(activeId === 'transfers' ? { active: true } : {}),
      },
      {
        id: 'problems',
        label: 'Problems',
        ...(problems > 0 ? { count: problems } : {}),
        ...(activeId === 'problems' ? { active: true } : {}),
      },
    ];
  });

  readonly transfersVisible = computed(() => this.activeTabId() === 'transfers');
  readonly problemsVisible = computed(() => this.activeTabId() === 'problems');

  readonly transfers = computed<readonly UiTransfer[]>(() => this.parent.transfersFt.rows());

  /** Failed listings, rendered as rows the Problems tab can show. */
  readonly problems = computed(() =>
    this.parent.fsDataFt.errors().map((failure) => ({
      id: failure.path,
      path: failure.path === '' ? '/' : failure.path,
      message: failure.error.message,
    })),
  );

  /** Nothing to show yet — the panel says so rather than looking broken. */
  readonly transfersEmpty = computed(() => this.parent.transfersFt.rows().length === 0);

  select(id: string): void {
    this.activeTabId.set(id);
  }

  runAction(actionId: string): void {
    if (actionId === 'clear') {
      this.parent.transfersFt.clearFinished();
    }
  }
}
