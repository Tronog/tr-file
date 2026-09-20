import {
  Component,
  effect,
  inject,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { UiIconButton } from '../controls/ui-icon-button';
import { UiImageViewService } from './ui-image-view.service';

/**
 * The read-only image viewer (PRD 001, §7.3.1).
 *
 * Deliberately thin, per `docs/ai/ANGULAR.md`: what the viewer *is* — the
 * scale, the pan, every fit and the arithmetic that holds a point still under
 * the pointer — lives in `UiImageViewService`, which this component provides
 * one of. All that is left here is the part only a component can do: the
 * elements, the `ResizeObserver`, and turning DOM events into calls.
 *
 * What it never does is fetch or revoke `src`. The bytes belong to whoever
 * made the URL; the library only draws them.
 *
 * `interactive` is the difference between the viewer in a panel and the
 * thumbnail in the details sidebar (§9). A static preview has no controls, no
 * gestures and no tab stop — it is a picture, not something to operate.
 */
@Component({
  selector: 'ui-image-view',
  imports: [UiIconButton],
  providers: [UiImageViewService],
  templateUrl: './ui-image-view.html',
  styleUrl: './ui-image-view.scss',
  host: {
    '[class.is-static]': '!interactive()',
  },
})
export class UiImageView {
  /** A URL the browser can load; the application owns its lifetime. */
  readonly src = input.required<string>();

  /** Accessible name of the image — in practice the file's path. */
  readonly label = input<string>('Image');

  /**
   * Whether this is a viewer or a thumbnail. `false` drops the controls, the
   * gestures and the tab stop, leaving the default `contain` fit.
   */
  readonly interactive = input<boolean>(true);

  /** The model every binding below reads; one per viewer. */
  protected readonly view = inject(UiImageViewService);

  private readonly viewportRef = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly imageRef = viewChild.required<ElementRef<HTMLImageElement>>('image');

  /** Pointer id of a drag in progress, or `null`. A signal: the cursor follows it. */
  protected readonly dragging = signal<number | null>(null);

  private dragFrom = { x: 0, y: 0 };
  private panFrom = { x: 0, y: 0 };

  constructor() {
    // The element only exists after the first render; `effect` is the seam
    // that waits for it without an ngOnInit in a signal-based component.
    effect((onCleanup) => {
      const element = this.viewportRef().nativeElement;
      this.measure(element);

      if (typeof ResizeObserver === 'undefined') {
        return;
      }
      const observer = new ResizeObserver(() => this.measure(element));
      observer.observe(element);
      onCleanup(() => observer.disconnect());
    });

    // A different file in the same viewer starts fresh.
    effect(() => {
      this.src();
      this.view.reset();
    });
  }

  /* -- gestures ----------------------------------------------------------- */

  /**
   * Wheel zoom, anchored under the pointer: the pixel someone is pointing at
   * stays put, which is what makes zooming into a corner of a photo work.
   */
  protected onWheel(event: WheelEvent): void {
    if (!this.interactive() || !this.view.ready) {
      return;
    }
    event.preventDefault();
    this.view.wheel(event.deltaY, this.pointerAt(event));
  }

  protected onPointerDown(event: PointerEvent): void {
    if (!this.interactive() || !this.view.pannable() || event.button !== 0) {
      return;
    }

    this.dragging.set(event.pointerId);
    this.dragFrom = { x: event.clientX, y: event.clientY };
    this.panFrom = this.view.panOrigin();
    // Keeps the drag alive outside the viewport; jsdom has no implementation.
    this.viewportRef().nativeElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.dragging() !== event.pointerId) {
      return;
    }
    this.view.panTo({
      x: this.panFrom.x + (event.clientX - this.dragFrom.x),
      y: this.panFrom.y + (event.clientY - this.dragFrom.y),
    });
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.dragging() !== event.pointerId) {
      return;
    }
    this.dragging.set(null);
    this.viewportRef().nativeElement.releasePointerCapture?.(event.pointerId);
  }

  /** Double click returns to the default fit, as the PRD asks. */
  protected onDoubleClick(): void {
    if (this.interactive()) {
      this.view.fit('contain');
    }
  }

  protected onLoad(): void {
    const image = this.imageRef().nativeElement;
    this.view.loaded(image.naturalWidth, image.naturalHeight);
    this.measure(this.viewportRef().nativeElement);
  }

  /* -- internals ---------------------------------------------------------- */

  /** A wheel event's position, relative to the viewport's top-left corner. */
  private pointerAt(event: WheelEvent): { x: number; y: number } {
    const rect = this.viewportRef().nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private measure(element: HTMLElement): void {
    this.view.measure(element.clientWidth, element.clientHeight);
  }
}
