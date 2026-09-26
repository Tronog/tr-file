import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { tap } from 'rxjs';
import { SessionExpiryService } from '../auth/session-expiry.service';

/** Must match the backend's `CSRF_HEADER`. */
export const CSRF_HEADER = 'X-TR-File-Request';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const isApi = (url: string): boolean => url.startsWith('/api/');

/**
 * Marks every write to the API as the app's own (PRD 003, §2). The backend
 * refuses a write without it, and a page on another site cannot add it, so an
 * upload — or, later, a delete — can no longer be triggered by visiting one.
 */
export const csrfInterceptor: HttpInterceptorFn = (request, next) =>
  next(
    isApi(request.url) && !SAFE_METHODS.has(request.method)
      ? request.clone({ setHeaders: { [CSRF_HEADER]: '1' } })
      : request,
  );

/**
 * Tells the app when the backend turned a request away for want of a
 * session, so it can ask to sign in again instead of showing a wall of
 * errors. A refused sign-in is its own answer, not an expiry.
 */
export const sessionExpiryInterceptor: HttpInterceptorFn = (request, next) => {
  const expiry = inject(SessionExpiryService);
  return next(request).pipe(
    tap({
      error: (error: unknown) => {
        if (
          error instanceof HttpErrorResponse &&
          error.status === 401 &&
          isApi(request.url) &&
          !request.url.startsWith('/api/auth/')
        ) {
          expiry.report();
        }
      },
    }),
  );
};
