import { computed } from '@angular/core';
import { UiBottomPanelFeature, type UiIconAction } from '@tr-file/ui';
import type { UiTransfer } from '@tr-file/file-ui';
import type { WorkbenchService } from '../workbench.service';

/**
 * The bottom panel: Transfers, Progress, Problems and Notes — the library's
 * `UiBottomPanelFeature`, with what the file manager shows in it.
 *
 * The first three are views over live state — uploads and downloads from
 * `TransfersFeature`, file operations from `OperationsFeature` (PRD 005, §1),
 * failed requests from the file-system cache — so the counts in the tab bar
 * are always the real ones. Progress counts what is still running. Notes
 * (PRD 001, §12.2) is the user's own text, kept by `NotesFeature` — and the
 * tab the panel starts on.
 */
export class BottomPanelFeature extends UiBottomPanelFeature {
  constructor(protected override readonly parent: WorkbenchService) {
    super(parent);
  }

  protected override countOf(tabId: string): number | undefined {
    switch (tabId) {
      case 'transfers':
        return this.parent.transfersFt.rows().length;
      case 'progress':
        return this.parent.operationsFt.runningCount();
      case 'problems':
        return this.parent.fsDataFt.errors().length;
      default:
        return undefined;
    }
  }

  /** What is finished can be cleared — but Notes have nothing finished to clear. */
  protected override tabActions(tabId: string): readonly UiIconAction[] {
    if (tabId === 'notes') {
      return [];
    }
    return [{ id: 'clear', label: tabId === 'progress' ? 'Clear finished operations' : 'Clear finished transfers', icon: 'trash' }];
  }

  protected override runTabAction(tabId: string, actionId: string): void {
    if (actionId !== 'clear' || tabId === 'notes') {
      return;
    }
    if (tabId === 'progress') {
      this.parent.operationsFt.clearFinished();
    } else {
      this.parent.transfersFt.clearFinished();
    }
  }

  /** Copies, moves, trashing and emptying the trash, newest first. */
  readonly operations = computed<readonly UiTransfer[]>(() => this.parent.operationsFt.rows());

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

  /** Opens the Notes tab with the cursor in it (PRD 001, §12.2). */
  showNotes(): void {
    this.show('notes');
  }
}
