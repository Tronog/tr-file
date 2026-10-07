import { signal } from '@angular/core';
import type { UiSettingsStore } from '@tr-file/ui';
import { SettingsService } from '../../settings/settings.service';

/** The settings key of the notes; the suffix is its format's version. */
export const NOTES_KEY = 'tr-file.notes.v1';

/** How long typing has to pause before the notes are written. */
export const NOTES_SAVE_DELAY_MS = 500;

/**
 * The most the notes may take, stored: the desktop's settings file refuses a
 * value over 256 KiB (`SETTINGS_MAX_VALUE_BYTES`), and says so to nobody — so
 * the limit is kept here, a little under, where it can be said.
 */
export const NOTES_MAX_BYTES = 250 * 1024;

/**
 * The bottom panel's Notes tab (PRD 001, §12.2): one plain text the user
 * keeps, written to the app's settings — on the desktop the file the main
 * process keeps in `userData`, in a browser `localStorage`.
 *
 * One note for the whole app, not per backend: it is the user's, not a
 * server's, so it stays on this computer whichever one the window is
 * connected to. Written a moment after typing stops, when the box is left,
 * and before the window goes (`flush`).
 */
export class NotesFeature {
  private readonly current = signal('');
  private readonly problem = signal<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | null = null;

  /** What the box shows. */
  readonly text = this.current.asReadonly();

  /** Why the text is not being kept, or `null`. */
  readonly error = this.problem.asReadonly();

  constructor(private readonly store: UiSettingsStore = new SettingsService()) {
    const stored = store.get<unknown>(NOTES_KEY);
    this.current.set(typeof stored === 'string' ? stored : '');
  }

  /** The box changed: keep the text, and write it once typing pauses. */
  edit(text: string): void {
    this.current.set(text);
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, NOTES_SAVE_DELAY_MS);
  }

  /** Writes now what is waiting to be written — on leaving the box, and before the window goes. */
  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
      this.write();
    }
  }

  private write(): void {
    const text = this.current();
    if (new TextEncoder().encode(JSON.stringify(text)).length > NOTES_MAX_BYTES) {
      this.problem.set(`Notes are too long to be saved — keep them under ${NOTES_MAX_BYTES / 1024} KB.`);
      return;
    }
    this.problem.set(null);
    this.store.set(NOTES_KEY, text === '' ? null : text);
  }
}
