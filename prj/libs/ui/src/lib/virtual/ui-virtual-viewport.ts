import { signal } from '@angular/core';

/**
 * Rendering only what can be seen (PRD 003, §1), shared by the two panel
 * bodies — `UiFileList` rows and `UiIconView` tiles.
 *
 * Both are a list laid out in *lines* of equal height: a table row, or one
 * visual row of tiles. Given how tall a line is, how many entries a line holds
 * and where the scroll container is, `range` says which entries to render; the
 * component draws a spacer for everything above and below, so the scrollbar is
 * the full list's and nothing jumps.
 *
 * Only long lists are windowed (`VIRTUAL_THRESHOLD`). Below that every entry
 * is rendered, exactly as before — which keeps small folders, and every test
 * written against them, independent of layout.
 */

/** Lists this long, and longer, render only what is near the viewport. */
export const VIRTUAL_THRESHOLD = 200;

/** Lines rendered past each edge of the viewport, so a step never lands on nothing. */
const OVERSCAN_LINES = 20;

/**
 * Viewport assumed until one can be measured — a layout-less test, a panel
 * not laid out yet. Generous, so the first frame is never empty.
 */
const FALLBACK_VIEWPORT_LINES = 40;

/** A slice of the list: `[start, end)`. */
export interface UiVirtualRange {
  readonly start: number;
  readonly end: number;
}

/** Which entries to render; everything else is a spacer. */
export function visibleRange(options: {
  readonly total: number;
  /** Height of one line, gap included. */
  readonly lineHeight: number;
  /** Entries per line: 1 for a table, the column count for a grid. */
  readonly perLine: number;
  readonly scrollTop: number;
  readonly viewportHeight: number;
  /** Distance from the top of the scroll content to the first line. */
  readonly leading: number;
}): UiVirtualRange {
  const { total, perLine } = options;
  const lineHeight = Math.max(1, options.lineHeight);
  const lines = Math.ceil(total / Math.max(1, perLine));
  const viewport = options.viewportHeight > 0 ? options.viewportHeight : FALLBACK_VIEWPORT_LINES * lineHeight;
  const top = Math.max(0, options.scrollTop - options.leading);

  const firstLine = Math.max(0, Math.floor(top / lineHeight) - OVERSCAN_LINES);
  const lastLine = Math.min(lines, Math.ceil((top + viewport) / lineHeight) + OVERSCAN_LINES);

  return { start: Math.min(total, firstLine * perLine), end: Math.min(total, lastLine * perLine) };
}

/**
 * The scroll container a list lives in, as signals: where it is scrolled to
 * and how tall it is. The list does not scroll itself — the panel body around
 * it does — so the container is found, not owned.
 */
export class UiVirtualViewport {
  readonly scrollTop = signal(0);
  readonly viewportHeight = signal(0);

  private container: HTMLElement | null = null;
  private detach: (() => void) | null = null;

  /** Starts following the nearest scrolling ancestor of `host`, if there is one. */
  attach(host: HTMLElement): void {
    this.dispose();
    const container = scrollContainerOf(host);
    if (container === null) {
      return;
    }
    this.container = container;

    const update = (): void => {
      this.scrollTop.set(container.scrollTop);
      this.viewportHeight.set(container.clientHeight);
    };
    container.addEventListener('scroll', update, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    resize?.observe(container);
    update();

    this.detach = () => {
      container.removeEventListener('scroll', update);
      resize?.disconnect();
    };
  }

  dispose(): void {
    this.detach?.();
    this.detach = null;
    this.container = null;
  }

  /**
   * Scrolls the container a step when `clientY` is within `edge` pixels of
   * its top or bottom — what a drag near the edge of a list expects.
   */
  autoScroll(clientY: number, edge: number, step: number): void {
    const container = this.container;
    if (container === null) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const delta = clientY < rect.top + edge ? -step : clientY > rect.bottom - edge ? step : 0;
    if (delta !== 0) {
      container.scrollTop += delta;
      this.scrollTop.set(container.scrollTop);
    }
  }

  /** How far below the top of the scroll content `element` starts. */
  offsetOf(element: HTMLElement): number {
    const container = this.container;
    if (container === null) {
      return 0;
    }
    return element.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  }

  /**
   * Scrolls just enough for `[top, top + height)` to be visible — the way the
   * browser does for an element it focuses, but for one that is not rendered
   * yet. The signal moves at once, so the next render already includes it.
   */
  reveal(top: number, height: number): void {
    const viewport = this.viewportHeight();
    const current = this.scrollTop();
    let next = current;
    if (top < current) {
      next = top;
    } else if (viewport > 0 && top + height > current + viewport) {
      next = top + height - viewport;
    } else if (viewport === 0) {
      next = top;
    }
    if (next === current) {
      return;
    }
    if (this.container !== null) {
      this.container.scrollTop = next;
    }
    this.scrollTop.set(next);
  }
}

/** The nearest ancestor whose content scrolls vertically. */
function scrollContainerOf(host: HTMLElement): HTMLElement | null {
  for (let node = host.parentElement; node !== null; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') {
      return node;
    }
  }
  return null;
}
