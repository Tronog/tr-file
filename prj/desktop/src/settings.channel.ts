import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import type { Logger } from '@tr-file/backend/core';

import { SettingsError, type SettingsStore } from './settings-store.js';

/** Must match the preload's channel. */
const CHANNEL = 'tr-file:settings';

type SettingsAnswer = { readonly data: unknown } | { readonly error: { readonly code: string; readonly message: string } };

/**
 * The page's settings, kept by the main process (PRD 003, §6): `all` hands
 * back everything once, when the app starts, and `set` keeps one key.
 *
 * Checked like every other channel — only the app's own origin is answered —
 * and nothing but the settings file can be reached through it.
 */
export class SettingsChannel {
  private registered = false;

  constructor(
    private readonly origin: string,
    private readonly logger: Logger,
    private readonly store: SettingsStore,
  ) {}

  register(): void {
    if (this.registered) {
      return;
    }
    ipcMain.handle(CHANNEL, async (event: IpcMainInvokeEvent, request: unknown): Promise<SettingsAnswer> => {
      if (!this.isTrusted(event)) {
        this.logger.warn('settings command refused', { url: event.senderFrame?.url ?? 'unknown' });
        return { error: { code: 'FORBIDDEN', message: 'This frame may not use the settings.' } };
      }
      const { command, key, value } = (typeof request === 'object' && request !== null ? request : {}) as Record<string, unknown>;
      try {
        switch (command) {
          case 'all':
            return { data: this.store.all() };
          case 'set':
            await this.store.set(key, value);
            return { data: null };
          default:
            return { error: { code: 'BAD_REQUEST', message: `Unknown settings command: ${String(command)}` } };
        }
      } catch (error) {
        if (error instanceof SettingsError) {
          return { error: { code: 'BAD_REQUEST', message: error.message } };
        }
        this.logger.warn('failed to save settings', { reason: error instanceof Error ? error.message : String(error) });
        return { error: { code: 'INTERNAL_ERROR', message: 'The settings could not be saved.' } };
      }
    });
    this.registered = true;
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
