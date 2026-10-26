/**
 * The global shortcut that shows and hides the window (PRD 001, §8.5):
 * `Ctrl`+`` ` `` — `Control` on macOS too, where `Cmd`+`` ` `` already cycles
 * an app's windows and is not ours to take.
 */
export const VISIBILITY_ACCELERATOR = 'Control+`';

/** What toggling needs of a window — a `BrowserWindow` has all of it. */
export interface ToggleableWindow {
  isVisible(): boolean;
  isFocused(): boolean;
  isMinimized(): boolean;
  isDestroyed(): boolean;
  show(): void;
  hide(): void;
  restore(): void;
  focus(): void;
  setAlwaysOnTop(flag: boolean): void;
}

/** How long a window manager is given to grant a focus request before it is asked another way. */
export const FOCUS_SETTLE_MS = 150;

/** Waits; injected so tests need not. */
export type Settle = (ms: number) => Promise<void>;

const settleFor: Settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How bringing the window forward went: `focused` at the first ask, `remapped`
 * once shown afresh, or `refused` by a window manager that would not have it.
 */
export type ForwardOutcome = 'focused' | 'remapped' | 'refused';

/**
 * Brings an open window to the front with the keyboard (PRD 001, §8.5.1) —
 * whether it is hidden, minimised or behind another app's.
 *
 * `focus()` alone is a request a window manager may turn down, and the ones
 * that guard against focus stealing do just that for an app that is not in
 * front, which is exactly when this is asked:
 * - Windows lets a background process only flash its taskbar button, but a
 *   window made topmost for a moment stays above the others when it is let go,
 *   and takes the focus with it.
 * - GNOME on Wayland answers with a "tr-file is ready" notice instead. A
 *   window that is *mapped* is given the focus, though, so a window still not
 *   focused a moment later is hidden and shown again.
 * - macOS needs the app made frontmost; the caller does that (`app.focus`).
 */
export async function bringForward(window: ToggleableWindow, platform: NodeJS.Platform, settle: Settle = settleFor): Promise<ForwardOutcome> {
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  if (platform === 'win32') {
    window.setAlwaysOnTop(true);
    window.focus();
    window.setAlwaysOnTop(false);
  } else {
    window.focus();
  }
  if (platform !== 'linux') {
    return 'focused';
  }

  // Focus arrives asynchronously from the compositor: look again a moment later.
  await settle(FOCUS_SETTLE_MS);
  // Closed, or hidden again by a second press meanwhile: nothing left to do.
  if (window.isDestroyed() || !window.isVisible() || window.isFocused()) {
    return 'focused';
  }
  window.hide();
  window.show();
  window.focus();
  await settle(FOCUS_SETTLE_MS);
  return window.isDestroyed() || window.isFocused() ? 'remapped' : 'refused';
}

/**
 * One press of the shortcut, the way a drop-down terminal behaves: a window
 * the user is looking at — shown, not minimised, focused — goes away; any
 * other — hidden, minimised, or behind another app's — comes to the front
 * with the keyboard (`bringForward`). So the key always does what the user
 * means by it: out of the way when it is in the way, here when it is wanted.
 */
export async function toggleVisibility(
  window: ToggleableWindow,
  platform: NodeJS.Platform,
  settle: Settle = settleFor,
): Promise<'hidden' | ForwardOutcome> {
  if (window.isVisible() && !window.isMinimized() && window.isFocused()) {
    window.hide();
    return 'hidden';
  }
  return bringForward(window, platform, settle);
}

/** Electron's `globalShortcut`, as far as this needs it — injected, so nothing here imports `electron`. */
export interface GlobalShortcuts {
  register(accelerator: string, callback: () => void): boolean;
  unregister(accelerator: string): void;
}

/**
 * Registers the visibility shortcut system-wide, and takes it back on quit.
 * Another app may own the chord already, or a Wayland session may not offer
 * global shortcuts at all: then the app says so in its log and runs without
 * it, rather than failing to start.
 */
export class VisibilityShortcut {
  private registered = false;

  constructor(
    private readonly shortcuts: GlobalShortcuts,
    private readonly toggle: () => void,
    private readonly warn: (message: string, fields: Record<string, unknown>) => void,
    readonly accelerator: string = VISIBILITY_ACCELERATOR,
  ) {}

  register(): boolean {
    if (this.registered) {
      return true;
    }
    try {
      this.registered = this.shortcuts.register(this.accelerator, this.toggle);
    } catch (error) {
      this.registered = false;
      this.warn('global shortcut could not be registered', {
        accelerator: this.accelerator,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
    if (!this.registered) {
      this.warn('global shortcut is taken by another application', { accelerator: this.accelerator });
    }
    return this.registered;
  }

  dispose(): void {
    if (this.registered) {
      this.shortcuts.unregister(this.accelerator);
      this.registered = false;
    }
  }
}
