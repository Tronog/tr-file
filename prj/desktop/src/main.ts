import { join } from 'node:path';

import { app, BrowserWindow, dialog, globalShortcut, nativeTheme, screen, shell, type MessageBoxOptions } from 'electron';

import { installAppMenu } from './app-menu.js';
import { DesktopConfig } from './desktop.config.js';
import { DesktopStack } from './desktop.stack.js';
import { DragOutChannel } from './drag-out.channel.js';
import { electronClipboard } from './electron-clipboard.js';
import { waitForDevServer } from './dev-server.js';
import { FsBridgeChannel } from './fs-bridge.channel.js';
import { BridgeSessions } from './bridge-sessions.js';
import type { DesktopShell } from './desktop-shell.js';
import { MainWindow } from './main-window.js';
import { SaveFileChannel } from './save-file.channel.js';
import { appendUpdateLog, detectInstallation, SelfUpdate, startDetached, UpdateMonitor, updateSource } from './self-update.js';
import { SettingsChannel } from './settings.channel.js';
import { SettingsStore } from './settings-store.js';
import { windowBackground } from './window-background.js';
import { WindowStateFile } from './window-state.js';
import { SystemClipboard } from './system-clipboard.js';
import { ShellTrash } from './shell-trash.js';
import { SystemPlaces } from './system-places.js';
import { UpdateChannel } from './update.channel.js';
import { WindowControlsChannel } from './window-controls.channel.js';
import { VisibilityShortcut } from './window-visibility.js';

/**
 * The desktop entry point: the Electron half of PRD 001, Section 8.
 *
 * It owns the application lifecycle and nothing else. What to run lives in
 * `DesktopConfig`, running it lives in `DesktopStack`, and what the user may
 * do with the window lives in `MainWindow` — so this file reads as the order
 * things happen in, which is the only thing about a main process that is hard
 * to reconstruct later.
 */
/** What an upgrade starts the new version with, so it waits for the old one's lock (PRD 001, §8.6). */
const UPGRADED_FLAG = '--tr-file-upgraded';
/** Twenty seconds, a quarter of one at a time. */
const LOCK_RETRIES = 80;
const LOCK_RETRY_MS = 250;

class DesktopApplication {
  private readonly config = DesktopConfig.resolve({
    env: process.env,
    homeDir: app.getPath('home'),
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    packaged: app.isPackaged,
  });

  /** On the user's own machine, trash goes where their file manager shows it (PRD 005, §1). */
  private readonly stack = new DesktopStack(
    this.config,
    undefined,
    (filesRoot) => new ShellTrash(filesRoot, { trashItem: (path) => shell.trashItem(path) }),
    // Home, the user's folders and every mount, for the Places pane (PRD 003, §6).
    new SystemPlaces({
      platform: process.platform,
      home: app.getPath('home'),
      userFolder: (name) => app.getPath(name as Parameters<typeof app.getPath>[0]),
    }),
  );

  private window: MainWindow | null = null;
  /** What the window loads: the stack, or the dev server in its place. */
  private pageUrl: URL | null = null;
  private channel: FsBridgeChannel | null = null;
  private windowChannel: WindowControlsChannel | null = null;
  private saveChannel: SaveFileChannel | null = null;
  private settingsChannel: SettingsChannel | null = null;
  /** The global shortcut that shows and hides the window (PRD 001, §8.5). */
  private visibilityShortcut: VisibilityShortcut | null = null;
  /** The settings file, read once here too: the window's first colour comes from it (PRD 010, §4). */
  private settingsStore: SettingsStore | null = null;
  private dragChannel: DragOutChannel | null = null;
  /** Upgrading from the share's newer distributable (PRD 001, §8.6); `null` where there is none to follow. */
  private updates: UpdateMonitor | null = null;
  private updateChannel: UpdateChannel | null = null;
  private sessions: BridgeSessions | null = null;

  /**
   * The operating system's shell, for *Open* and *Show in Folder* (PRD 003,
   * §5). Asking before a program runs is a native dialog in this process —
   * the page is never the one that says yes.
   */
  private readonly shell: DesktopShell = {
    openPath: (path) => shell.openPath(path),
    showItemInFolder: (path) => shell.showItemInFolder(path),
    confirmRun: async (name) => {
      const options: MessageBoxOptions = {
        type: 'warning',
        message: `'${name}' is a program. Opening it will run it.`,
        detail: 'Only run programs you trust.',
        buttons: ['Run', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const parent = BrowserWindow.getFocusedWindow();
      const { response } = parent === null ? await dialog.showMessageBox(options) : await dialog.showMessageBox(parent, options);
      return response === 0;
    },
  };

  /**
   * Starts the app, unless another copy already owns the lock — in which case
   * this process quits and the running one raises its window, because two
   * copies would mean two servers over the same files.
   */
  run(): void {
    // A Wayland session gives out global shortcuts only through its portal
    // (PRD 001, §8.5); X11 and the other platforms need nothing. Before
    // `ready`, which may come while the lock below is waited for.
    if (process.platform === 'linux') {
      app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
    }

    if (app.requestSingleInstanceLock()) {
      this.begin();
      return;
    }
    // Started by an upgrade (PRD 001, §8.6): the old version is on its way
    // out and still holds the lock for a moment — ask again for a while.
    if (!process.argv.includes(UPGRADED_FLAG)) {
      app.quit();
      return;
    }
    let tries = 0;
    const retry = setInterval(() => {
      if (app.requestSingleInstanceLock()) {
        clearInterval(retry);
        this.begin();
      } else if (++tries >= LOCK_RETRIES) {
        clearInterval(retry);
        app.quit();
      }
    }, LOCK_RETRY_MS);
  }

  /** Everything after the lock: the lifecycle's handlers, and the start once ready. */
  private begin(): void {
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
      // One sign-in per window, shared by the command and save channels.
      const sessions = new BridgeSessions(this.stack.bridge, this.stack.log, this.shell, {
        // Files copied in the system's file manager paste here, and the other way round (PRD 003, §6).
        clipboard: new SystemClipboard(electronClipboard),
      });
      this.sessions = sessions;
      this.channel = new FsBridgeChannel(page.origin, this.stack.log, sessions);
      this.channel.register();

      // Downloads leave through the main process, which asks where to save
      // them and streams the copy (PRD 003, §1).
      this.saveChannel = new SaveFileChannel(page.origin, this.stack.log, sessions);
      this.saveChannel.register();

      // What the page remembers between sessions (PRD 003, §6): its origin is
      // new on every start, so a file in the user-data folder remembers instead.
      this.settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
      this.settingsChannel = new SettingsChannel(page.origin, this.stack.log, this.settingsStore);
      this.settingsChannel.register();

      // Entries dragged out of a panel into another app (PRD 003, §6).
      this.dragChannel = new DragOutChannel(page.origin, this.stack.log, sessions);
      this.dragChannel.register();

      // The window draws its own buttons now (§8.2), so the channel that acts
      // on them has to exist before the first frame asks for its state.
      this.windowChannel = new WindowControlsChannel(page.origin, this.stack.log);
      this.windowChannel.register();

      // The title bar's *Upgrade* button asks for the status on its first frame (§8.6).
      this.updates = this.createUpdateMonitor();
      this.updateChannel = new UpdateChannel(page.origin, this.stack.log, this.updates);
      this.updateChannel.register();

      await this.openWindow();

      // Looked at after the window is up: a share that is slow to answer must not hold it back.
      void this.updates?.start().catch((error: unknown) =>
        this.stack.log.warn('update monitor failed to start', { reason: error instanceof Error ? error.message : String(error) }),
      );

      // `Ctrl`+`` ` `` shows and hides the window from anywhere (PRD 001, §8.5).
      this.visibilityShortcut = new VisibilityShortcut(
        globalShortcut,
        () => this.window?.toggleVisibility(),
        (message, fields) => this.stack.log.warn(message, fields),
      );
      this.visibilityShortcut.register();
    } catch (error: unknown) {
      this.fail(error);
    }
  }

  /**
   * Self-updating (PRD 001, §8.6), for a packaged AppImage, portable `.exe` or
   * installed copy whose folder on the share is set — `null` otherwise.
   */
  private createUpdateMonitor(): UpdateMonitor | null {
    const installation = detectInstallation(process.platform, process.env, app.isPackaged, app.getVersion());
    const source = updateSource(process.platform, process.env);
    if (installation === null || source === null) {
      this.stack.log.debug('self-update off', { packaged: app.isPackaged, source });
      return null;
    }
    this.stack.log.info('self-update follows', { source, kind: installation.kind });
    // Every step of an upgrade, and of the helper that starts the new copy, in one file to read afterwards.
    const logFile = join(app.getPath('userData'), 'update.log');
    const log = (message: string, fields?: Record<string, unknown>): void => {
      this.stack.log.info(message, fields);
      appendUpdateLog(logFile, message, fields);
    };
    const tempDir = join(app.getPath('temp'), 'tr-file-update');
    return new UpdateMonitor(
      new SelfUpdate({ source, installation, stateFile: join(app.getPath('userData'), 'update-state.json'), tempDir }),
      {
        changed: (status) => UpdateChannel.publish(status),
        log,
        restart: async (relaunch) => {
          // Started now, from the local copy; it waits for this one's lock itself.
          // The setup is not the app: it closes whatever is still running and starts the app when done.
          const args = installation.kind === 'installed' ? relaunch.args : [...relaunch.args, UPGRADED_FLAG];
          await startDetached({ command: relaunch.command, args });
          log('new version started; quitting', { run: relaunch.command, args });
          app.quit();
        },
      },
    );
  }

  private async openWindow(): Promise<void> {
    if (this.window?.isOpen) {
      this.window.focus();
      return;
    }

    const background = windowBackground(this.settingsStore?.all() ?? {}, !nativeTheme.shouldUseDarkColors);
    // Where the window was, and how (PRD 001, §8.2.1) — checked against the screens there are now.
    const primary = screen.getPrimaryDisplay();
    const workAreas = [primary, ...screen.getAllDisplays().filter((display) => display.id !== primary.id)].map((display) => display.workArea);
    this.window = new MainWindow(
      this.pageUrl ?? this.stack.address,
      this.config.devTools,
      background,
      new WindowStateFile(join(app.getPath('userData'), 'window-state.json')),
      workAreas,
    );
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
    this.visibilityShortcut?.dispose();
    this.updates?.stop();
    this.updateChannel?.dispose();
    this.channel?.dispose();
    this.windowChannel?.dispose();
    this.saveChannel?.dispose();
    this.settingsChannel?.dispose();
    this.dragChannel?.dispose();
    // Copies of remote files opened with an app here (PRD 003, §5) go with the app.
    void (this.sessions?.cleanUp() ?? Promise.resolve())
      .then(() => this.stack.stop())
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
