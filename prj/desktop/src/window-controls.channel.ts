import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import type { Logger } from '@tr-file/backend/core';

import { clampZoom, stepZoom } from './window-zoom.js';

/** Must match the preload's channel and the frontend's expectation. */
const CHANNEL = 'tr-file:window';

/** The channel the main process pushes state changes down. */
export const WINDOW_STATE_EVENT = 'tr-file:window:state';

/** What the renderer needs to draw the right buttons. */
export interface WindowState {
  readonly maximized: boolean;
  readonly fullScreen: boolean;
  /** The page's zoom factor, `1` for 100 % (PRD 001, §8.2.3). */
  readonly zoom: number;
}

/** Everything the renderer may ask of its own window. */
type WindowCommand = 'state' | 'minimize' | 'toggleMaximize' | 'close' | 'zoomIn' | 'zoomOut' | 'resetZoom' | 'setZoom';

const COMMANDS: readonly WindowCommand[] = ['state', 'minimize', 'toggleMaximize', 'close', 'zoomIn', 'zoomOut', 'resetZoom', 'setZoom'];

/** Who wants to know when a window's zoom changes — `MainWindow`, to remember it. */
const zoomWatchers = new WeakMap<BrowserWindow, (factor: number) => void>();

/** Calls `listener` whenever `window`'s zoom is changed through `applyZoom`. */
export function watchZoom(window: BrowserWindow, listener: (factor: number) => void): void {
  zoomWatchers.set(window, listener);
}

/**
 * Zooms the window's page (PRD 001, §8.2.3) — the title bar's control, the
 * keys of the application menu — and tells the page, whose zoom control shows
 * the level, and whoever watches it.
 */
export function applyZoom(window: BrowserWindow, factor: number): void {
  if (window.isDestroyed()) {
    return;
  }
  const zoom = clampZoom(factor);
  window.webContents.setZoomFactor(zoom);
  window.webContents.send(WINDOW_STATE_EVENT, WindowControlsChannel.stateOf(window));
  zoomWatchers.get(window)?.(zoom);
}

/** A level up or down, or back to 100 % — on the window that has the keyboard. */
export function zoomFocused(by: 1 | -1 | 0): void {
  const window = BrowserWindow.getFocusedWindow();
  if (window !== null) {
    applyZoom(window, by === 0 ? 1 : stepZoom(window.webContents.getZoomFactor(), by));
  }
}

/**
 * The window buttons, wired to the window (PRD 001, §8.2) — and its zoom
 * (§8.2.3), which a page cannot set for itself either.
 *
 * The frame is gone, so minimise, maximise and close are drawn by the Angular
 * title bar — and a web page cannot move a window. This channel is the whole
 * of what it is allowed to do instead: a few verbs — only `setZoom` takes an
 * argument, a number clamped to the zoom's range — and each one answers with the resulting state so the renderer never has to guess which
 * icon to show.
 *
 * Like `FsBridgeChannel` it checks who is asking, and for the same reason:
 * `ipcMain.handle` answers any frame in the application. It also acts on *the
 * sender's own window* rather than on a window it holds a reference to, so a
 * command can only ever reach the window it came from.
 */
export class WindowControlsChannel {
  private registered = false;

  constructor(
    private readonly origin: string,
    private readonly logger: Logger,
  ) {}

  /** Starts answering commands. Idempotent. */
  register(): void {
    if (this.registered) {
      return;
    }

    ipcMain.handle(CHANNEL, (event: IpcMainInvokeEvent, request: unknown): WindowState | null => {
      if (!this.isTrusted(event)) {
        this.logger.warn('window command refused', { url: event.senderFrame?.url ?? 'unknown' });
        return null;
      }

      const window = BrowserWindow.fromWebContents(event.sender);
      const command = WindowControlsChannel.parse(request);
      if (window === null || command === null) {
        return null;
      }

      return this.run(window, command, (request as { factor?: unknown }).factor);
    });

    this.registered = true;
    this.logger.debug('window channel registered', { channel: CHANNEL, origin: this.origin });
  }

  dispose(): void {
    if (!this.registered) {
      return;
    }
    ipcMain.removeHandler(CHANNEL);
    this.registered = false;
  }

  /** The state of a window, as the renderer sees it. */
  static stateOf(window: BrowserWindow): WindowState {
    return { maximized: window.isMaximized(), fullScreen: window.isFullScreen(), zoom: clampZoom(window.webContents.getZoomFactor()) };
  }

  private run(window: BrowserWindow, command: WindowCommand, factor: unknown): WindowState {
    switch (command) {
      case 'minimize':
        window.minimize();
        break;
      case 'toggleMaximize':
        // One button, two meanings — which is why the icon has to follow the
        // state rather than being fixed.
        if (window.isMaximized()) {
          window.unmaximize();
        } else {
          window.maximize();
        }
        break;
      case 'close':
        window.close();
        break;
      case 'zoomIn':
      case 'zoomOut':
        applyZoom(window, stepZoom(window.webContents.getZoomFactor(), command === 'zoomIn' ? 1 : -1));
        break;
      case 'resetZoom':
        applyZoom(window, 1);
        break;
      case 'setZoom':
        applyZoom(window, clampZoom(factor));
        break;
      case 'state':
        break;
    }

    return WindowControlsChannel.stateOf(window);
  }

  private static parse(request: unknown): WindowCommand | null {
    if (typeof request !== 'object' || request === null) {
      return null;
    }
    const { command } = request as { command?: unknown };
    return COMMANDS.find((candidate) => candidate === command) ?? null;
  }

  private isTrusted(event: IpcMainInvokeEvent): boolean {
    const url = event.senderFrame?.url;
    if (url === undefined) {
      return false;
    }
    try {
      return new URL(url).origin === this.origin;
    } catch {
      return false;
    }
  }
}
