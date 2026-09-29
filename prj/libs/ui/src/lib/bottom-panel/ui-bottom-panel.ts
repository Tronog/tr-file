import { Component, ElementRef, afterRenderEffect, computed, input, output, viewChild } from '@angular/core';
import { UiIconButton } from '../controls/ui-icon-button';
import type { UiIconAction, UiPanelTab } from '../models';

/** What in the body can take the keyboard. */
const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The workbench's bottom panel (Problems / Output / Terminal / Transfers).
 *
 * Chrome only: whatever the active tab shows is projected as content, so the
 * panel never needs to know about its own tabs' bodies.
 */
@Component({
  selector: 'ui-bottom-panel',
  imports: [UiIconButton],
  templateUrl: './ui-bottom-panel.html',
  styleUrl: './ui-bottom-panel.scss',
  host: { '[class.is-collapsed]': 'collapsed()' },
})
export class UiBottomPanel {
  readonly tabs = input.required<readonly UiPanelTab[]>();

  /** Right-aligned chrome icons (clear, maximize, close…). */
  readonly actions = input<readonly UiIconAction[]>([]);

  /** Accessible name of the tab list. */
  readonly label = input<string>('Panel');

  /**
   * Whether only the tab bar is showing.
   *
   * A collapsed panel keeps its tabs — they are the handle it is reopened by,
   * and the counts on them are the reason to reopen it. What it drops is the
   * body, which is also what makes it worth collapsing.
   */
  readonly collapsed = input<boolean>(false);

  /**
   * Raise to put the keyboard in the active tab's content once the body has
   * rendered (PRD 001, §12.3): its first focusable element, or the body
   * itself when the content has none — an empty list, a note in a `<p>`.
   */
  readonly bodyFocus = input(0);

  /**
   * A tab was clicked: its id. Not `select` — a listener by that name on this
   * element would also hear the DOM's `select` event, which a `<textarea>` in
   * the projected content fires, and bubbles, whenever text in it is selected.
   */
  readonly tabSelect = output<string>();
  readonly actionSelect = output<string>();

  /** The one tab that is keyboard reachable (roving tabindex). */
  protected readonly focusId = computed(() => {
    const tabs = this.tabs();
    return (tabs.find((tab) => tab.active) ?? tabs[0])?.id ?? null;
  });

  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  private seenFocus = 0;

  constructor() {
    afterRenderEffect(() => {
      const token = this.bodyFocus();
      const body = this.body()?.nativeElement;
      // Asked while collapsed, the request waits for the body.
      if (token === this.seenFocus || body === undefined) {
        return;
      }
      this.seenFocus = token;
      if (token > 0) {
        (body.querySelector<HTMLElement>(FOCUSABLE) ?? body).focus();
      }
    });
  }
}
