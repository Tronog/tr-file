import { computed, signal, type WritableSignal } from '@angular/core';
import type { UiIconAction } from '../../models/icon.model';
import type { UiPanelTab } from '../../models/panel.model';
import type { UiWorkbenchService } from '../ui-workbench.service';

/**
 * The bottom panel (PRD 001, §12): its tabs — the configuration's, each
 * drawn by the application (`<ng-template uiBottomTab="…">`) — which one
 * shows, and whether the panel shows anything but its tab bar.
 *
 * Collapsed on start unless configured otherwise (§12.1): what is in it
 * *happens*, and until something does the panel is a strip of space taken
 * from the panels. A tab's count says when there is something to open it for.
 */
export class UiBottomPanelFeature {
  private readonly activeTabId: WritableSignal<string>;

  /** Whether the panel is showing its tab bar only. */
  readonly collapsed: WritableSignal<boolean>;

  /**
   * Whether the panel is put away altogether, tab bar and all — by `Ctrl`+`/`
   * with the sidebars (PRD 001, §9.2.1). It comes back as it was, collapsed
   * or open, and for anything asked of it: a tab chosen, the toggle.
   */
  readonly hidden = signal(false);

  private readonly focusToken = signal(0);

  /** Raised to put the keyboard in the active tab's content; `UiBottomPanel` answers it. */
  readonly bodyFocus = this.focusToken.asReadonly();

  constructor(protected readonly parent: UiWorkbenchService) {
    this.activeTabId = signal(parent.config.bottomPanel.defaultTab);
    this.collapsed = signal(parent.config.bottomPanel.collapsed ?? true);
  }

  /**
   * The tab bar's buttons: the application's for the tab showing, then the
   * collapse toggle. There is no close button: a panel that closed would need
   * a second control somewhere else to bring it back, so the button that looks
   * like a close in VS Code is the toggle, and the double chevron points the
   * way the panel will move (§12.1).
   */
  readonly actions = computed<readonly UiIconAction[]>(() => [
    ...this.tabActions(this.activeTabId()),
    this.collapsed() ? { id: 'toggle', label: 'Restore panel', icon: 'chevrons-up' } : { id: 'toggle', label: 'Hide panel', icon: 'chevrons-down' },
  ]);

  readonly tabs = computed<readonly UiPanelTab[]>(() => {
    const activeId = this.activeTabId();
    return this.parent.config.bottomPanel.tabs.map((tab) => {
      const count = this.countOf(tab.id);
      return { ...tab, ...(count !== undefined && count > 0 ? { count } : {}), ...(activeId === tab.id ? { active: true } : {}) };
    });
  });

  /** A tab's count — how many things it has to show — or `undefined`; the application's to say. */
  protected countOf(_tabId: string): number | undefined {
    return undefined;
  }

  /** The application's buttons for a tab, before the collapse toggle. */
  protected tabActions(_tabId: string): readonly UiIconAction[] {
    return [];
  }

  /** Whether `id` is the tab showing. */
  isVisible(id: string): boolean {
    return this.activeTabId() === id;
  }

  /**
   * Shows a tab. Asking for a tab is asking to see it, so a collapsed panel
   * opens — what the activity bar's buttons have to do, and what clicking a
   * tab that is already there means too.
   */
  select(id: string): void {
    this.activeTabId.set(id);
    this.collapsed.set(false);
    this.hidden.set(false);
  }

  /** The tab showing. */
  activeTab(): string {
    return this.activeTabId();
  }

  /** Puts the panel back as a restored session had it: open or collapsed, or put away — not the tab, which is the default on every start. */
  restore(collapsed: boolean, hidden = false): void {
    this.collapsed.set(collapsed);
    this.hidden.set(hidden);
  }

  /** Puts the panel away, or brings it back as it was; put away with the keyboard in it, the keyboard goes to the active panel. */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden()) {
      return;
    }
    const focused = globalThis.document?.activeElement;
    const hadFocus = hidden && focused instanceof Element && focused.closest('[data-focus-region="bottom"]') !== null;
    this.hidden.set(hidden);
    if (hadFocus) {
      this.parent.panelFocusFt.focusBody(this.parent.activeGroupId());
    }
  }

  /** Shows a tab with the keyboard in it, the main sub-application forward first (PRD 001, §1.1). */
  show(id: string): void {
    this.parent.subAppsFt.show(this.parent.subAppsFt.main);
    this.select(id);
    this.focusToken.update((token) => token + 1);
  }

  /**
   * The collapse toggle — the chevron, the title bar's button and its key
   * (PRD 001, §12.3): the tab bar stays, the body goes. The keyboard goes with
   * it: into the tab's content as the body opens, back into the active panel's
   * as it closes — else it would be left on an element that is gone.
   *
   * A tab chosen by something else — a job opening its progress — does not
   * take the keyboard: only this, which is the user asking for the panel.
   */
  toggleCollapsed(): void {
    if (this.hidden()) {
      // Put away by `Ctrl`+`/`: asked for, it comes back open.
      this.hidden.set(false);
      this.collapsed.set(false);
      this.focusToken.update((token) => token + 1);
    } else if (this.collapsed()) {
      this.collapsed.set(false);
      this.focusToken.update((token) => token + 1);
    } else {
      this.collapsed.set(true);
      this.parent.panelFocusFt.focusBody(this.parent.activeGroupId());
    }
  }

  /** A button of the tab bar; anything but the toggle is the application's (`runTabAction`). */
  runAction(actionId: string): void {
    if (actionId === 'toggle') {
      this.toggleCollapsed();
    } else {
      this.runTabAction(this.activeTabId(), actionId);
    }
  }

  protected runTabAction(_tabId: string, _actionId: string): void {
    // The application's buttons, if it has any.
  }
}
