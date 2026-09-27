import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, shell } from 'electron';

import { DARK_BACKGROUND } from './window-background.js';
import { toggleVisibility } from './window-visibility.js';
import { WINDOW_STATE_EVENT, WindowControlsChannel } from './window-controls.channel.js';

/**
 * The compiled preload, beside this file. CommonJS (`.cjs`) because a
 * sandboxed preload has to be, while the rest of the shell is ESM.
 */
const PRELOAD = fileURLToPath(new URL('./preload.cjs', import.meta.url));

/**
 * The application window, and the rules about what may happen inside it.
 *
 * The renderer is the ordinary Angular app, so it gets a browser's powers and
 * not one more: no `nodeIntegration`, context isolation and the sandbox both
 * on. That is not belt and braces — this app hands a web page a view of the
 * user's home directory.
 *
 * The one thing it is given is the preload of PRD 001 §8.1, which puts a
 * single `invoke` function on `window` so the app can reach the backend
 * without HTTP. That function can name exactly one channel and carries no file
 * handles, no paths and no Node; the main process validates every command that
 * arrives through it.
 *
 * Navigation is pinned to the stack's own origin. Anything else — a link in a
 * previewed markdown file, a `window.open` — is handed to the real browser,
 * where the user can see the address bar.
 *
 * Since §8.2 the window has no frame of its own: the Angular title bar is the
 * title bar, drag region and window buttons included. macOS is the exception —
 * `hiddenInset` keeps its traffic lights, which the platform insists on
 * drawing itself, and the app leaves room for them instead of drawing its own.
 * Whichever way, the window's state is pushed to the page whenever it changes,
 * because the OS can maximise a window without anyone clicking a button.
 */
export class MainWindow {
  private window: BrowserWindow | null = null;

  constructor(
    private readonly url: URL,
    /** Whether to open the dev tools; see `DesktopConfig.devTools`. */
    private readonly devTools: boolean,
    /** What is painted before the first frame — the theme's background; see `windowBackground`. */
    private readonly background: string = DARK_BACKGROUND,
  ) {}

  get isOpen(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  /** Creates the window and loads the workbench into it. */
  async open(): Promise<void> {
    if (this.isOpen) {
      this.window?.focus();
      return;
    }

    const window = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 800,
      minHeight: 560,
      title: 'tr-file',
      ...MainWindow.frameOptions(),
      // Painted before the first frame, so the workbench does not flash
      // another colour while the bundle loads — its theme's (PRD 010, §4).
      backgroundColor: this.background,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: PRELOAD,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
      },
    });

    this.window = window;
    this.harden(window);

    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
      this.window = null;
    });
    this.publishState(window);

    await window.loadURL(this.url.href);

    // `ready-to-show` above is the earliest moment the window can appear
    // without flashing an empty frame — but it is not guaranteed to fire, and
    // this frameless window on Linux never does. A window nobody can see is
    // the worst possible failure, so a resolved `loadURL` shows it regardless:
    // the page is loaded by then, so there is nothing left to flash. `show` is
    // idempotent, so whichever happens first wins and the other does nothing.
    if (!window.isDestroyed()) {
      window.show();
    }

    if (this.devTools) {
      window.webContents.openDevTools({ mode: 'detach' });
    }
  }

  focus(): void {
    if (this.window === null || this.window.isDestroyed()) {
      return;
    }
    if (this.window.isMinimized()) {
      this.window.restore();
    }
    // Hidden by the visibility shortcut (PRD 001, §8.5): launching the app again brings it back too.
    if (!this.window.isVisible()) {
      this.window.show();
    }
    this.window.focus();
  }

  /**
   * The global `Ctrl`+`` ` `` (PRD 001, §8.5): hides the window the user is
   * looking at, brings back one that is hidden, minimised or behind another
   * app's. On macOS an app that is not frontmost has to be made so, or the
   * window would come back behind the one the user is in.
   */
  toggleVisibility(): void {
    if (this.window === null || this.window.isDestroyed()) {
      return;
    }
    if (toggleVisibility(this.window) === 'shown' && process.platform === 'darwin') {
      app.focus({ steal: true });
    }
  }

  /**
   * How the window is framed.
   *
   * `frame: false` everywhere but macOS, where `hiddenInset` hides the bar and
   * keeps the traffic lights: there is no way to draw a convincing substitute
   * for them, so the platform keeps that job and the page leaves a gap.
   */
  private static frameOptions(): Electron.BrowserWindowConstructorOptions {
    return process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' }
      : { frame: false };
  }

  /**
   * Tells the page what the window is doing.
   *
   * Not optional: a window can be maximised by a snap gesture, a keyboard
   * shortcut or the OS itself, and the maximise button has to show Restore
   * afterwards whether or not it was the thing that was clicked.
   */
  private publishState(window: BrowserWindow): void {
    const publish = (): void => {
      if (!window.isDestroyed()) {
        window.webContents.send(WINDOW_STATE_EVENT, WindowControlsChannel.stateOf(window));
      }
    };

    // Listed one by one: the overloads of `on` are per event name, so a loop
    // over a union does not type-check.
    window.on('maximize', publish);
    window.on('unmaximize', publish);
    window.on('enter-full-screen', publish);
    window.on('leave-full-screen', publish);
  }

  /** Keeps the renderer on the stack's origin, and popups out of the app. */
  private harden(window: BrowserWindow): void {
    window.webContents.setWindowOpenHandler(({ url }) => {
      void this.openExternally(url);
      return { action: 'deny' };
    });

    window.webContents.on('will-navigate', (event, target) => {
      if (!this.isOwnOrigin(target)) {
        event.preventDefault();
        void this.openExternally(target);
      }
    });

    // Nothing in a read-only file manager needs the camera, the microphone or
    // the user's location, so no permission is worth asking about.
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
  }

  private isOwnOrigin(target: string): boolean {
    try {
      return new URL(target).origin === this.url.origin;
    } catch {
      return false;
    }
  }

  /** Only ever hands the OS browser a real web address. */
  private async openExternally(target: string): Promise<void> {
    try {
      const parsed = new URL(target);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        await shell.openExternal(parsed.href);
      }
    } catch {
      // Not a URL we can open; dropping it is the safe outcome.
    }
  }
}
