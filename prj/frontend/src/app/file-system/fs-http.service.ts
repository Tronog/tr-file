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
  FsListingProgress,
  FsDownload,
  FsDownloadResult,
  FsArchiveListing,
  FsClipboardFiles,
  FsEnvelope,
  FsGitAction,
  FsGitFields,
  FsOperationDecision,
  FsOperationJob,
  FsPlaces,
  FsServerTime,
  FsOperationRequest,
  FsOperationsInfo,
  FsTrashListing,
  FsSearchResult,
  FsUpload,
  FsUploadProgress,
  FsWatchResult,
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

  async listCancel(token: string): Promise<void> {
    try {
      await firstValueFrom(this.http.delete(`${this.baseUrl}/list-progress?${new HttpParams().set('token', token).toString()}`));
    } catch (error) {
      throw FsError.from(error);
    }
  }

  async listProgress(token: string, namesFrom: number, detailsFrom: number): Promise<FsListingProgress> {
    const params = new HttpParams().set('token', token).set('namesFrom', namesFrom).set('detailsFrom', detailsFrom);
    try {
      return (await firstValueFrom(this.http.get<FsEnvelope<FsListingProgress>>(`${this.baseUrl}/list-progress?${params.toString()}`))).data;
    } catch (error) {
      throw FsError.from(error);
    }
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

  /**
   * A zip of the entries, written by the server as it is sent (PRD 003, §6).
   * Each entry is looked up first, so one that is gone or out of reach fails
   * here in the contract's words; the zip itself is then the browser's to
   * save, like any download.
   */
  saveZip(paths: readonly string[], name: string): FsDownload {
    const progress = signal<FsUploadProgress>(IDLE_PROGRESS);
    let cancelled = false;
    let fail: (error: FsError) => void = () => undefined;
    const result = new Promise<FsDownloadResult>((resolve, reject) => {
      fail = reject;
      void Promise.all(paths.map((path) => this.details(path))).then(
        () => {
          if (cancelled) {
            return;
          }
          let params = new HttpParams().set('name', name);
          for (const path of paths) {
            params = params.append('path', path);
          }
          this.handUrlToBrowser(`/api/archive/zip?${params.toString()}`, name);
          resolve({ outcome: 'delegated' });
        },
        (error: unknown) => reject(FsError.from(error)),
      );
    });
    return {
      progress: progress.asReadonly(),
      result,
      cancel: () => {
        cancelled = true;
        fail(new FsError('The download was cancelled.', 0, FS_ABORTED));
      },
    };
  }

  /** The backend answers with `Content-Disposition: attachment`, so this saves. */
  private handToBrowser(path: string, name: string): void {
    this.handUrlToBrowser(this.downloadUrl(path), name);
  }

  private handUrlToBrowser(url: string, name: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
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

  /* -- changing names, making entries (PRD 003, §5) ------------------------ */

  async rename(path: string, to: string): Promise<FsDetails> {
    return this.request(this.http.post<FsEnvelope<FsDetails>>(`${this.baseUrl}/rename`, { path, to }));
  }

  async createFolder(parent: string, name: string): Promise<FsDetails> {
    return this.request(this.http.post<FsEnvelope<FsDetails>>(`${this.baseUrl}/mkdir`, { path: parent, name }));
  }

  async createFile(parent: string, name: string): Promise<FsDetails> {
    return this.request(this.http.post<FsEnvelope<FsDetails>>(`${this.baseUrl}/create`, { path: parent, name }));
  }

  async search(path: string, query: string, limit?: number): Promise<FsSearchResult> {
    let params = new HttpParams().set('path', path).set('query', query);
    if (limit !== undefined) {
      params = params.set('limit', String(limit));
    }
    return this.request(this.http.get<FsEnvelope<FsSearchResult>>(`${this.baseUrl}/search?${params.toString()}`));
  }

  async watch(watchId: string | null, paths: readonly string[]): Promise<FsWatchResult> {
    return this.request(this.http.post<FsEnvelope<FsWatchResult>>(`${this.baseUrl}/watch`, { watchId, paths }));
  }

  /* -- places and archives (PRD 003, §6) ----------------------------------- */

  /** A server from before places existed answers `404`; it has its root all the same. */
  async places(): Promise<FsPlaces> {
    try {
      return (await firstValueFrom(this.http.get<FsEnvelope<FsPlaces>>(`${this.baseUrl}/places`))).data;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        return { home: '', places: [{ id: 'root', label: 'Files', kind: 'root', path: '' }] };
      }
      throw FsError.from(error);
    }
  }

  /** From the health check, which says what time it is on the server, and where (PRD 001, §13.1). */
  async serverTime(): Promise<FsServerTime> {
    const health = await this.request(this.http.get<FsEnvelope<{ timestamp: string; timeZone?: string; utcOffsetMinutes?: number }>>('/api/health'));
    return {
      now: health.timestamp,
      ...(health.timeZone === undefined ? {} : { timeZone: health.timeZone }),
      ...(health.utcOffsetMinutes === undefined ? {} : { utcOffsetMinutes: health.utcOffsetMinutes }),
    };
  }

  async archiveList(path: string, inner: string): Promise<FsArchiveListing> {
    const params = new HttpParams().set('path', path).set('inner', inner);
    return this.request(this.http.get<FsEnvelope<FsArchiveListing>>(`/api/archive/list?${params.toString()}`));
  }

  /* -- the user's own computer (PRD 003, §5) -------------------------------- */

  /** A browser tab has no file manager to show a file in. */
  readonly systemShell = false;

  /** Nor a clipboard of files, nor a way to drag one out (PRD 003, §6). */
  readonly systemFiles = false;

  async readClipboard(): Promise<FsClipboardFiles> {
    return { paths: [], cut: false, outside: 0 };
  }

  async writeClipboard(): Promise<void> {
    // A page cannot put files on the system clipboard.
  }

  startDrag(): boolean {
    return false;
  }

  /** Where entries are on the server's disk; as the app shows them, from a server that cannot say. */
  private async hostPaths(paths: readonly string[]): Promise<readonly string[]> {
    let params = new HttpParams();
    for (const path of paths) {
      params = params.append('path', path);
    }
    try {
      return (await firstValueFrom(this.http.get<FsEnvelope<{ paths: string[] }>>(`${this.baseUrl}/host-paths?${params.toString()}`))).data.paths;
    } catch (error) {
      if (FsError.from(error).code === 'NOT_FOUND') {
        return paths.map(shownPath);
      }
      throw FsError.from(error);
    }
  }

  /**
   * The full paths, on the server's own disk (PRD 004, §1.3.2) — asked of
   * the server, since only it knows where its root is — and the Clipboard API, where the page may use it — a secure context: HTTPS,
   * or `localhost`. Served over plain HTTP from another address it does not
   * exist, and the old `execCommand('copy')` of a selected text field still
   * works there, inside the click that asked for it.
   */
  async copyPaths(paths: readonly string[]): Promise<string> {
    const text = (await this.hostPaths(paths)).join('\n');
    const clipboard = globalThis.navigator?.clipboard;
    if (clipboard !== undefined) {
      try {
        await clipboard.writeText(text);
        return text;
      } catch {
        // Refused — no permission, or the page lost focus: try the old way.
      }
    }
    if (copyBySelection(text)) {
      return text;
    }
    throw new FsError('This browser did not let the page write to the clipboard.', 0, 'NOT_SUPPORTED');
  }

  /** A page never learns where a dropped file came from: every one is an upload. */
  async localPaths(files: readonly File[]): Promise<readonly (string | null)[]> {
    return files.map(() => null);
  }

  /**
   * A new browser tab on the file itself, served `inline` — the browser shows
   * what it can (a PDF, a picture, a video) and saves the rest. The server
   * makes anything that could run script there inert, since it is served
   * from the app's own origin.
   */
  async openExternally(path: string): Promise<boolean> {
    const params = new HttpParams().set('path', path).set('inline', 'true');
    globalThis.window?.open(`${this.baseUrl}/download?${params.toString()}`, '_blank', 'noopener');
    return true;
  }

  async reveal(): Promise<void> {
    throw new FsError('Showing a file in its folder works in the desktop app only.', 400, 'NOT_SUPPORTED');
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

  /** A server from before the Trash place answers `404`: its trash, as `/api/ops/info` says, listing nothing. */
  async trashListing(): Promise<FsTrashListing> {
    try {
      return (await firstValueFrom(this.http.get<FsEnvelope<FsTrashListing>>('/api/ops/trash-items'))).data;
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 404) {
        const info = await this.operationsInfo();
        return { trash: info.trash, canRestore: info.canRestore === true, canList: false, items: [] };
      }
      throw FsError.from(error);
    }
  }

  async resolveOperation(id: string, decision: FsOperationDecision): Promise<FsOperationJob> {
    return this.request(
      this.http.post<FsEnvelope<FsOperationJob>>(`/api/ops/jobs/${encodeURIComponent(id)}/resolve`, { decision }),
    );
  }

  /* -- git (PRD 011, §1) ---------------------------------------------------- */

  /** A read is a `GET` with its fields in the query; anything that changes a repository is a `POST`. */
  async git<T>(action: FsGitAction, fields: FsGitFields = {}): Promise<T> {
    if (!READ_GIT_ACTIONS.has(action)) {
      return this.request(this.http.post<FsEnvelope<T>>(`/api/git/${action}`, fields));
    }
    let params = new HttpParams();
    for (const [key, value] of Object.entries(fields)) {
      params = params.set(key, String(value));
    }
    const query = params.toString();
    return this.request(this.http.get<FsEnvelope<T>>(`/api/git/${action}${query === '' ? '' : `?${query}`}`));
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

/** A root-relative path as the app shows it: `/docs/a.md`; a drive, over every drive, as `C:/Users`. */
function shownPath(path: string): string {
  return /^[A-Za-z]:(\/|$)/.test(path) ? path : `/${path}`;
}

/** Copies `text` by selecting it in a hidden field — for pages the Clipboard API is not open to. */
function copyBySelection(text: string): boolean {
  const document = globalThis.document;
  if (document === undefined) {
    return false;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  field.focus();
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    focused?.focus();
  }
}

/** The git actions that only read, and so are `GET`s. */
const READ_GIT_ACTIONS: ReadonlySet<FsGitAction> = new Set<FsGitAction>(['info', 'status', 'log', 'branches', 'diff']);

/** Maps an `HttpProgressEvent` onto the contract-free progress shape. */
function toProgress(event: HttpProgressEvent): FsUploadProgress {
  const total = event.total ?? null;
  return {
    loaded: event.loaded,
    total,
    percent: total && total > 0 ? Math.round((event.loaded / total) * 100) : null,
  };
}
