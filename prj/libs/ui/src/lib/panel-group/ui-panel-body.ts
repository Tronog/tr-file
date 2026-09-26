import { DestroyRef, Directive, ElementRef, inject } from '@angular/core';
import { UiPanelGroup } from './ui-panel-group';

/**
 * Marks the element of a panel's content that *is* its body — the part below
 * whatever chrome the content puts above it (a path bar, a toolbar).
 *
 * `UiPanelGroup` hosts content it knows nothing about, so this is how the two
 * agree on the two things the group does to its body:
 *
 * - **focus** — asked to focus its body, the group looks for the tab stop
 *   (`tabindex="0"`) inside this element, and focuses the element itself when
 *   there is none, so an empty body still keeps the keyboard in the panel;
 * - **blank presses** — a press on this element, rather than on anything
 *   focusable in it, is a press on the body's empty space (`bodyPress`). A
 *   press on the chrome above it is not.
 *
 * The group is found by injection, which reaches it because the content is
 * projected into it. Content rendered outside a group simply has no one to
 * tell, and the marker does nothing but make the element focusable.
 */
@Directive({
  selector: '[uiPanelBody]',
  host: { tabindex: '-1' },
})
export class UiPanelBody {
  constructor() {
    const group = inject(UiPanelGroup, { optional: true });
    if (!group) {
      return;
    }

    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    group.attachContentBody(element);
    inject(DestroyRef).onDestroy(() => group.detachContentBody(element));
  }
}
