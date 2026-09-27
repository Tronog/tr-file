import { DestroyRef, Service, computed, effect, inject, signal } from '@angular/core';
import { SettingsService } from './settings.service';

/** The colour themes (PRD 010, §4): VS Code's Dark Modern and Light Modern, or whichever the system prefers. */
export type ColorTheme = 'dark' | 'light' | 'system';

/** Where the preferences are kept — `PreferencesFeature`'s key, of which the theme is one. */
const PREFERENCES_KEY = 'tr-file.preferences.v1';
const THEME_PREFERENCE = 'workbench.colorTheme';

/**
 * The window's colour theme (PRD 010, §4). The library's tokens are Dark
 * Modern by default and Light Modern under `data-theme="light"` on the root
 * element; this is what sets it — as the page starts, before the workbench is
 * built, so the sign-in screen is themed too, and again whenever the choice or
 * the system's preference changes.
 *
 * The choice itself is a preference of the settings window
 * (`PreferencesFeature`, *Workbench: Color Theme*), kept with the others under
 * `tr-file.preferences.v1`; `index.html` reads it from there once more, before
 * the first paint, so a light window does not flash dark while it loads.
 */
@Service()
export class ThemeService {
  private readonly settings = inject(SettingsService);

  /** What was chosen. */
  readonly choice = signal<ColorTheme>(ThemeService.read(this.settings.get<unknown>(PREFERENCES_KEY)));

  /** Whether the system prefers light — followed while the choice is `system`. */
  private readonly systemLight = signal(false);

  /** The theme in force. */
  readonly theme = computed<'dark' | 'light'>(() => {
    const choice = this.choice();
    return choice === 'system' ? (this.systemLight() ? 'light' : 'dark') : choice;
  });

  constructor() {
    const query = globalThis.matchMedia?.('(prefers-color-scheme: light)');
    if (query !== undefined) {
      this.systemLight.set(query.matches);
      const follow = (event: MediaQueryListEvent): void => this.systemLight.set(event.matches);
      query.addEventListener('change', follow);
      inject(DestroyRef).onDestroy(() => query.removeEventListener('change', follow));
    }
    this.apply(this.theme());
    effect(() => this.apply(this.theme()));
  }

  private apply(theme: 'dark' | 'light'): void {
    const root = globalThis.document?.documentElement;
    if (root === undefined) {
      return;
    }
    if (theme === 'light') {
      root.dataset['theme'] = 'light';
    } else {
      delete root.dataset['theme'];
    }
  }

  /** The stored choice, or the default for anything else. */
  private static read(stored: unknown): ColorTheme {
    const value = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>)[THEME_PREFERENCE] : undefined;
    return value === 'light' || value === 'system' ? value : 'dark';
  }
}
