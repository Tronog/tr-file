import {
  type ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { csrfInterceptor, sessionExpiryInterceptor } from './file-system/fs-http.interceptors';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Zoneless is the default from Angular v21, but PRD 001 asks for it
    // explicitly — stating it keeps the intent visible and guards against a
    // stray `provideZoneChangeDetection` creeping back in.
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    // Deliberately the default XHR backend, not `withFetch()`: Angular's fetch
    // backend emits no upload-progress events, which FsTransferFeature needs.
    // Every write carries the CSRF header, and a 401 sends the app back to the
    // sign-in screen (PRD 003, §2).
    provideHttpClient(withInterceptors([csrfInterceptor, sessionExpiryInterceptor])),
  ],
};
