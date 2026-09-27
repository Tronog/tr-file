/** Dark Modern's editor background — and the window's, by default. */
export const DARK_BACKGROUND = '#1f1f1f';

/** Light Modern's (PRD 010, §4). */
export const LIGHT_BACKGROUND = '#ffffff';

/**
 * What the window paints before its first frame (PRD 010, §4), so a light
 * workbench does not flash dark while the bundle loads — the page's own
 * pre-paint check cannot see the settings, which live in this process.
 *
 * `settings` is the settings file as the page stored it: the colour theme is
 * `workbench.colorTheme` among `tr-file.preferences.v1`, `system` meaning
 * whatever the OS prefers (`prefersLight`).
 */
export function windowBackground(settings: Readonly<Record<string, unknown>>, prefersLight: boolean): string {
  const preferences = settings['tr-file.preferences.v1'];
  const choice = typeof preferences === 'object' && preferences !== null ? (preferences as Record<string, unknown>)['workbench.colorTheme'] : undefined;
  const light = choice === 'light' || (choice === 'system' && prefersLight);
  return light ? LIGHT_BACKGROUND : DARK_BACKGROUND;
}
