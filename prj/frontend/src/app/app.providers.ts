import { type EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { UI_SETTINGS_STORE, UI_STORAGE_PREFIX } from '@tr-file/ui';
import { SettingsService, STORAGE_PREFIX } from './settings/settings.service';

/**
 * What the library needs from the app before anything is drawn (PRD 001,
 * §17.1): where to remember things — the app's own settings (`localStorage`,
 * or the desktop's settings file) under its own keys — which the theme reads
 * as the page starts. `app.config.ts` gives it to the app, `test-setup.ts` to
 * every spec.
 *
 * The workbench and the file manager's components are the workbench route's
 * (`provideTrFileWorkbench`), so they stay out of the initial chunk with it.
 */
export function provideTrFile(): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: UI_SETTINGS_STORE, useExisting: SettingsService },
    { provide: UI_STORAGE_PREFIX, useValue: STORAGE_PREFIX },
  ]);
}
