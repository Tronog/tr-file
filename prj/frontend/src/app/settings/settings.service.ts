import { Service } from '@angular/core';
import { UiLocalStorageSettingsStore, type UiSettingsStore } from '@tr-file/ui';

/** What the desktop's preload puts on `window` (PRD 003, §6); see `prj/desktop`. */
interface SettingsBridgeApi {
  readonly version: number;
  all(): Promise<unknown>;
  set(key: string, value: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    /** Present only inside the desktop shell. */
    readonly trFileSettings?: SettingsBridgeApi;
  }
}

/** What the app's settings keys start with: `tr-file.session.v1`, `tr-file.preferences.v1`, … */
export const STORAGE_PREFIX = 'tr-file';

/** The settings contract the preload speaks. */
const SETTINGS_VERSION = 1;

/**
 * What the app remembers between sessions (PRD 003, §6): the layout, the
 * bookmarks, the recent folders, the saved servers.
 *
 * In a browser that is `localStorage`. On the desktop it cannot be: the
 * window loads the app from a loopback port the OS picks on each start, so
 * the page's origin — and everything it stores — is new every time. There
 * the main process keeps a settings file instead, read once by `load`
 * before the app starts (an app initializer) so every read after it is
 * synchronous, and written on each `set`.
 *
 * Values are plain JSON. A store that is missing, full or refused is no
 * memory, never an error: the session works, it just starts fresh next time.
 * It is the library's `UI_SETTINGS_STORE` too (`provideTrFile`).
 */
@Service()
export class SettingsService implements UiSettingsStore {
  /** The desktop's settings, once loaded; `null` in a browser. */
  private desktop: Map<string, unknown> | null = null;

  private readonly local = new UiLocalStorageSettingsStore();

  private get api(): SettingsBridgeApi | undefined {
    const api = globalThis.window?.trFileSettings;
    return api?.version === SETTINGS_VERSION ? api : undefined;
  }

  /** Reads the desktop's settings file; nothing to do in a browser. */
  async load(): Promise<void> {
    const api = this.api;
    if (api === undefined) {
      return;
    }
    this.desktop = new Map();
    try {
      const answer = (await api.all()) as { data?: unknown } | null;
      const data = answer?.data;
      if (typeof data === 'object' && data !== null) {
        for (const [key, value] of Object.entries(data)) {
          this.desktop.set(key, value);
        }
      }
    } catch {
      // No settings: the defaults it is.
    }
  }

  get<T>(key: string): T | undefined {
    if (this.desktop !== null) {
      return this.desktop.get(key) as T | undefined;
    }
    return this.local.get<T>(key);
  }

  set(key: string, value: unknown): void {
    if (this.desktop !== null) {
      if (value === null || value === undefined) {
        this.desktop.delete(key);
      } else {
        this.desktop.set(key, value);
      }
      void this.api?.set(key, value ?? null).catch(() => undefined);
      return;
    }
    this.local.set(key, value);
  }
}
