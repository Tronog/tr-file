import { InjectionToken } from '@angular/core';

/**
 * Something that keeps values by key between sessions — the layout, the key
 * bindings, the preferences. Values are plain JSON.
 *
 * The library reads and writes through `UI_SETTINGS_STORE`; an application
 * whose memory is not `localStorage` — a desktop shell's settings file —
 * provides its own.
 */
export interface UiSettingsStore {
  get<T>(key: string): T | undefined;
  /** Keeps `value`; `null` forgets the key. Never throws: storage that refuses only means nothing is remembered. */
  set(key: string, value: unknown): void;
}

/** The page's `localStorage`. Missing, full or refused storage is no memory, never an error. */
export class UiLocalStorageSettingsStore implements UiSettingsStore {
  get<T>(key: string): T | undefined {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      return raw === null || raw === undefined ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }

  set(key: string, value: unknown): void {
    try {
      if (value === null || value === undefined) {
        globalThis.localStorage?.removeItem(key);
      } else {
        globalThis.localStorage?.setItem(key, JSON.stringify(value));
      }
    } catch {
      // Not remembered past this session; nothing else is lost.
    }
  }
}

/** A store that remembers for as long as it lives — for tests, and for nowhere better to keep things. */
export class UiMemorySettingsStore implements UiSettingsStore {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    const value = this.values.get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  set(key: string, value: unknown): void {
    if (value === null || value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, structuredClone(value));
    }
  }
}

/** Where the library keeps what it remembers; `localStorage` unless the application says otherwise. */
export const UI_SETTINGS_STORE = new InjectionToken<UiSettingsStore>('UI_SETTINGS_STORE', {
  providedIn: 'root',
  factory: () => new UiLocalStorageSettingsStore(),
});

/**
 * What the library's keys in the store start with — `<prefix>.session.v1`,
 * `<prefix>.preferences.v1`, … — so two applications on one origin keep apart.
 */
export const UI_STORAGE_PREFIX = new InjectionToken<string>('UI_STORAGE_PREFIX', {
  providedIn: 'root',
  factory: () => 'ui',
});

/** The store key of the preferences (the settings window's values), the colour theme among them. */
export function uiPreferencesKey(prefix: string): string {
  return `${prefix}.preferences.v1`;
}
