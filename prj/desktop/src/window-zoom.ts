/**
 * The window's zoom (PRD 001, §8.2.3), as a factor of the page's own size:
 * `1` is 100 %. Nothing here imports `electron`.
 *
 * Zoom in / out step through the levels a browser does, so a window zoomed
 * one way and back again is where it was; the slider sets any whole percent
 * between the ends.
 */
export const ZOOM_LEVELS: readonly number[] = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export const MIN_ZOOM = ZOOM_LEVELS[0] as number;
export const MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1] as number;

/** `factor` within the ends, to a whole percent; anything that is not a number is 100 %. */
export function clampZoom(factor: unknown): number {
  if (typeof factor !== 'number' || !Number.isFinite(factor)) {
    return 1;
  }
  return Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, factor)) * 100) / 100;
}

/**
 * The next level up (`1`) or down (`-1`) from `factor` — from a level, the
 * one beside it; from between two (the slider's), the nearer one that way.
 */
export function stepZoom(factor: number, by: 1 | -1): number {
  const current = clampZoom(factor);
  const next = by === 1 ? ZOOM_LEVELS.find((level) => level > current + 0.001) : [...ZOOM_LEVELS].reverse().find((level) => level < current - 0.001);
  return next ?? current;
}
