import { type EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { provideFileUi } from '@tr-file/file-ui';
import { UI_SETTINGS_STORE, UI_STORAGE_PREFIX } from '@tr-file/ui';
import { SettingsService } from './settings/settings.service';

/** What the app's settings keys start with: `tr-file.session.v1`, `tr-file.preferences.v1`, … */
export const STORAGE_PREFIX = 'tr-file';

/**
 * What the libraries need from the app (PRD 001, §17.1): the file manager's
 * components and their keys, and where to remember things — the app's own
 * settings (`localStorage`, or the desktop's settings file) under its own
 * keys. `app.config.ts` gives it to the app, `test-setup.ts` to every spec.
 */
export function provideTrFile(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideFileUi(),
    { provide: UI_SETTINGS_STORE, useExisting: SettingsService },
    { provide: UI_STORAGE_PREFIX, useValue: STORAGE_PREFIX },
  ]);
}
