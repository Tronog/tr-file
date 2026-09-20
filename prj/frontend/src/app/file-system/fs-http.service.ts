import {
  HttpClient,
  HttpErrorResponse,
  HttpEventType,
  HttpParams,
  httpResource,
  type HttpProgressEvent,
  type HttpResourceRef,
} from '@angular/common/http';
import { Injector, Service, inject, signal, type Signal } from '@angular/core';
import { firstValueFrom, type Subscription } from 'rxjs';
import type {
  FsDetails,
  FsDirectoryListing,
  FsEnvelope,
  FsUpload,
  FsUploadProgress,
} from './file-system.model';
import { FS_ABORTED, FsError } from './fs-error';
import type { FsSaveUrl, FsTransport, FsUploadOptions } from './fs-transport';

const IDLE_PROGRESS: FsUploadProgress = { loaded: 0, total: null, percent: null };

/**
 * The `/api/fs` transport: the contract of PRD 001 §7, spoken over HTTP.
 *
 * This is where every URL, every `HttpParams` and every `HttpErrorResponse` in
 * the application now lives. It used to be spread across the two file-system
 * features; §8.1 moved it here so those features could be handed a different
 * transport on the desktop without being rewritten.
 *
 * It is the default everywhere, and the only transport in a browser.
 */
@Service()
export class FsHttpService implements FsTransport {
  readonly kind = 'http' as const;

  /** Every endpoint of the contract hangs off this prefix. */
  readonly baseUrl = '/api/fs';

  private readonly http = inject(HttpClient);

  /**
   * Captured so `httpResource()` can be created outside an injection context —
   * a caller may build a reader from a lifecycle hook or an event handler.
   */
  private readonly injector = inject(Injector);

  async list(path: string): Promise<FsDirectoryListing> {
    return this.get<FsDirectoryListing>('list', path);
  }

  async details(path: string): Promise<FsDetails> {
    return this.get<FsDetails>('details', path);
  }

  /**
   * `maxBytes` is ignored: HTTP has no way to ask the server to refuse a file
   * by size, so the whole body arrives and the caller checks it. The desktop
   * transport, which *can* refuse first, is the reason the parameter exists.
   *
   * A failed blob request carries the error envelope as a `Blob` too, so the
   * rejection is built asynchronously to recover the server's real error code.
   */
  async read(path: string): Promise<Blob> {
    try {
      return await firstValueFrom(this.http.get(this.downloadUrl(path), { responseType: 'blob' }));
    } catch (error) {
      throw error instanceof HttpErrorResponse
        ? await FsError.fromHttpResponse(error)
        : FsError.from(error);
    }
  }

  /** The download endpoint itself: the browser streams it straight to disk. */
  async saveUrl(path: string): Promise<FsSaveUrl> {
    return { url: this.downloadUrl(path), release: () => undefined };
  }

  /**
   * The URL a browser can hit directly — an `<a href>`, `window.open`, an
   * `<img src>`. The backend sets `Content-Disposition: attachment`, so the
   * browser saves the file rather than navigating to it.
   */
  downloadUrl(path: string): string {
    const params = new HttpParams().set('path', path);
    return `${this.baseUrl}/download?${params.toString()}`;
  }

  /**
   * Uploads one file as `multipart/form-data`.
   *
   * Returns immediately with a handle; the request runs in the background and
   * reports progress through `handle.progress`. Upload progress is why the app
   * keeps the XHR backend — see the comment in `app.config.ts`.
   */
  upload(directoryPath: string, file: File, options?: FsUploadOptions): FsUpload {
    const progress = signal<FsUploadProgress>(IDLE_PROGRESS);

    const body = new FormData();
    body.append('file', file, file.name);

    const params = new HttpParams()
      .set('path', directoryPath)
      .set('overwrite', options?.overwrite === true ? 'true' : 'false');
    const url = `${this.baseUrl}/upload?${params.toString()}`;

    let subscription: Subscription | undefined;
    let settled = false;
    let fail: (error: FsError) => void = () => undefined;

    const result = new Promise<FsDetails>((resolve, reject) => {
      fail = (error: FsError) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      subscription = this.http
        .post<FsEnvelope<FsDetails>>(url, body, { reportProgress: true, observe: 'events' })
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.UploadProgress) {
              progress.set(toProgress(event));
            } else if (event.type === HttpEventType.Response) {
              const envelope = event.body;
              if (!envelope) {
                fail(
                  new FsError('The upload response carried no body.', event.status, 'UNKNOWN_ERROR'),
                );
                return;
              }
              settled = true;
              resolve(envelope.data);
            }
          },
          error: (error: unknown) => fail(FsError.from(error)),
        });
    });

    return {
      progress: progress.asReadonly(),
      result,
      cancel: () => {
        // Unsubscribing aborts the underlying XHR; the promise then rejects so
        // no caller is left awaiting a request that will never answer.
        subscription?.unsubscribe();
        fail(new FsError('The upload was cancelled.', 0, FS_ABORTED));
      },
    };
  }

  /* -- reactive readers --------------------------------------------------- */

  /**
   * A directory listing that follows `path`, idle while it is `undefined`.
   *
   * Deliberately *not* on `FsTransport`: an `httpResource` is an HTTP thing,
   * and the desktop transport has no equivalent. Callers that want a reader on
   * either transport should build a `resource()` over `list()` instead.
   */
  listResource(path: Signal<string | undefined>): HttpResourceRef<FsDirectoryListing | undefined> {
    return this.resource<FsDirectoryListing>('list', path);
  }

  /** Entry details that follow `path`, idle while it is `undefined`. */
  detailsResource(path: Signal<string | undefined>): HttpResourceRef<FsDetails | undefined> {
    return this.resource<FsDetails>('details', path);
  }

  /* -- internals ---------------------------------------------------------- */

  /**
   * The URL of one read endpoint for one path.
   *
   * `HttpParams` does the encoding, and the result is handed to `HttpClient`
   * as a whole URL — never re-encoded, so a path with spaces or `#` survives.
   */
  private url(endpoint: 'list' | 'details', path: string): string {
    const params = new HttpParams().set('path', path);
    return `${this.baseUrl}/${endpoint}?${params.toString()}`;
  }

  private async get<T>(endpoint: 'list' | 'details', path: string): Promise<T> {
    try {
      const response = await firstValueFrom(
        this.http.get<FsEnvelope<T>>(this.url(endpoint, path)),
      );
      return response.data;
    } catch (error) {
      throw FsError.from(error);
    }
  }

  private resource<T>(
    endpoint: 'list' | 'details',
    path: Signal<string | undefined>,
  ): HttpResourceRef<T | undefined> {
    return httpResource<T>(
      () => {
        const value = path();
        // `undefined` keeps the resource idle — no request is ever issued.
        return value === undefined ? undefined : this.url(endpoint, value);
      },
      {
        injector: this.injector,
        // The wire shape is the `{ data }` envelope; callers want the payload.
        parse: (raw: unknown) => (raw as FsEnvelope<T>).data,
      },
    );
  }
}

/** Maps an `HttpProgressEvent` onto the contract-free progress shape. */
function toProgress(event: HttpProgressEvent): FsUploadProgress {
  const total = event.total ?? null;
  return {
    loaded: event.loaded,
    total,
    percent: total && total > 0 ? Math.round((event.loaded / total) * 100) : null,
  };
}
