import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';

import type { Logger } from '@tr-file/backend/core';

import type { UpdateMonitor, UpdateStatus } from './self-update.js';

/** Must match the preload's channel and event. */
const CHANNEL = 'tr-file:update';
const STATUS_EVENT = 'tr-file:update:status';

/**
 * Every answer: the status; whether this copy updates itself at all; and why
 * a check or an upgrade could not be done.
 */
interface UpdateAnswer {
  readonly status: UpdateStatus;
  readonly supported: boolean;
  readonly error?: string;
}

const UP_TO_DATE: UpdateStatus = { available: null, upgrading: false };

/**
 * The self-update, as far as the page sees it (PRD 001, §8.6): `status` for
 * the title bar's *Upgrade* button, `check` for *File › Check for Updates…*
 * (§8.6.1), `upgrade` when the button is pressed, and a pushed
 * status whenever the feed has something new. With no monitor — a
 * development run, macOS, updating turned off — it answers "up to date".
 *
 * Checked like every other channel: only the app's own origin is answered.
 */
export class UpdateChannel {
  private registered = false;

  constructor(
    private readonly origin: string,
    private readonly logger: Logger,
    private readonly monitor: UpdateMonitor | null,
  ) {}

  register(): void {
    if (this.registered) {
      return;
    }
    ipcMain.handle(CHANNEL, async (event: IpcMainInvokeEvent, request: unknown): Promise<UpdateAnswer | null> => {
      if (!this.isTrusted(event)) {
        this.logger.warn('update command refused', { url: event.senderFrame?.url ?? 'unknown' });
        return null;
      }
      const monitor = this.monitor;
      if (monitor === null) {
        return { status: UP_TO_DATE, supported: false };
      }
      const { command } = (typeof request === 'object' && request !== null ? request : {}) as { command?: unknown };
      switch (command) {
        case 'status':
          return { status: monitor.status, supported: true };
        // *File › Check for Updates…* (§8.6.1): looked at now, and any failure said.
        case 'check': {
          const error = await monitor.check();
          return error === null ? { status: monitor.status, supported: true } : { status: monitor.status, supported: true, error };
        }
        case 'upgrade': {
          const error = await monitor.upgrade();
          return error === null ? { status: monitor.status, supported: true } : { status: monitor.status, supported: true, error };
        }
        default:
          return null;
      }
    });
    this.registered = true;
  }

  /** Tells every window; called by the monitor when the status changes. */
  static publish(status: UpdateStatus): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(STATUS_EVENT, status);
      }
    }
  }

  dispose(): void {
    if (this.registered) {
      ipcMain.removeHandler(CHANNEL);
      this.registered = false;
    }
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
