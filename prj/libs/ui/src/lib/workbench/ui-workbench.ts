import { Component, input, output } from '@angular/core';
import { UiIconSprite } from '../icon/ui-icon-sprite';
import { UiSash } from '../sash/ui-sash';
import type { UiSashResize } from '../models';

/**
 * The workbench shell: title bar / body / status bar, with the body laid out as
 * activity bar, left sidebar, sash, centre, sash, right sidebar.
 *
 * Content arrives through the `[uiSlot=…]` attribute selectors. Every slot is
 * projected unconditionally — hiding a sidebar only toggles `display` on its
 * wrapper, so the projected view keeps its state (scroll position, focus,
 * expanded nodes) across a hide/show cycle.
 *
 * The two sidebar sashes are rendered here but owned by the caller: the shell
 * forwards every drag step as `leftResize` / `rightResize` and never changes a
 * width itself.
 */
@Component({
  selector: 'ui-workbench',
  imports: [UiIconSprite, UiSash],
  templateUrl: './ui-workbench.html',
  styleUrl: './ui-workbench.scss',
})
export class UiWorkbench {
  /** Width of the left sidebar in px. */
  readonly leftWidth = input<number>(280);

  /** Width of the right sidebar in px. */
  readonly rightWidth = input<number>(320);

  readonly leftVisible = input<boolean>(true);

  readonly rightVisible = input<boolean>(true);

  /** Bounds the left sidebar may be dragged between, in px — announced by its sash. */
  readonly leftMin = input<number>(180);

  readonly leftMax = input<number>(520);

  /** Bounds the right sidebar may be dragged between, in px — announced by its sash. */
  readonly rightMin = input<number>(180);

  readonly rightMax = input<number>(520);

  /** One step of a drag on the sash right of the left sidebar. */
  readonly leftResize = output<UiSashResize>();

  /** One step of a drag on the sash left of the right sidebar. */
  readonly rightResize = output<UiSashResize>();
}
