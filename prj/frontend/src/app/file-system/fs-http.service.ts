import {
  HttpClient,
  HttpErrorResponse,
  HttpEventType,
  HttpHeaders,
  HttpParams,
  httpResource,
  type HttpProgressEvent,
  type HttpResourceRef,
} from '@angular/common/http';
import { Injector, Service, inject, signal, type Signal } from '@angular/core';
import { firstValueFrom, type Observable, type Subscription } from 'rxjs';
import type {
  FsDetails,
  FsDirectoryListing,
  FsDownload,
  FsDownloadResult,
  FsEnvelope,
  FsOperationJob,
  FsOperationRequest,
  FsOperationsInfo,
  FsUpload,
  FsUploadProgress,
} from './file-system.model';
import type { AuthStatus } from '../auth/auth.model';
import { FS_ABORTED, FsError } from './fs-error';
import type { FsTransport, FsUploadOptions } from './fs-transport';

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

  /**
   * Hands the download endpoint to the browser, which streams the file
   * straight to disk — the page never holds it.
   *
   * The browser reports nothing back about a download it was handed, so the
   * endpoint is asked for its first byte beforehand: a missing file, a
   * permission problem, a folder — anything the server would refuse — fails
   * here, with the contract's own code, rather than as a mystery in the
   * browser's downloads list. What the browser does after that is its
   * business, hence `delegated`.
   */
  save(path: string, name: string): FsDownload {
    const progress = signal<FsUploadProgress>(IDLE_PROGRESS);
    let subscription: Subscription | undefined;
    let settled = false;
    let fail: (error: FsError) => void = () => undefined;

    const result = new Promise<FsDownloadResult>((resolve, reject) => {
      fail = (error: FsError) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      subscription = this.http
        .get(this.downloadUrl(path), {
          responseType: 'blob',
          headers: new HttpHeaders({ Range: 'bytes=0-0' }),
        })
        .subscribe({
          next: () => {
            if (settled) {
              return;
            }
            this.handToBrowser(path, name);
            settled = true;
            resolve({ outcome: 'delegated' });
          },
          error: (error: unknown) => {
            // An empty file has no first byte to give: "range not
            // satisfiable" still means it is there to be saved.
            if (error instanceof HttpErrorResponse && error.status === 416 && !settled) {
              this.handToBrowser(path, name);
              settled = true;
              resolve({ outcome: 'delegated' });
            } else if (error instanceof HttpErrorResponse) {
              void FsError.fromHttpResponse(error).then(fail);
            } else {
              fail(FsError.from(error));
            }
          },
        });
    });

    return {
      progress: progress.asReadonly(),
      result,
      cancel: () => {
        // Only the check can be stopped; once the browser has the file, the
        // download is in its hands and this does nothing.
        subscription?.unsubscribe();
        fail(new FsError('The download was cancelled.', 0, FS_ABORTED));
      },
    };
  }

  /** The backend answers with `Content-Disposition: attachment`, so this saves. */
  private handToBrowser(path: string, name: string): void {
    const anchor = document.createElement('a');
    anchor.href = this.downloadUrl(path);
    anchor.download = name;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
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

  /* -- signing in (PRD 003, §2) ------------------------------------------- */

  /** The session cookie is `HttpOnly`: only the server can say whether there is one. */
  async authStatus(): Promise<AuthStatus> {
    return this.request<AuthStatus>(this.http.get<FsEnvelope<AuthStatus>>('/api/auth/session'));
  }

  async login(username: string, password: string): Promise<AuthStatus> {
    return this.request<AuthStatus>(
      this.http.post<FsEnvelope<AuthStatus>>('/api/auth/login', { username, password }),
    );
  }

  async logout(): Promise<AuthStatus> {
    return this.request<AuthStatus>(this.http.post<FsEnvelope<AuthStatus>>('/api/auth/logout', {}));
  }

  /* -- file operations (PRD 005, §1) --------------------------------------- */

  async operationsInfo(): Promise<FsOperationsInfo> {
    return this.request(this.http.get<FsEnvelope<FsOperationsInfo>>('/api/ops/info'));
  }

  async startOperation(request: FsOperationRequest): Promise<FsOperationJob> {
    const { kind, ...body } = request;
    return this.request(this.http.post<FsEnvelope<FsOperationJob>>(`/api/ops/${kind}`, body));
  }

  async operationStatus(id: string): Promise<FsOperationJob> {
    return this.request(this.http.get<FsEnvelope<FsOperationJob>>(`/api/ops/jobs/${encodeURIComponent(id)}`));
  }

  async cancelOperation(id: string): Promise<FsOperationJob> {
    return this.request(
      this.http.post<FsEnvelope<FsOperationJob>>(`/api/ops/jobs/${encodeURIComponent(id)}/cancel`, {}),
    );
  }

  private async request<T>(response: Observable<FsEnvelope<T>>): Promise<T> {
    try {
      return (await firstValueFrom(response)).data;
    } catch (error) {
      throw FsError.from(error);
    }
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
