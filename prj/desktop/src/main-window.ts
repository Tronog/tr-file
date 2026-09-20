import { fileURLToPath } from 'node:url';

import { BrowserWindow, shell } from 'electron';

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
 */
export class MainWindow {
  private window: BrowserWindow | null = null;

  constructor(
    private readonly url: URL,
    private readonly development: boolean,
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
      // Painted before the first frame, so the workbench's dark chrome does
      // not flash white while the bundle loads.
      backgroundColor: '#1f1f1f',
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

    await window.loadURL(this.url.href);

    if (this.development) {
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
    this.window.focus();
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
