import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';

import type { FileSystemBridge, FsBridgeResponse } from '@tr-file/backend/bridge';
import type { Logger } from '@tr-file/backend/core';

import type { BridgeSessions } from './bridge-sessions.js';

/** Must match the preload's channel and the frontend's expectation. */
const CHANNEL = 'tr-file:save';

/** The channel progress is pushed down, to the window that asked. */
export const SAVE_PROGRESS_EVENT = 'tr-file:save:progress';

/** Progress is pushed at most this often; a large file would flood the channel otherwise. */
const PROGRESS_INTERVAL_MS = 100;

const REFUSED: FsBridgeResponse = {
  error: { code: 'FORBIDDEN', message: 'This frame may not save files.', status: 403 },
};

/** What `save` answers with: whether a copy was made, and how big it was. */
export interface SaveOutcome {
  /** `false` when the user dismissed the Save dialog — not a failure. */
  readonly saved: boolean;
  readonly bytes?: number;
}

/** One progress push, keyed by the id the renderer chose for the transfer. */
export interface SaveProgress {
  readonly transferId: string;
  readonly loaded: number;
  readonly total: number;
}

type SaveRequest =
  | { readonly command: 'save'; readonly transferId: string; readonly path: string; readonly name: string }
  | { readonly command: 'cancel'; readonly transferId: string };

/**
 * Downloads, on the desktop (PRD 003, §1).
 *
 * In a browser a download is the browser's job: the page points it at
 * `/api/fs/download` and it streams the file to disk. The desktop window has
 * no such URL, and building one out of the file's bytes would put the whole
 * file in the renderer's memory first. So the main process does it instead:
 * it asks where to save with the native dialog — the user, not the page,
 * picks the destination — and then `FileSystemBridge.saveCopy` streams the
 * file there, never holding more than a chunk of it.
 *
 * The renderer names each transfer, so progress can be pushed back against
 * that name and a `cancel` can stop the copy mid-stream. Trust is checked as
 * for every other channel: only frames from the app's own origin are served.
 */
export class SaveFileChannel {
  private registered = false;

  /** Copies in flight, so `cancel` can reach them. */
  private readonly running = new Map<string, AbortController>();

  constructor(
    private readonly bridge: FileSystemBridge,
    private readonly origin: string,
    private readonly logger: Logger,
    private readonly sessions: BridgeSessions,
  ) {}

  /** Starts answering requests. Idempotent. */
  register(): void {
    if (this.registered) {
      return;
    }

    ipcMain.handle(CHANNEL, async (event: IpcMainInvokeEvent, request: unknown): Promise<FsBridgeResponse> => {
      if (!this.isTrusted(event)) {
        this.logger.warn('save request refused', { url: event.senderFrame?.url ?? 'unknown' });
        return REFUSED;
      }

      const parsed = SaveFileChannel.parse(request);
      if (parsed === null) {
        return { error: { code: 'BAD_REQUEST', message: 'Malformed save request', status: 400 } };
      }
      if (parsed.command === 'cancel') {
        this.running.get(parsed.transferId)?.abort();
        return { data: { cancelled: true } };
      }
      return this.save(event.sender, parsed.transferId, parsed.path, parsed.name);
    });

    this.registered = true;
    this.logger.debug('save channel registered', { channel: CHANNEL, origin: this.origin });
  }

  /** Stops answering, and stops every copy still running. */
  dispose(): void {
    for (const controller of this.running.values()) {
      controller.abort();
    }
    this.running.clear();
    if (!this.registered) {
      return;
    }
    ipcMain.removeHandler(CHANNEL);
    this.registered = false;
  }

  private async save(
    sender: WebContents,
    transferId: string,
    path: string,
    name: string,
  ): Promise<FsBridgeResponse<SaveOutcome>> {
    // Asked before the dialog: a window that has not signed in gets no dialog.
    const session = this.sessions.for(sender);
    const status = await this.bridge.dispatch({ command: 'auth-status' }, session);
    if ('data' in status && !(status.data as { authenticated: boolean }).authenticated) {
      return { error: { code: 'UNAUTHORIZED', message: 'Sign in to continue', status: 401 } };
    }

    const window = BrowserWindow.fromWebContents(sender);
    const options = { defaultPath: name, title: `Save ${name}` };
    const choice = window === null ? await dialog.showSaveDialog(options) : await dialog.showSaveDialog(window, options);
    if (choice.canceled || choice.filePath === undefined || choice.filePath === '') {
      return { data: { saved: false } };
    }

    const controller = new AbortController();
    this.running.set(transferId, controller);
    let lastPush = 0;

    try {
      const result = await this.bridge.saveCopy(path, choice.filePath, {
        signal: controller.signal,
        onProgress: (loaded, total) => {
          const now = Date.now();
          if (loaded < total && now - lastPush < PROGRESS_INTERVAL_MS) {
            return;
          }
          lastPush = now;
          if (!sender.isDestroyed()) {
            sender.send(SAVE_PROGRESS_EVENT, { transferId, loaded, total } satisfies SaveProgress);
          }
        },
      }, session);
      return 'error' in result ? result : { data: { saved: true, bytes: result.data.bytes } };
    } finally {
      this.running.delete(transferId);
    }
  }

  private static parse(request: unknown): SaveRequest | null {
    if (typeof request !== 'object' || request === null) {
      return null;
    }
    const { command, transferId, path, name } = request as Record<string, unknown>;
    if (typeof transferId !== 'string' || transferId === '') {
      return null;
    }
    if (command === 'cancel') {
      return { command, transferId };
    }
    if (command === 'save' && typeof path === 'string' && typeof name === 'string') {
      return { command, transferId, path, name };
    }
    return null;
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
