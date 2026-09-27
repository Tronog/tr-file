import { signal } from '@angular/core';
import type { WorkbenchService } from '../workbench.service';

/**
 * Where focus goes when a panel is chosen (PRD 001, §6.3 and §6.3.1).
 *
 * Two gestures mean "I want to work in this panel", and both end here.
 * Choosing a tab is one: once its content is on screen the keyboard should
 * already be in it, with no `Tab`, `Tab`, `Tab` from the tab bar down to the
 * first row. Clicking the body's blank space is the other — the panel becomes
 * active either way, but a press that lands on nothing would otherwise leave
 * the keyboard wherever it was, in a panel the user has just left.
 *
 * Only a deliberate choice counts. `UiTabBar` emits `activate` for a click
 * (and for the `Enter`/`Space` the browser turns into one) but not for the
 * arrows that rove across the bar, or a keyboard user could never reach the
 * tab after next; `UiPanelGroup` emits `bodyPress` only for a press that
 * landed on nothing focusable, or it would drag focus off the very row that
 * was clicked.
 *
 * Moving focus is the component's job, since only it knows which element the
 * body currently offers, so this feature does not touch the DOM. It keeps one
 * token per group; bumping a token is the whole ask, and `UiPanelGroup`
 * answers it after its next render — which is what "after it becomes visible"
 * means in a signal-driven view.
 */
export class PanelFocusFeature {
  /** One token per group id; a group that has never been asked has none. */
  private readonly tokens = signal<Readonly<Record<string, number>>>({});

  /** Bumped globally rather than per group, so every token stays distinct. */
  private seq = 0;

  constructor(private readonly parent: WorkbenchService) {}

  /** The token a group's body watches. `0` until it has ever been asked. */
  token(groupId: string): number {
    return this.tokens()[groupId] ?? 0;
  }

  /**
   * `groupId` was chosen — by its tab, or by a press on its empty space. Make
   * it the active group and ask its body to take focus once it has rendered.
   */
  focusBody(groupId: string): void {
    this.parent.editorGroupsFt.focus(groupId);
    this.seq += 1;
    this.tokens.update((tokens) => ({ ...tokens, [groupId]: this.seq }));
  }

  /**
   * An action on files is over — its dialog answered or dismissed, its job
   * ended and the folders it changed read again (PRD 001, Fix 5): the keyboard
   * goes back into the content of the panel it was started from (or the
   * active one, if that panel has gone), wherever the dialogs, the menu or
   * the palette left it.
   *
   * Unless the user has gone somewhere of their own since: another window is
   * open, a text field has the keyboard, or focus is in another part of the
   * workbench — another panel, a sidebar, the bottom panel. Focus on the page
   * itself, in the title bar, the activity bar or the status bar — or still in
   * that panel — is taken back.
   */
  returnFocus(groupId: string): void {
    const group = this.parent.editorGroupsFt.stateOf(groupId) === undefined ? this.parent.activeGroupId() : groupId;
    if (this.parent.modal.isOpen()) {
      return;
    }
    const focused = globalThis.document?.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) {
      if (focused.matches('input, textarea, select') || focused.isContentEditable) {
        return;
      }
      const region = focused.closest('[data-focus-region]')?.getAttribute('data-focus-region') ?? null;
      if (region !== null && region !== `group:${group}`) {
        return;
      }
    }
    this.focusBody(group);
  }
}
