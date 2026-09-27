import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** The most a key's value may take as JSON: a layout, a list of bookmarks — never files. */
export const SETTINGS_MAX_VALUE_BYTES = 256 * 1024;
/** The most keys the page may keep. */
export const SETTINGS_MAX_KEYS = 64;
/** A key: short, and nothing that could be a path. */
const KEY = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;

/** Why a `set` was refused; the channel answers it as a failure. */
export class SettingsError extends Error {}

/**
 * What the page remembers between sessions (PRD 003, §6) — its layout, its
 * bookmarks, its saved servers — kept in one JSON file in the app's user-data
 * folder.
 *
 * Not `localStorage`: the window loads the app from a loopback port the OS
 * picks on every start, so its origin — and with it everything a page stores —
 * is new each time. This file is the one place that outlives a restart.
 *
 * The values are the page's own business; this only keeps them small and
 * well-formed, since the page is still a page. It is read once, when the app
 * starts, and written after each change — through a temporary file and a
 * rename, and one write at a time, so a crash mid-write leaves the previous
 * settings rather than half of the new ones. Nothing here imports `electron`.
 */
export class SettingsStore {
  private values: Record<string, unknown>;
  private writing: Promise<void> = Promise.resolve();
  private pending = false;

  constructor(private readonly file: string) {
    this.values = SettingsStore.load(file);
  }

  /** Everything kept, as the page stored it. */
  all(): Readonly<Record<string, unknown>> {
    return this.values;
  }

  /** Keeps `value` under `key`; `null` forgets the key. Resolves once it is on disk. */
  async set(key: unknown, value: unknown): Promise<void> {
    if (typeof key !== 'string' || !KEY.test(key)) {
      throw new SettingsError('A settings key is up to 128 letters, digits and . _ : -');
    }
    if (value === null || value === undefined) {
      const { [key]: _removed, ...rest } = this.values;
      this.values = rest;
    } else {
      const json = JSON.stringify(value);
      if (json === undefined) {
        throw new SettingsError('A setting must be plain data');
      }
      if (Buffer.byteLength(json) > SETTINGS_MAX_VALUE_BYTES) {
        throw new SettingsError(`A setting may take at most ${SETTINGS_MAX_VALUE_BYTES} bytes`);
      }
      if (!(key in this.values) && Object.keys(this.values).length >= SETTINGS_MAX_KEYS) {
        throw new SettingsError(`At most ${SETTINGS_MAX_KEYS} settings can be kept`);
      }
      // Stored as it will be read back: whatever a structured clone carried is now plain JSON.
      this.values = { ...this.values, [key]: JSON.parse(json) as unknown };
    }
    await this.save();
  }

  /**
   * Writes the current values. Changes that arrive while a write is running
   * are folded into one more write after it, not one each.
   */
  private save(): Promise<void> {
    if (this.pending) {
      return this.writing;
    }
    this.pending = true;
    this.writing = this.writing
      .catch(() => undefined)
      .then(async () => {
        this.pending = false;
        const temporary = `${this.file}.${process.pid}.tmp`;
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(temporary, JSON.stringify(this.values, null, 1), 'utf8');
        await rename(temporary, this.file);
      });
    return this.writing;
  }

  /** The file's values; a missing or broken file is no settings, not a failed start. */
  private static load(file: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown;
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
