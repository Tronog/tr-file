import { app, dialog } from 'electron';

import { DesktopConfig } from './desktop.config.js';
import { DesktopStack } from './desktop.stack.js';
import { FsBridgeChannel } from './fs-bridge.channel.js';
import { MainWindow } from './main-window.js';

/**
 * The desktop entry point: the Electron half of PRD 001, Section 8.
 *
 * It owns the application lifecycle and nothing else. What to run lives in
 * `DesktopConfig`, running it lives in `DesktopStack`, and what the user may
 * do with the window lives in `MainWindow` — so this file reads as the order
 * things happen in, which is the only thing about a main process that is hard
 * to reconstruct later.
 */
class DesktopApplication {
  private readonly config = DesktopConfig.resolve({
    env: process.env,
    homeDir: app.getPath('home'),
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    packaged: app.isPackaged,
  });

  private readonly stack = new DesktopStack(this.config);

  private window: MainWindow | null = null;
  private channel: FsBridgeChannel | null = null;

  /**
   * Starts the app, unless another copy already owns the lock — in which case
   * this process quits and the running one raises its window, because two
   * copies would mean two servers over the same files.
   */
  run(): void {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }

    app.on('second-instance', () => this.window?.focus());
    app.on('window-all-closed', () => {
      // macOS keeps the app running with no windows; everywhere else, closing
      // the last window means quitting.
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });
    // macOS again: the dock icon reopens the window the app still has.
    app.on('activate', () => void this.openWindow());
    app.on('will-quit', (event) => this.shutDown(event));

    app.whenReady().then(
      () => void this.start(),
      (error: unknown) => this.fail(error),
    );
  }

  private async start(): Promise<void> {
    try {
      const url = await this.stack.start();

      // Before the window, not after: the bundle may ask for a listing on its
      // very first frame, and a command that arrives with no handler rejects.
      this.channel = new FsBridgeChannel(this.stack.bridge, url.origin, this.stack.log);
      this.channel.register();

      await this.openWindow();
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  private async openWindow(): Promise<void> {
    if (this.window?.isOpen) {
      this.window.focus();
      return;
    }

    this.window = new MainWindow(this.stack.address, this.config.development);
    await this.window.open();
  }

  /**
   * Holds the quit open until the server has closed. `will-quit` fires once,
   * and the second pass — after `app.quit()` below — finds nothing to stop.
   */
  private shutDown(event: Electron.Event): void {
    event.preventDefault();
    this.channel?.dispose();
    void this.stack
      .stop()
      .catch(() => undefined)
      .then(() => app.exit(0));
  }

  /** Nothing can be shown in a window that never opened, so use a dialog. */
  private fail(error: unknown): void {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    process.stderr.write(`failed to start tr-file: ${message}\n`);
    dialog.showErrorBox('tr-file could not start', message);
    app.exit(1);
  }
}

new DesktopApplication().run();
