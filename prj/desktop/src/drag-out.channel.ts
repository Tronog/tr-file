import { ipcMain, nativeImage, type IpcMainEvent } from 'electron';

import type { Logger } from '@tr-file/backend/core';

import type { BridgeSessions } from './bridge-sessions.js';

/** Must match the preload's channel. */
const CHANNEL = 'tr-file:drag';

/**
 * The picture under the pointer while files are dragged out: a plain page.
 * Built in rather than read from disk — the packaged app carries only its
 * bundle — and never empty, which macOS would refuse.
 */
const DRAG_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAU0lEQVR42u3XsQkAQAhDUed0MDe19mZQU8jxhfQPkkYz7vK5e3UjB2RmK1LEBCBFTAEyxAYgQWwBawSAU4CIaIUK2AAVsAEqYANU8A9AEV680/cANO8TQp/m1SMAAAAASUVORK5CYII=';

/**
 * Entries dragged out of a panel into another app (PRD 003, §6).
 *
 * A page can only drag what a page has — text, its own data — so a drag of
 * *files* has to start here: the page says which entries, at the start of
 * its drag, and this hands the operating system their host paths through
 * `webContents.startDrag`. The paths never go back to the page.
 *
 * A one-way message rather than an invoke: the drag is under the user's
 * pointer already, and there is nothing to answer.
 */
export class DragOutChannel {
  private registered = false;

  constructor(
    private readonly origin: string,
    private readonly logger: Logger,
    private readonly sessions: BridgeSessions,
  ) {}

  register(): void {
    if (this.registered) {
      return;
    }
    ipcMain.on(CHANNEL, (event: IpcMainEvent, request: unknown) => {
      if (!this.isTrusted(event)) {
        this.logger.warn('drag refused', { url: event.senderFrame?.url ?? 'unknown' });
        return;
      }
      const paths = typeof request === 'object' && request !== null ? (request as { paths?: unknown }).paths : undefined;
      void this.sessions.dragFiles(event.sender, paths).then(
        (files) => {
          const [first, ...rest] = files;
          if (first === undefined || event.sender.isDestroyed()) {
            return;
          }
          event.sender.startDrag({
            file: first,
            ...(rest.length === 0 ? {} : { files }),
            icon: nativeImage.createFromDataURL(DRAG_ICON),
          });
        },
        (error: unknown) =>
          this.logger.warn('drag failed', { reason: error instanceof Error ? error.message : String(error) }),
      );
    });
    this.registered = true;
  }

  dispose(): void {
    if (this.registered) {
      ipcMain.removeAllListeners(CHANNEL);
      this.registered = false;
    }
  }

  private isTrusted(event: IpcMainEvent): boolean {
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
