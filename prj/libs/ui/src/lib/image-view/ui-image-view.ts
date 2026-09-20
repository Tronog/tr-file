import {
  Component,
  computed,
  effect,
  input,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import { UiIconButton } from '../controls/ui-icon-button';

/**
 * How the image is sized. The first three are *fits*, recomputed whenever the
 * viewport or the image changes; `free` is whatever zooming left behind.
 */
export type UiImageZoom = 'contain' | 'cover' | 'actual' | 'free';

/** A point, in CSS pixels. */
interface Point {
  readonly x: number;
  readonly y: number;
}

const ORIGIN: Point = { x: 0, y: 0 };

/** How far one notch of the wheel zooms; tuned to feel like a photo viewer. */
const WHEEL_SENSITIVITY = 0.0015;

/** What a `+` / `-` press multiplies or divides the scale by. */
const STEP = 1.25;

const MIN_SCALE = 0.02;
const MAX_SCALE = 64;

/**
 * The read-only image viewer (PRD 001, §7.3.1).
 *
 * One model does all five controls: the image is drawn at its natural size and
 * transformed, and `contain`, `cover` and `actual` are simply three ways of
 * computing that scale. Wheeling or panning switches to `free`, which keeps
 * whatever scale the gesture produced — so the fit buttons stay meaningful
 * rather than becoming a mode the viewer is stuck in.
 *
 * The state is the transient kind a gesture owns, like the drag state
 * elsewhere in this library: nothing outside the viewer cares how far someone
 * has zoomed, and threading it through the application would buy nothing. What
 * the viewer never does is fetch or revoke `src` — the bytes belong to whoever
 * made the URL.
 *
 * The offset is clamped on the way out rather than on the way in, so a drag
 * can never leave the image parked off-screen, and an image smaller than the
 * viewport is simply centred.
 */
@Component({
  selector: 'ui-image-view',
  imports: [UiIconButton],
  templateUrl: './ui-image-view.html',
  styleUrl: './ui-image-view.scss',
})
export class UiImageView {
  /** A URL the browser can load; the application owns its lifetime. */
  readonly src = input.required<string>();

  /** Accessible name of the image — in practice the file's path. */
  readonly label = input<string>('Image');

  private readonly viewportRef = viewChild.required<ElementRef<HTMLElement>>('viewport');
  private readonly imageRef = viewChild.required<ElementRef<HTMLImageElement>>('image');

  /** The image's own pixel size; unknown until it has loaded. */
  private readonly natural = signal<Point>(ORIGIN);

  /** The viewport's pixel size, followed by a `ResizeObserver` where there is one. */
  private readonly viewport = signal<Point>(ORIGIN);

  protected readonly zoom = signal<UiImageZoom>('contain');

  /** The scale a gesture left behind; only read while `zoom` is `free`. */
  private readonly freeScale = signal(1);

  /** Pan, before clamping. Reset by anything that re-fits the image. */
  private readonly pan = signal<Point>(ORIGIN);

  private observer: ResizeObserver | undefined;

  /** Pointer id of a drag in progress, or `null`. A signal: the cursor follows it. */
  protected readonly dragging = signal<number | null>(null);
  private dragFrom: Point = ORIGIN;
  private panFrom: Point = ORIGIN;

  constructor() {
    // The element only exists after the first render; `effect` is the seam
    // that waits for it without an ngOnInit in a signal-based component.
    effect((onCleanup) => {
      const element = this.viewportRef().nativeElement;
      this.measure(element);

      if (typeof ResizeObserver === 'undefined') {
        return;
      }
      this.observer = new ResizeObserver(() => this.measure(element));
      this.observer.observe(element);
      onCleanup(() => this.observer?.disconnect());
    });

    // A different file in the same viewer starts fresh, rather than inheriting
    // the zoom someone left on the last one.
    effect(() => {
      this.src();
      this.natural.set(ORIGIN);
      this.zoom.set('contain');
      this.pan.set(ORIGIN);
    });
  }

  /** The scale actually applied; `1` until the image has loaded. */
  protected readonly scale = computed(() => {
    const zoom = this.zoom();
    return zoom === 'free' ? this.freeScale() : this.fitScale(zoom);
  });

  /** Percentage shown beside the buttons, e.g. `'42%'`. */
  protected readonly zoomLabel = computed(() => `${Math.round(this.scale() * 100)}%`);

  /**
   * Whether the image overflows the viewport, and can therefore be panned.
   * Also what turns the grab cursor on.
   */
  protected readonly pannable = computed(() => {
    const { x: width, y: height } = this.scaledSize();
    const view = this.viewport();
    return width - view.x > 1 || height - view.y > 1;
  });

  /** The clamped pan, as a CSS transform. */
  protected readonly transform = computed(() => {
    const { x, y } = this.clampedPan();
    return `translate(${x}px, ${y}px) scale(${this.scale()})`;
  });

  protected readonly isFit = (zoom: UiImageZoom): boolean => this.zoom() === zoom;

  /* -- controls ----------------------------------------------------------- */

  protected fit(zoom: 'contain' | 'cover' | 'actual'): void {
    this.zoom.set(zoom);
    this.pan.set(ORIGIN);
  }

  protected step(direction: 1 | -1): void {
    this.zoomTo(this.scale() * (direction === 1 ? STEP : 1 / STEP), this.viewportCentre());
  }

  /* -- gestures ----------------------------------------------------------- */

  /**
   * Wheel zoom, anchored under the pointer: the pixel someone is pointing at
   * stays put, which is what makes zooming into a corner of a photo work.
   */
  protected onWheel(event: WheelEvent): void {
    if (this.natural().x === 0) {
      return;
    }
    event.preventDefault();
    this.zoomTo(this.scale() * Math.exp(-event.deltaY * WHEEL_SENSITIVITY), this.pointerAt(event));
  }

  protected onPointerDown(event: PointerEvent): void {
    if (!this.pannable() || event.button !== 0) {
      return;
    }

    this.dragging.set(event.pointerId);
    this.dragFrom = { x: event.clientX, y: event.clientY };
    this.panFrom = this.clampedPan();
    // Keeps the drag alive outside the viewport; jsdom has no implementation.
    this.viewportRef().nativeElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.dragging() !== event.pointerId) {
      return;
    }
    this.pan.set({
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
    this.fit('contain');
  }

  protected onLoad(): void {
    const image = this.imageRef().nativeElement;
    this.natural.set({ x: image.naturalWidth, y: image.naturalHeight });
    this.measure(this.viewportRef().nativeElement);
  }

  /* -- internals ---------------------------------------------------------- */

  /**
   * Sets a new scale while holding `anchor` — a point in viewport coordinates
   * — still on screen.
   *
   * With a centred transform origin, a point `p` of the image is drawn at
   * `centre + pan + p * scale`. Solving that for the pan that keeps `anchor`
   * fixed across a scale change gives the expression below.
   */
  private zoomTo(target: number, anchor: Point): void {
    const from = this.scale();
    const to = Math.min(Math.max(target, MIN_SCALE), MAX_SCALE);
    if (to === from) {
      return;
    }

    const centre = this.viewportCentre();
    const pan = this.clampedPan();
    const ratio = to / from;

    this.freeScale.set(to);
    this.zoom.set('free');
    this.pan.set({
      x: anchor.x - centre.x - (anchor.x - centre.x - pan.x) * ratio,
      y: anchor.y - centre.y - (anchor.y - centre.y - pan.y) * ratio,
    });
  }

  private fitScale(zoom: 'contain' | 'cover' | 'actual'): number {
    if (zoom === 'actual') {
      return 1;
    }
    const natural = this.natural();
    const view = this.viewport();
    if (natural.x === 0 || natural.y === 0 || view.x === 0 || view.y === 0) {
      return 1;
    }

    const horizontal = view.x / natural.x;
    const vertical = view.y / natural.y;
    return zoom === 'contain' ? Math.min(horizontal, vertical) : Math.max(horizontal, vertical);
  }

  private scaledSize(): Point {
    const natural = this.natural();
    const scale = this.scale();
    return { x: natural.x * scale, y: natural.y * scale };
  }

  /**
   * The pan, held inside the range that keeps the image covering the viewport.
   * An axis whose image is smaller than the viewport is pinned to centre, so a
   * small image never drifts.
   */
  private clampedPan(): Point {
    const size = this.scaledSize();
    const view = this.viewport();
    const pan = this.pan();
    const limit = (extent: number, available: number): number =>
      Math.max((extent - available) / 2, 0);

    const x = limit(size.x, view.x);
    const y = limit(size.y, view.y);
    return {
      x: Math.min(Math.max(pan.x, -x), x),
      y: Math.min(Math.max(pan.y, -y), y),
    };
  }

  private viewportCentre(): Point {
    const view = this.viewport();
    return { x: view.x / 2, y: view.y / 2 };
  }

  /** A wheel event's position, relative to the viewport's top-left corner. */
  private pointerAt(event: WheelEvent): Point {
    const rect = this.viewportRef().nativeElement.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private measure(element: HTMLElement): void {
    this.viewport.set({ x: element.clientWidth, y: element.clientHeight });
  }
}
