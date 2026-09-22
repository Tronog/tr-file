import { app, dialog } from 'electron';

import { installAppMenu } from './app-menu.js';
import { DesktopConfig } from './desktop.config.js';
import { DesktopStack } from './desktop.stack.js';
import { waitForDevServer } from './dev-server.js';
import { FsBridgeChannel } from './fs-bridge.channel.js';
import { MainWindow } from './main-window.js';
import { WindowControlsChannel } from './window-controls.channel.js';

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
  /** What the window loads: the stack, or the dev server in its place. */
  private pageUrl: URL | null = null;
  private channel: FsBridgeChannel | null = null;
  private windowChannel: WindowControlsChannel | null = null;

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
      // Before the window: the default menu it would otherwise inherit binds
      // `Ctrl`+`W` to closing the window, which is the tab's chord now.
      installAppMenu();

      const url = await this.stack.start();
      // The channels trust one origin, and it has to be the origin the page is
      // actually served from — which in `pnpm dev` is `ng serve`, not us.
      const page = await this.resolvePageUrl(url);
      this.pageUrl = page;

      // Before the window, not after: the bundle may ask for a listing on its
      // very first frame, and a command that arrives with no handler rejects.
      this.channel = new FsBridgeChannel(this.stack.bridge, page.origin, this.stack.log);
      this.channel.register();

      // The window draws its own buttons now (§8.2), so the channel that acts
      // on them has to exist before the first frame asks for its state.
      this.windowChannel = new WindowControlsChannel(page.origin, this.stack.log);
      this.windowChannel.register();

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

    this.window = new MainWindow(this.pageUrl ?? this.stack.address, this.config.devTools);
    await this.window.open();
  }

  /**
   * Where the UI comes from.
   *
   * With `TR_FILE_DEV_SERVER` set — `pnpm dev` does — the window loads
   * `ng serve`, so an edit to the frontend shows up in the running app instead
   * of after a rebuild. Data still goes over the bridge, because the preload
   * belongs to the window and not to the origin it happens to be showing.
   *
   * The dev server is started in parallel with this process and may take a
   * few seconds; if it never answers, the built bundle the stack is already
   * serving is a working window rather than an empty one.
   */
  private async resolvePageUrl(stackUrl: URL): Promise<URL> {
    const devServer = this.config.devServerUrl;
    if (devServer === null) {
      return stackUrl;
    }

    this.stack.log.info('waiting for the Angular dev server', { url: devServer.href });
    if (await waitForDevServer(devServer)) {
      this.stack.log.info('loading the Angular dev server', { url: devServer.href });
      return devServer;
    }

    if (!this.config.hasStaticRoot) {
      throw new Error(
        `The Angular dev server at ${devServer.href} never answered, and there is no build at ` +
          `${this.config.staticRoot} to fall back to. Start \`ng serve\`, or run ` +
          '`pnpm --filter frontend build`.',
      );
    }

    this.stack.log.warn('dev server unreachable; loading the built bundle', {
      url: devServer.href,
      staticRoot: this.config.staticRoot,
    });
    return stackUrl;
  }

  /**
   * Holds the quit open until the server has closed. `will-quit` fires once,
   * and the second pass — after `app.quit()` below — finds nothing to stop.
   */
  private shutDown(event: Electron.Event): void {
    event.preventDefault();
    this.channel?.dispose();
    this.windowChannel?.dispose();
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
