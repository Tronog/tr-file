import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import type { FsBridgeResponse } from '@tr-file/backend/bridge';
import type { Logger } from '@tr-file/backend/core';

import type { BridgeSessions } from './bridge-sessions.js';

/** Must match the preload's `CHANNEL` and the frontend's expectation. */
const CHANNEL = 'tr-file:fs';

/** Returned to a sender that is not the window this app opened. */
const REFUSED: FsBridgeResponse = {
  error: { code: 'FORBIDDEN', message: 'This frame may not use the file-system bridge.', status: 403 },
};

/**
 * The wire between the renderer and the backend (PRD 001, §8.1).
 *
 * This is the desktop's replacement for the HTTP layer, and it is deliberately
 * the thinnest thing that can be called one: check who is asking, hand the
 * command to the window's backend — the local `FileSystemBridge`, or the
 * remote server it is connected to (`BridgeSessions`, PRD 006) — and return
 * what it says. No business logic lives
 * here, and none may — the moment this file starts interpreting commands, the
 * desktop and the server have two different file-system APIs.
 *
 * Who is asking matters because `ipcMain.handle` answers any frame in the
 * application, including one a page managed to open. Only the stack's own
 * origin is served; `MainWindow` already refuses to navigate anywhere else, so
 * the two rules together mean a command can only come from our own bundle.
 */
export class FsBridgeChannel {
  private registered = false;

  constructor(
    private readonly origin: string,
    private readonly logger: Logger,
    private readonly sessions: BridgeSessions,
  ) {}

  /** Starts answering commands. Idempotent. */
  register(): void {
    if (this.registered) {
      return;
    }

    ipcMain.handle(CHANNEL, async (event: IpcMainInvokeEvent, request: unknown) => {
      if (!this.isTrusted(event)) {
        this.logger.warn('bridge command refused', { url: event.senderFrame?.url ?? 'unknown' });
        return REFUSED;
      }
      // Local backend or remote server, and the connection commands themselves:
      // all decided per window, in `BridgeSessions` (PRD 006, §1).
      return this.sessions.dispatch(event.sender, request);
    });

    this.registered = true;
    this.logger.debug('bridge channel registered', { channel: CHANNEL, origin: this.origin });
  }

  /** Stops answering; the app is closing, or the stack has been torn down. */
  dispose(): void {
    if (!this.registered) {
      return;
    }
    ipcMain.removeHandler(CHANNEL);
    this.registered = false;
  }

  /** Whether the frame that sent this command is one of ours. */
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
