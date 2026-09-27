import { Component, computed, input, output } from '@angular/core';
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
 *
 * Each sidebar may sit at either edge (PRD 010, §3): `leftAt` and `rightAt`
 * say which, and both may be the same — then the two stand side by side, the
 * `left` one outermost, beside the activity bar, which goes wherever the
 * `left` slot goes. The slots keep their names — `left` is the sidebar that
 * goes with the activity bar — and so do the outputs: a drag that widens the
 * `left` sidebar is always the step `leftResize` reported with the sidebar at
 * the left edge, and `rightResize` as with it at the right, whichever edge
 * they are at now. Each sash sits in its sidebar, on the edge that faces the
 * centre.
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

  /** The edge the `left` slot — and the activity bar with it — sits at. */
  readonly leftAt = input<'left' | 'right'>('left');

  /** The edge the `right` slot sits at. */
  readonly rightAt = input<'left' | 'right'>('right');

  /** Accessible names for the sashes: what each resizes. */
  readonly leftSashLabel = input<string>('Resize left sidebar');
  readonly rightSashLabel = input<string>('Resize right sidebar');

  /*
   * Where each region goes along the row, as flex `order`: from the left
   * edge in, the activity bar, the `left` slot, the `right` slot, then the
   * centre (5) — and mirrored past it for whatever is at the right edge.
   */
  protected readonly activityOrder = computed(() => (this.leftAt() === 'left' ? 0 : 10));
  protected readonly leftOrder = computed(() => (this.leftAt() === 'left' ? 1 : 9));
  protected readonly rightOrder = computed(() => (this.rightAt() === 'left' ? 2 : 8));

  /** One step of a drag on the sash right of the left sidebar. */
  readonly leftResize = output<UiSashResize>();

  /** One step of a drag on the sash left of the right sidebar. */
  readonly rightResize = output<UiSashResize>();

  /**
   * A sash's step, as the output reports it: turned round when the sidebar is
   * at the other edge from its slot's name, since its sash then is too.
   */
  protected resized(slot: 'left' | 'right', event: UiSashResize): void {
    const moved = slot === 'left' ? this.leftAt() === 'right' : this.rightAt() === 'left';
    const step = moved ? { ...event, delta: -event.delta } : event;
    (slot === 'left' ? this.leftResize : this.rightResize).emit(step);
  }
}
