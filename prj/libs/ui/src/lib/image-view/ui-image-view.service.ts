import { Service, computed, signal } from '@angular/core';

/**
 * How the image is sized. The first three are *fits*, recomputed whenever the
 * viewport or the image changes; `free` is whatever zooming left behind.
 */
export type UiImageZoom = 'contain' | 'cover' | 'actual' | 'free';

/** A point, in CSS pixels. */
export interface UiImagePoint {
  readonly x: number;
  readonly y: number;
}

const ORIGIN: UiImagePoint = { x: 0, y: 0 };

/** How far one notch of the wheel zooms; tuned to feel like a photo viewer. */
const WHEEL_SENSITIVITY = 0.0015;

/** What a `+` / `-` press multiplies or divides the scale by. */
const STEP = 1.25;

const MIN_SCALE = 0.02;
const MAX_SCALE = 64;

/**
 * The image viewer's model: what is being shown, at what scale, and where
 * (PRD 001, §7.3.1).
 *
 * Provided by `UiImageView` itself rather than in the application, so every
 * viewer has its own — two images open in two panels zoom independently, and
 * nothing outside a viewer can reach the state of another. That is also why
 * this is the one service in a library of otherwise purely presentational
 * components: it holds a component's own model, not the application's.
 *
 * The whole design is one number. The image is drawn at its natural size and
 * transformed, so `contain`, `cover` and `actual` are three ways of computing
 * `scale`, and panning is a `translate`. A wheel or a drag switches to `free`,
 * which keeps whatever the gesture produced — so the fit buttons stay
 * meaningful rather than becoming a mode the viewer is stuck in.
 */
@Service()
export class UiImageViewService {
  /** The image's own pixel size; unknown until it has loaded. */
  private readonly natural = signal<UiImagePoint>(ORIGIN);

  /** The viewport's pixel size, as last measured. */
  private readonly viewport = signal<UiImagePoint>(ORIGIN);

  /** The scale a gesture left behind; only read while `zoom` is `free`. */
  private readonly freeScale = signal(1);

  /** Pan, before clamping. Reset by anything that re-fits the image. */
  private readonly pan = signal<UiImagePoint>(ORIGIN);

  readonly zoom = signal<UiImageZoom>('contain');

  /** The scale actually applied; `1` until the image has loaded. */
  readonly scale = computed(() => {
    const zoom = this.zoom();
    return zoom === 'free' ? this.freeScale() : this.fitScale(zoom);
  });

  /** Percentage shown beside the buttons, e.g. `'42%'`. */
  readonly zoomLabel = computed(() => `${Math.round(this.scale() * 100)}%`);

  /**
   * Whether the image overflows the viewport, and can therefore be panned.
   * Also what turns the grab cursor on.
   */
  readonly pannable = computed(() => {
    const { x: width, y: height } = this.scaledSize();
    const view = this.viewport();
    return width - view.x > 1 || height - view.y > 1;
  });

  /** The clamped pan and the scale, as one CSS transform. */
  readonly transform = computed(() => {
    const { x, y } = this.clampedPan();
    return `translate(${x}px, ${y}px) scale(${this.scale()})`;
  });

  /** Whether `zoom` is currently this fit. */
  isFit(zoom: UiImageZoom): boolean {
    return this.zoom() === zoom;
  }

  /* -- what the viewer reports -------------------------------------------- */

  /** The viewport was measured, or re-measured after a resize. */
  measure(width: number, height: number): void {
    this.viewport.set({ x: width, y: height });
  }

  /** The image decoded, and its natural size is finally known. */
  loaded(width: number, height: number): void {
    this.natural.set({ x: width, y: height });
  }

  /** A new image: start again at the default fit rather than inheriting one. */
  reset(): void {
    this.natural.set(ORIGIN);
    this.zoom.set('contain');
    this.pan.set(ORIGIN);
  }

  /** Whether anything is known well enough to zoom yet. */
  get ready(): boolean {
    return this.natural().x > 0;
  }

  /* -- what the controls and gestures do ---------------------------------- */

  fit(zoom: 'contain' | 'cover' | 'actual'): void {
    this.zoom.set(zoom);
    this.pan.set(ORIGIN);
  }

  /** One press of `+` or `-`, anchored on the middle of the viewport. */
  step(direction: 1 | -1): void {
    this.zoomTo(this.scale() * (direction === 1 ? STEP : 1 / STEP), this.viewportCentre());
  }

  /** One notch of the wheel, anchored under the pointer. */
  wheel(deltaY: number, anchor: UiImagePoint): void {
    this.zoomTo(this.scale() * Math.exp(-deltaY * WHEEL_SENSITIVITY), anchor);
  }

  /** The pan a drag should start from: whatever is on screen right now. */
  panOrigin(): UiImagePoint {
    return this.clampedPan();
  }

  /**
   * Moves the view by `dx`, `dy` over an image larger than it — an arrow key
   * (PRD 012, §1.2): positive shows more of the right and the bottom, as
   * scrolling would. `false` when there was nowhere to go that way.
   */
  panBy(dx: number, dy: number): boolean {
    const from = this.clampedPan();
    this.pan.set({ x: from.x - dx, y: from.y - dy });
    const to = this.clampedPan();
    return to.x !== from.x || to.y !== from.y;
  }

  /** Moves the image; the clamp is applied when it is read back. */
  panTo(point: UiImagePoint): void {
    this.pan.set(point);
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
  private zoomTo(target: number, anchor: UiImagePoint): void {
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

  private scaledSize(): UiImagePoint {
    const natural = this.natural();
    const scale = this.scale();
    return { x: natural.x * scale, y: natural.y * scale };
  }

  /**
   * The pan, held inside the range that keeps the image covering the viewport.
   * An axis whose image is smaller than the viewport is pinned to centre, so a
   * small image never drifts.
   */
  private clampedPan(): UiImagePoint {
    const size = this.scaledSize();
    const view = this.viewport();
    const pan = this.pan();
    const slack = (extent: number, available: number): number =>
      Math.max((extent - available) / 2, 0);

    const x = slack(size.x, view.x);
    const y = slack(size.y, view.y);
    return {
      x: Math.min(Math.max(pan.x, -x), x),
      y: Math.min(Math.max(pan.y, -y), y),
    };
  }

  private viewportCentre(): UiImagePoint {
    const view = this.viewport();
    return { x: view.x / 2, y: view.y / 2 };
  }
}
