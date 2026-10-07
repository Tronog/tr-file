import { DestroyRef, Service, computed, effect, inject, signal } from '@angular/core';
import { UI_SETTINGS_STORE, UI_STORAGE_PREFIX, uiPreferencesKey } from '../settings/ui-settings-store';

/** The colour themes (PRD 010, §4): VS Code's Dark Modern and Light Modern, or whichever the system prefers. */
export type UiColorTheme = 'dark' | 'light' | 'system';

/** The theme's key among the preferences (`uiPreferencesKey`). */
export const UI_THEME_PREFERENCE = 'workbench.colorTheme';

/**
 * The window's colour theme (PRD 010, §4). The library's tokens are Dark
 * Modern by default and Light Modern under `data-theme="light"` on the root
 * element; this is what sets it — as the page starts, before the workbench is
 * built, so the sign-in screen is themed too, and again whenever the choice or
 * the system's preference changes.
 *
 * The choice itself is a preference of the settings window (*Workbench:
 * Color Theme*), kept with the others in `UI_SETTINGS_STORE` under
 * `<prefix>.preferences.v1`, as `workbench.colorTheme`. An application that
 * paints before Angular does — an inline script in `index.html` — can read it
 * from there too, so a light window does not flash dark while it loads.
 */
@Service()
export class UiThemeService {
  private readonly settings = inject(UI_SETTINGS_STORE);
  private readonly key = uiPreferencesKey(inject(UI_STORAGE_PREFIX));

  /** What was chosen. */
  readonly choice = signal<UiColorTheme>(UiThemeService.read(this.settings.get<unknown>(this.key)));

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
  private static read(stored: unknown): UiColorTheme {
    const value = typeof stored === 'object' && stored !== null ? (stored as Record<string, unknown>)[UI_THEME_PREFERENCE] : undefined;
    return value === 'light' || value === 'system' ? value : 'dark';
  }
}
