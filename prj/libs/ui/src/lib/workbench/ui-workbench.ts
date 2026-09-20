import { Component, input } from '@angular/core';
import { UiIconSprite } from '../icon/ui-icon-sprite';
import { UiSash } from '../sash/ui-sash';

/**
 * The workbench shell: title bar / body / status bar, with the body laid out as
 * activity bar, left sidebar, sash, centre, sash, right sidebar.
 *
 * Content arrives through the `[uiSlot=…]` attribute selectors. Every slot is
 * projected unconditionally — hiding a sidebar only toggles `display` on its
 * wrapper, so the projected view keeps its state (scroll position, focus,
 * expanded nodes) across a hide/show cycle.
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
}
