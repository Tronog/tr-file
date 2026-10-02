import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { clampZoom } from './window-zoom.js';

/** A rectangle on the desktop, in screen pixels — Electron's `Rectangle`. */
export interface WindowRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How the window was left (PRD 001, §8.2.1): its size and place when neither
 * maximised nor full screen — what it goes back to when restored — and
 * whether it was either. Never minimised: a window that comes back minimised
 * looks like one that did not start.
 */
export interface WindowState {
  /** The restored window's place; absent until it has had one, when the OS centres it. */
  readonly x?: number;
  readonly y?: number;
  readonly width: number;
  readonly height: number;
  readonly maximized: boolean;
  readonly fullScreen: boolean;
  /** The page's zoom factor (PRD 001, §8.2.3); `1` when never zoomed. */
  readonly zoom: number;
}

/** A window on first start. */
export const DEFAULT_WINDOW_STATE: WindowState = { width: 1440, height: 900, maximized: false, fullScreen: false, zoom: 1 };

/** The smallest the window may be; `MainWindow` says the same to Electron. */
export const MIN_WINDOW_SIZE = { width: 800, height: 560 } as const;

/** How much of a window's title bar must lie on a screen for its place to be kept. */
const VISIBLE_EDGE = 64;

/** How long after the last move or resize the state is written. */
const SAVE_DELAY_MS = 500;

/**
 * The window's state, kept in a small JSON file of the main process's own in
 * the user-data folder — not in the page's settings, which are the page's
 * business and cleared by its *Reset Layout*.
 *
 * Read once when the window opens; written a moment after each change, and at
 * once when the window closes — synchronously then, as the app may be on its
 * way out. Through a temporary file and a rename, so a crash mid-write leaves
 * the previous state. Nothing here imports `electron`.
 */
export class WindowStateFile {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private latest: WindowState | null = null;

  constructor(private readonly file: string) {}

  /** The state last kept, or the default for a missing or broken file. */
  read(): WindowState {
    try {
      return WindowStateFile.parse(JSON.parse(readFileSync(this.file, 'utf8')) as unknown);
    } catch {
      return DEFAULT_WINDOW_STATE;
    }
  }

  /** Keeps `state`, a moment from now: moving a window is many events, one write. */
  keep(state: WindowState): void {
    this.latest = state;
    if (this.timer === null) {
      this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
      this.timer.unref?.();
    }
  }

  /** Writes what is waiting, now. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const state = this.latest;
    if (state === null) {
      return;
    }
    this.latest = null;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(state), 'utf8');
      renameSync(temporary, this.file);
    } catch {
      // Not remembering where the window was is no reason to fail anything.
    }
  }

  /** Only what holds together: whole, positive numbers where they belong. */
  static parse(value: unknown): WindowState {
    if (typeof value !== 'object' || value === null) {
      return DEFAULT_WINDOW_STATE;
    }
    const raw = value as Record<string, unknown>;
    const size = (key: 'width' | 'height'): number => {
      const number = raw[key];
      return typeof number === 'number' && Number.isFinite(number) && number >= MIN_WINDOW_SIZE[key]
        ? Math.round(number)
        : DEFAULT_WINDOW_STATE[key];
    };
    const place = typeof raw['x'] === 'number' && typeof raw['y'] === 'number' && Number.isFinite(raw['x']) && Number.isFinite(raw['y'])
      ? { x: Math.round(raw['x']), y: Math.round(raw['y']) }
      : {};
    return {
      ...place,
      width: size('width'),
      height: size('height'),
      maximized: raw['maximized'] === true,
      fullScreen: raw['fullScreen'] === true,
      zoom: clampZoom(raw['zoom']),
    };
  }
}

/**
 * `state` fitted to the screens there are now: a window left on a monitor
 * since unplugged, or a larger one, would come back where nobody can reach
 * it. Kept where it was if enough of its top edge lies on some screen's work
 * area to grab it by; otherwise centred on the first screen (the OS does that
 * when there is no place). Never larger than the screen it ends up on.
 */
export function fitToScreens(state: WindowState, workAreas: readonly WindowRect[]): WindowState {
  const primary = workAreas[0];
  if (primary === undefined) {
    return state;
  }
  const { x, y, ...rest } = state;
  const reachable =
    x !== undefined &&
    y !== undefined &&
    workAreas.some(
      (area) =>
        y >= area.y &&
        y < area.y + area.height - VISIBLE_EDGE / 2 &&
        Math.min(x + state.width, area.x + area.width) - Math.max(x, area.x) >= VISIBLE_EDGE,
    );
  const screen = reachable ? (workAreas.find((area) => x >= area.x && x < area.x + area.width) ?? primary) : primary;
  const width = Math.min(state.width, Math.max(screen.width, MIN_WINDOW_SIZE.width));
  const height = Math.min(state.height, Math.max(screen.height, MIN_WINDOW_SIZE.height));
  return reachable ? { ...rest, x, y, width, height } : { ...rest, width, height };
}
