import { signal } from '@angular/core';
import type { WorkbenchService } from '../workbench.service';

/**
 * Where focus goes when a panel changes what it shows (PRD 001, Section 6.3).
 *
 * Choosing a tab is a request to *work in* that tab, so once its content is on
 * screen the keyboard should already be in it: no `Tab`, `Tab`, `Tab` from the
 * tab bar down to the first row. Only a deliberate choice counts — `UiTabBar`
 * emits `activate` for a click (and for the `Enter`/`Space` the browser turns
 * into one) but not for the arrows that rove across the bar, or a keyboard
 * user could never reach the tab after next.
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
   * A tab was chosen in `groupId`: make that group the active one and ask its
   * body to take focus as soon as it has rendered.
   */
  focusBody(groupId: string): void {
    this.parent.editorGroupsFt.focus(groupId);
    this.seq += 1;
    this.tokens.update((tokens) => ({ ...tokens, [groupId]: this.seq }));
  }
}
