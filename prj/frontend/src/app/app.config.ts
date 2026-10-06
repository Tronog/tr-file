import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideFileUi } from '@tr-file/file-ui';
import { routes } from './app.routes';
import { csrfInterceptor, sessionExpiryInterceptor } from './file-system/fs-http.interceptors';
import { RemoteConnectionService } from './file-system/remote-connection.service';
import { SettingsService } from './settings/settings.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless is the default from Angular v21, but PRD 001 asks for it
    // explicitly — stating it keeps the intent visible and guards against a
    // stray `provideZoneChangeDetection` creeping back in.
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    // The file manager's components, and their keys among the keymap's defaults.
    provideFileUi(),
    // Deliberately the default XHR backend, not `withFetch()`: Angular's fetch
    // backend emits no upload-progress events, which FsTransferFeature needs.
    // Every write carries the CSRF header, and a 401 sends the app back to the
    // sign-in screen (PRD 003, §2).
    provideHttpClient(withInterceptors([csrfInterceptor, sessionExpiryInterceptor])),
    // Before anything is built (PRD 003, §6): what was remembered — the
    // layout is restored when the workbench is made — and which backend this
    // window is on, whose layout that is.
    provideAppInitializer(async () => {
      const settings = inject(SettingsService);
      const connection = inject(RemoteConnectionService);
      await Promise.all([settings.load(), connection.load()]);
    }),
  ],
};
