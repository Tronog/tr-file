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
  show(): void;
  hide(): void;
  restore(): void;
  focus(): void;
}

/**
 * One press of the shortcut, the way a drop-down terminal behaves: a window
 * the user is looking at — shown, not minimised, focused — goes away; any
 * other — hidden, minimised, or behind another app's — comes to the front
 * with the keyboard. So the key always does what the user means by it: out of
 * the way when it is in the way, here when it is wanted.
 */
export function toggleVisibility(window: ToggleableWindow): 'shown' | 'hidden' {
  if (window.isVisible() && !window.isMinimized() && window.isFocused()) {
    window.hide();
    return 'hidden';
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
  return 'shown';
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
