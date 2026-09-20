import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiIconAction, UiPanelTab, UiTransfer } from '@tr-file/ui';
import type { MockTransfer } from '../mock-data/mock-data.model';
import type { WorkbenchService } from '../workbench.service';

/** Direction → icon and colour, matching the mockup's transfer rows. */
const DIRECTION_STYLE = {
  upload: { icon: 'upload', color: 'var(--vsc-git-untracked)' },
  download: { icon: 'download', color: 'var(--vsc-accent)' },
  copy: { icon: 'copy', color: 'var(--vsc-git-modified)' },
} as const;

/**
 * The bottom panel (Problems / Output / Terminal / Transfers) and the transfer
 * rows it shows.
 */
export class BottomPanelFeature {
  private readonly activeTabId: WritableSignal<string>;

  readonly actions: readonly UiIconAction[];

  constructor(private readonly parent: WorkbenchService) {
    this.activeTabId = signal(parent.mockWorkbench.panelTabs.find((tab) => tab.active)?.id ?? 'transfers');
    this.actions = parent.mockWorkbench.panelActions;
  }

  readonly tabs = computed<readonly UiPanelTab[]>(() => {
    const activeId = this.activeTabId();
    return this.parent.mockWorkbench.panelTabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      ...(tab.count === undefined ? {} : { count: tab.count }),
      ...(tab.id === activeId ? { active: true } : {}),
    }));
  });

  readonly transfersVisible = computed(() => this.activeTabId() === 'transfers');

  readonly transfers = computed<readonly UiTransfer[]>(() =>
    this.parent.mockTransfers.transfers.map((transfer) => this.toViewModel(transfer)),
  );

  select(id: string): void {
    this.activeTabId.set(id);
  }

  private toViewModel(transfer: MockTransfer): UiTransfer {
    const style = DIRECTION_STYLE[transfer.direction];
    return {
      id: transfer.id,
      name: transfer.name,
      icon: style.icon,
      iconColor: style.color,
      progress: transfer.progress,
      statusLabel: transfer.statusLabel,
    };
  }
}
