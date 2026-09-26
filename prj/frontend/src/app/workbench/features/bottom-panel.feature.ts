import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiIconAction, UiPanelTab, UiTransfer } from '@tr-file/ui';
import type { WorkbenchService } from '../workbench.service';

/**
 * The bottom panel: Transfers, Progress and Problems.
 *
 * All three are views over live state — uploads and downloads from
 * `TransfersFeature`, file operations from `OperationsFeature` (PRD 005, §1),
 * failed requests from the file-system cache — so the counts in the tab bar
 * are always the real ones. Progress counts what is still running.
 */
export class BottomPanelFeature {
  private readonly activeTabId: WritableSignal<string>;

  /**
   * Whether the panel is showing its tab bar only.
   *
   * Collapsed on start (§12.1): transfers and problems are both things that
   * *happen*, and until one does, the panel is a strip of empty space taken
   * from the folder the app was opened to look at. The counts on the tabs say
   * when there is something to open it for.
   */
  readonly collapsed: WritableSignal<boolean>;

  constructor(private readonly parent: WorkbenchService) {
    this.activeTabId = signal('transfers');
    this.collapsed = signal(true);
  }

  /**
   * The tab bar's chrome buttons.
   *
   * There is no close button: a panel that closed would need a second control
   * somewhere else to bring it back, so the button that looks like a close in
   * VS Code is the collapse toggle, and the double chevron points the way the
   * panel will move (§12.1).
   */
  readonly actions = computed<readonly UiIconAction[]>(() => {
    const collapsed = this.collapsed();
    return [
      this.activeTabId() === 'progress'
        ? { id: 'clear', label: 'Clear finished operations', icon: 'trash' }
        : { id: 'clear', label: 'Clear finished transfers', icon: 'trash' },
      collapsed
        ? { id: 'toggle', label: 'Restore panel', icon: 'chevrons-up' }
        : { id: 'toggle', label: 'Hide panel', icon: 'chevrons-down' },
    ];
  });

  readonly tabs = computed<readonly UiPanelTab[]>(() => {
    const activeId = this.activeTabId();
    const problems = this.parent.fsDataFt.errors().length;
    const transfers = this.parent.transfersFt.rows().length;
    const running = this.parent.operationsFt.runningCount();
    return [
      {
        id: 'transfers',
        label: 'Transfers',
        ...(transfers > 0 ? { count: transfers } : {}),
        ...(activeId === 'transfers' ? { active: true } : {}),
      },
      {
        id: 'progress',
        label: 'Progress',
        ...(running > 0 ? { count: running } : {}),
        ...(activeId === 'progress' ? { active: true } : {}),
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
  readonly progressVisible = computed(() => this.activeTabId() === 'progress');
  readonly problemsVisible = computed(() => this.activeTabId() === 'problems');

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

  /**
   * Shows a tab. Asking for a tab is asking to see it, so a collapsed panel
   * opens — that is what the activity bar's Problems icon has to do, and it is
   * what clicking a tab that is already there means too.
   */
  select(id: string): void {
    this.activeTabId.set(id);
    this.collapsed.set(false);
  }

  /** The collapse toggle: the tab bar stays, the body goes. */
  toggleCollapsed(): void {
    this.collapsed.update((collapsed) => !collapsed);
  }

  runAction(actionId: string): void {
    if (actionId === 'clear') {
      if (this.activeTabId() === 'progress') {
        this.parent.operationsFt.clearFinished();
      } else {
        this.parent.transfersFt.clearFinished();
      }
    } else if (actionId === 'toggle') {
      this.toggleCollapsed();
    }
  }
}
