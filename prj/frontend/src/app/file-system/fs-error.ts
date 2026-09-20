import { HttpErrorResponse } from '@angular/common/http';
import type { FsErrorBody } from './file-system.model';

/** The `code` the frontend invents when the failure never reached the server. */
export const FS_NETWORK_ERROR = 'NETWORK_ERROR';

/** The `code` the frontend invents when the caller aborted the request. */
export const FS_ABORTED = 'ABORTED';

/** The `code` used when a response failed but carried no contract error body. */
export const FS_UNKNOWN_ERROR = 'UNKNOWN_ERROR';

/**
 * The one error type the file-system features reject with.
 *
 * Callers never see an `HttpErrorResponse`: the transport detail is flattened
 * here into the status, the contract's `code` and its message, so a component
 * can branch on `code` (`NOT_FOUND`, `CONFLICT`, …) without knowing that HTTP
 * was involved at all.
 */
export class FsError extends Error {
  /** HTTP status, or `0` when the request never reached the server. */
  readonly status: number;
  /** The contract's error code, or one of the synthetic codes above. */
  readonly code: string;
  /** The contract's optional `details`, passed through untouched. */
  readonly details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = 'FsError';
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }

  /**
   * Turns whatever `HttpClient` rejected with into an `FsError`.
   *
   * Prefers the server's own `{ error: { code, message } }` envelope. A status
   * of `0` means the request never completed — offline, DNS, CORS, a dropped
   * connection — and gets a message that says so rather than the browser's
   * empty-ish one. Anything else (an HTML error page, a blob body from a
   * `responseType: 'blob'` request) falls back to the status text.
   */
  static fromHttp(error: HttpErrorResponse): FsError {
    const body = readErrorBody(error.error);
    if (body) {
      return new FsError(body.error.message, error.status, body.error.code, body.error.details);
    }

    if (error.status === 0) {
      return new FsError(
        'Could not reach the server. Check your connection and try again.',
        0,
        FS_NETWORK_ERROR,
      );
    }

    const statusText = error.statusText && error.statusText !== 'OK' ? error.statusText : 'Request failed';
    return new FsError(`${statusText} (HTTP ${error.status})`, error.status, FS_UNKNOWN_ERROR);
  }

  /**
   * Same as `fromHttp`, but for responses read as a `Blob` — which is what a
   * failed `responseType: 'blob'` request hands back. The contract envelope is
   * inside those bytes, so it has to be read asynchronously to recover the
   * server's real code instead of reporting a bare HTTP status.
   */
  static async fromHttpResponse(error: HttpErrorResponse): Promise<FsError> {
    if (!(error.error instanceof Blob)) {
      return FsError.fromHttp(error);
    }

    try {
      const body = readErrorBody(JSON.parse(await error.error.text()) as unknown);
      if (body) {
        return new FsError(body.error.message, error.status, body.error.code, body.error.details);
      }
    } catch {
      // Not JSON, or unreadable — fall through to the status-based message.
    }

    // Re-wrap without the unreadable blob body so `fromHttp` falls through to
    // its status-based message instead of trying to parse it again.
    return FsError.fromHttp(
      new HttpErrorResponse({
        status: error.status,
        statusText: error.statusText,
        ...(error.url === null ? {} : { url: error.url }),
      }),
    );
  }

  /**
   * Rebuilds an `FsError` from the desktop bridge's flattened failure
   * (PRD 001, §8.1).
   *
   * The backend sends `status` across the channel for exactly this reason: an
   * `FsError` from the bridge is indistinguishable from one raised by HTTP, so
   * no caller has to ask which transport it is standing on.
   */
  static fromBridge(failure: {
    code: string;
    message: string;
    status: number;
    details?: unknown;
  }): FsError {
    return new FsError(failure.message, failure.status, failure.code, failure.details);
  }

  /** Normalises anything thrown by a transport into an `FsError`. */
  static from(error: unknown): FsError {
    if (error instanceof FsError) {
      return error;
    }
    if (error instanceof HttpErrorResponse) {
      return FsError.fromHttp(error);
    }
    const message = error instanceof Error ? error.message : String(error);
    return new FsError(message, 0, FS_UNKNOWN_ERROR);
  }
}

/** Narrows an unparsed error body to the contract's envelope, or `null`. */
function readErrorBody(value: unknown): FsErrorBody | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { error } = value as { error?: unknown };
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code !== 'string' || typeof message !== 'string') {
    return null;
  }
  return value as FsErrorBody;
}
