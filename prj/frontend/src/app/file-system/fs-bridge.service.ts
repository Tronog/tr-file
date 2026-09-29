import { Service, inject, signal } from '@angular/core';
import type { AuthStatus } from '../auth/auth.model';
import { SessionExpiryService } from '../auth/session-expiry.service';
import type {
  FsDetails,
  FsDirectoryListing,
  FsListingProgress,
  FsDownload,
  FsGitAction,
  FsGitFields,
  FsDownloadResult,
  FsArchiveListing,
  FsClipboardFiles,
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
import { FS_ABORTED, FsError } from './fs-error';
import type { FsDetailsOptions, FsTransport, FsUploadOptions } from './fs-transport';
import type { FsPathStyle } from './fs-path';

/**
 * What a bridge command answers with. Mirrors the backend's
 * `FsBridgeResponse`; kept as its own declaration rather than imported,
 * because the frontend must not depend on a Node package.
 */
type FsBridgeResponse<T> =
  | { readonly data: T }
  | {
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly status: number;
        readonly details?: unknown;
      };
    };

/** The object the Electron preload script exposes on `window`. */
interface FsBridgeApi {
  /** Contract version, so a stale preload can be recognised rather than used. */
  readonly version: number;
  invoke(request: unknown): Promise<unknown>;
  /** Asks the main process to save a file where the user chooses. */
  save(request: unknown): Promise<unknown>;
  /** Progress of every save in flight; returns its own unsubscribe. */
  onSaveProgress(listener: (progress: unknown) => void): () => void;
  /** Starts the system's drag of entries, by root-relative path (PRD 003, §6). */
  startDrag?(paths: readonly string[]): void;
  /** Where dropped files are in the root; answers like `invoke`. */
  localPaths?(files: readonly File[]): Promise<unknown>;
}

declare global {
  interface Window {
    /** Present only inside the desktop shell; see `prj/desktop`. */
    readonly trFileBridge?: FsBridgeApi;
  }
}

/**
 * The contract version this service speaks. Version 2 (PRD 003, §1) moves
 * reads and uploads in chunks and adds `save`; a preload still speaking 1
 * is not used at all, rather than used wrongly.
 */
const BRIDGE_VERSION = 2;

/**
 * The most bytes one command carries; must match the backend's
 * `FS_BRIDGE_CHUNK_BYTES`. It is what bounds the memory a transfer costs on
 * either side of the channel, whatever the size of the file.
 */
export const BRIDGE_CHUNK_BYTES = 1024 * 1024;

/** Where a remote server is, as the main process is asked to connect to it. */
export interface RemoteServerAddress {
  readonly scheme: 'http' | 'https';
  readonly host: string;
  readonly port: number;
  readonly user: string | null;
  readonly password: string | null;
}

/** Which backend a window talks to — never the password. */
export type RemoteConnectionStatus =
  | { readonly connected: false }
  | {
      readonly connected: true;
      readonly scheme: 'http' | 'https';
      readonly host: string;
      readonly port: number;
      readonly user: string | null;
    };

/** One chunk of a file, as the `read` command answers it. */
interface FsReadResult {
  readonly size: number;
  readonly mimeType: string | null;
  /** Explicitly over a plain `ArrayBuffer`, which is what `Blob` accepts. */
  readonly content: Uint8Array<ArrayBuffer>;
}

/** What the main process says a finished save was. */
interface FsSaveOutcome {
  readonly saved: boolean;
  readonly bytes?: number;
}

/** One progress push from the main process. */
interface FsSaveProgress {
  readonly transferId: string;
  readonly loaded: number;
  readonly total: number;
}

/**
 * The desktop transport (PRD 001, §8.1): the backend, reached directly.
 *
 * Inside the Electron shell the API and the renderer are the same
 * application, so HTTP would mean serialising a request, framing it, sending
 * it through the loopback stack and parsing it again — all to reach an object
 * in the next process. This service skips that: each call is one structured
 * clone through an IPC channel into the very same `FilesService` the HTTP
 * routes use. `prj/desktop` owns the channel; the only thing the browser side
 * sees is `window.trFileBridge`, put there by a sandboxed preload.
 *
 * Two consequences are visible to callers, and both are deliberate:
 *
 * - **Errors still arrive as `FsError`,** with the same codes and the same
 *   status numbers HTTP would have produced. The backend flattens them into
 *   data precisely so this stays true; nothing above has to ask which
 *   transport failed.
 * - **No file crosses whole** (PRD 003, §1). Reads and uploads move in
 *   chunks of `BRIDGE_CHUNK_BYTES`, so a large file costs one chunk of memory
 *   at a time rather than its size — twice, once on each side — and an upload
 *   reports real progress and can be stopped part-way. A download is not
 *   read here at all: the main process asks where to save it and streams it
 *   there itself.
 */
@Service()
export class FsBridgeService implements FsTransport {
  readonly kind = 'desktop' as const;

  private readonly expiry = inject(SessionExpiryService);

  /** Whether this app is running inside the desktop shell at all. */
  get isAvailable(): boolean {
    return this.api !== undefined;
  }

  async list(path: string): Promise<FsDirectoryListing> {
    return this.invoke<FsDirectoryListing>({ command: 'list', path });
  }

  async listCancel(token: string): Promise<void> {
    await this.invoke<unknown>({ command: 'list-cancel', token });
  }

  async listProgress(token: string, namesFrom: number, detailsFrom: number): Promise<FsListingProgress> {
    return this.invoke<FsListingProgress>({ command: 'list-progress', token, namesFrom, detailsFrom });
  }

  async details(path: string, options: FsDetailsOptions = {}): Promise<FsDetails> {
    return this.invoke<FsDetails>({ command: 'details', path, ...(options.recount === true ? { recount: true } : {}) });
  }

  /**
   * Reads a file chunk by chunk and assembles the chunks into one `Blob`.
   *
   * Unlike HTTP, `maxBytes` is enforced *before* anything is read, so an
   * oversized preview never occupies memory on either side of the channel.
   */
  async read(path: string, maxBytes?: number): Promise<Blob> {
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let offset = 0;
    let size = 0;
    let mimeType: string | null = null;

    do {
      const chunk = await this.invoke<FsReadResult>({
        command: 'read',
        path,
        offset,
        length: BRIDGE_CHUNK_BYTES,
        ...(maxBytes === undefined ? {} : { maxBytes }),
      });
      ({ size, mimeType } = chunk);
      if (chunk.content.byteLength === 0) {
        // The file shrank while it was being read: what there is, is all.
        break;
      }
      parts.push(chunk.content);
      offset += chunk.content.byteLength;
    } while (offset < size);

    return new Blob(parts, mimeType === null ? {} : { type: mimeType });
  }

  /**
   * Saves a file where the user chooses: the main process shows the native
   * Save dialog and streams the copy, pushing progress back here as it goes.
   * Dismissing the dialog is `dismissed`, not an error.
   */
  save(path: string, name: string): FsDownload {
    return this.saveVia({ command: 'save', path, name });
  }

  /** A zip of the entries, saved where the user chooses (PRD 003, §6); its size is known only at the end. */
  saveZip(paths: readonly string[], name: string): FsDownload {
    return this.saveVia({ command: 'save-zip', paths: [...paths], name });
  }

  private saveVia(request: { readonly command: 'save' | 'save-zip'; readonly name: string } & Record<string, unknown>): FsDownload {
    const progress = signal<FsUploadProgress>({ loaded: 0, total: null, percent: null });
    const transferId = `save-${crypto.randomUUID()}`;
    const api = this.api;

    let settled = false;
    let fail: (error: FsError) => void = () => undefined;

    const result = new Promise<FsDownloadResult>((resolve, reject) => {
      fail = (error: FsError) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      if (api === undefined) {
        fail(new FsError('The desktop bridge is not available.', 0, 'NETWORK_ERROR'));
        return;
      }

      const unsubscribe = api.onSaveProgress((raw) => {
        const update = raw as FsSaveProgress;
        if (update.transferId === transferId) {
          // A zip's total is not known until it is written: loaded, but no percentage.
          progress.set(update.total > 0 ? toProgress(update.loaded, update.total) : { loaded: update.loaded, total: null, percent: null });
        }
      });

      void (async () => {
        try {
          const outcome = FsBridgeService.unwrap<FsSaveOutcome>(
            await api.save({ ...request, transferId }),
          );
          if (settled) {
            return;
          }
          settled = true;
          resolve(
            outcome.saved
              ? { outcome: 'saved', ...(outcome.bytes === undefined ? {} : { bytes: outcome.bytes }) }
              : { outcome: 'dismissed' },
          );
        } catch (error) {
          fail(FsError.from(error));
        } finally {
          unsubscribe();
        }
      })();
    });

    return {
      progress: progress.asReadonly(),
      result,
      cancel: () => {
        void api?.save({ command: 'cancel', transferId });
        fail(new FsError('The download was cancelled.', 0, FS_ABORTED));
      },
    };
  }

  /**
   * Uploads one file a chunk at a time: `upload-begin` (where anything that
   * can be refused without the bytes is), one `upload-chunk` per slice of the
   * file — read from disk only as it is sent — and `upload-commit`. Progress
   * follows the chunks, and `cancel` stops the next one and tells the backend
   * to discard what it has.
   */
  upload(directoryPath: string, file: File, options?: FsUploadOptions): FsUpload {
    const progress = signal<FsUploadProgress>(toProgress(0, file.size));

    let cancelled = false;
    let uploadId: string | undefined;
    let settled = false;
    let fail: (error: FsError) => void = () => undefined;

    const result = new Promise<FsDetails>((resolve, reject) => {
      fail = (error: FsError) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      void (async () => {
        try {
          ({ uploadId } = await this.invoke<{ uploadId: string }>({
            command: 'upload-begin',
            path: directoryPath,
            filename: file.name,
            overwrite: options?.overwrite === true,
          }));

          for (let offset = 0; offset < file.size; offset += BRIDGE_CHUNK_BYTES) {
            if (cancelled) {
              return;
            }
            const content = new Uint8Array(await file.slice(offset, offset + BRIDGE_CHUNK_BYTES).arrayBuffer());
            const { received } = await this.invoke<{ received: number }>({
              command: 'upload-chunk',
              uploadId,
              content,
            });
            progress.set(toProgress(received, file.size));
          }

          if (cancelled) {
            return;
          }
          const details = await this.invoke<FsDetails>({ command: 'upload-commit', uploadId });
          progress.set(toProgress(file.size, file.size));
          settled = true;
          resolve(details);
        } catch (error) {
          this.abandon(uploadId);
          fail(FsError.from(error));
        }
      })();
    });

    return {
      progress: progress.asReadonly(),
      result,
      cancel: () => {
        cancelled = true;
        this.abandon(uploadId);
        fail(new FsError('The upload was cancelled.', 0, FS_ABORTED));
      },
    };
  }

  /* -- changing names, making entries (PRD 003, §5) ------------------------ */

  async rename(path: string, to: string): Promise<FsDetails> {
    return this.invoke<FsDetails>({ command: 'rename', path, to });
  }

  async createFolder(parent: string, name: string): Promise<FsDetails> {
    return this.invoke<FsDetails>({ command: 'mkdir', path: parent, name });
  }

  async createFile(parent: string, name: string): Promise<FsDetails> {
    return this.invoke<FsDetails>({ command: 'create-file', path: parent, name });
  }

  async search(path: string, query: string, limit?: number): Promise<FsSearchResult> {
    return this.invoke<FsSearchResult>({ command: 'search', path, query, ...(limit === undefined ? {} : { limit }) });
  }

  async watch(watchId: string | null, paths: readonly string[]): Promise<FsWatchResult> {
    return this.invoke<FsWatchResult>({ command: 'watch', watchId, paths: [...paths] });
  }

  /* -- places and archives (PRD 003, §6) ----------------------------------- */

  async places(): Promise<FsPlaces> {
    return this.invoke<FsPlaces>({ command: 'places' });
  }

  /** This computer's clock — or, connected to a server, the server's (PRD 001, §13.1). */
  async serverTime(): Promise<FsServerTime> {
    return this.invoke<FsServerTime>({ command: 'time' });
  }

  async archiveList(path: string, inner: string): Promise<FsArchiveListing> {
    return this.invoke<FsArchiveListing>({ command: 'archive-list', path, inner });
  }

  /* -- the user's own computer (PRD 003, §5) -------------------------------- */

  /** The main process can reach the system's shell — for files on this computer. */
  readonly systemShell = true;

  /** And its clipboard and drags (PRD 003, §6) — for files on this computer, again. */
  readonly systemFiles = true;

  async readClipboard(): Promise<FsClipboardFiles> {
    return this.invoke<FsClipboardFiles>({ command: 'clipboard-read' });
  }

  async writeClipboard(paths: readonly string[], cut: boolean): Promise<void> {
    await this.invoke({ command: 'clipboard-write', paths: [...paths], cut });
  }

  /** The main process writes it: the page itself may not write to the system clipboard. */
  async copyPaths(paths: readonly string[], style: FsPathStyle = 'native'): Promise<string> {
    const request = { command: 'clipboard-write-paths', paths: [...paths], ...(style === 'unix' ? { unix: true } : {}) };
    return (await this.invoke<{ text: string }>(request)).text;
  }

  /** The main process starts it — for entries on this computer; it knows which window is where. */
  startDrag(paths: readonly string[]): boolean {
    const start = this.api?.startDrag;
    if (start === undefined) {
      return false;
    }
    start([...paths]);
    return true;
  }

  async localPaths(files: readonly File[]): Promise<readonly (string | null)[]> {
    const api = this.api;
    if (api?.localPaths === undefined || files.length === 0) {
      return files.map(() => null);
    }
    try {
      return FsBridgeService.unwrap<readonly (string | null)[]>(await api.localPaths([...files]));
    } catch {
      return files.map(() => null);
    }
  }

  /**
   * The main process opens it with its default application — a copy of it,
   * for a file on a remote server — and asks first when it is a program.
   */
  async openExternally(path: string): Promise<boolean> {
    return (await this.invoke<{ opened: boolean }>({ command: 'shell-open', path })).opened;
  }

  async reveal(path: string): Promise<void> {
    await this.invoke<{ revealed: true }>({ command: 'shell-reveal', path });
  }

  /* -- remote servers (PRD 006, §1) --------------------------------------- */

  /**
   * Points this window at a remote tr-file server: the main process checks
   * it, signs in with the credentials if there are any, and from then on
   * sends this window's commands there. The password is not kept.
   */
  async connect(target: RemoteServerAddress): Promise<RemoteConnectionStatus> {
    return this.invoke<RemoteConnectionStatus>({ command: 'connect', ...target });
  }

  /** Back to the local backend. */
  async disconnect(): Promise<RemoteConnectionStatus> {
    return this.invoke<RemoteConnectionStatus>({ command: 'disconnect' });
  }

  async connectionStatus(): Promise<RemoteConnectionStatus> {
    return this.invoke<RemoteConnectionStatus>({ command: 'connection-status' });
  }

  /* -- signing in (PRD 003, §2) ------------------------------------------- */

  /** Off unless the desktop was started with an account; see `DesktopConfig`. */
  async authStatus(): Promise<AuthStatus> {
    return this.invoke<AuthStatus>({ command: 'auth-status' });
  }

  async login(username: string, password: string): Promise<AuthStatus> {
    return this.invoke<AuthStatus>({ command: 'login', username, password });
  }

  async logout(): Promise<AuthStatus> {
    return this.invoke<AuthStatus>({ command: 'logout' });
  }

  /** Tells the backend to discard an upload; best effort, and idempotent there. */
  /* -- file operations (PRD 005, §1) --------------------------------------- */

  async operationsInfo(): Promise<FsOperationsInfo> {
    return this.invoke<FsOperationsInfo>({ command: 'op-info' });
  }

  async startOperation(request: FsOperationRequest): Promise<FsOperationJob> {
    const { kind, ...rest } = request;
    return this.invoke<FsOperationJob>({ command: `op-${kind}`, ...rest });
  }

  async operationStatus(id: string): Promise<FsOperationJob> {
    return this.invoke<FsOperationJob>({ command: 'op-status', jobId: id });
  }

  async cancelOperation(id: string): Promise<FsOperationJob> {
    return this.invoke<FsOperationJob>({ command: 'op-cancel', jobId: id });
  }

  async trashListing(): Promise<FsTrashListing> {
    return this.invoke<FsTrashListing>({ command: 'op-trash-list' });
  }

  async resolveOperation(id: string, decision: FsOperationDecision): Promise<FsOperationJob> {
    return this.invoke<FsOperationJob>({ command: 'op-resolve', jobId: id, decision });
  }

  /* -- git (PRD 011, §1) ---------------------------------------------------- */

  async git<T>(action: FsGitAction, fields: FsGitFields = {}): Promise<T> {
    return this.invoke<T>({ command: 'git', ...fields, action });
  }

  private abandon(uploadId: string | undefined): void {
    if (uploadId !== undefined) {
      void this.invoke({ command: 'upload-abort', uploadId }).catch(() => undefined);
    }
  }

  /* -- internals ---------------------------------------------------------- */

  /** The preload's object, or `undefined` outside the desktop shell. */
  private get api(): FsBridgeApi | undefined {
    const api = globalThis.window?.trFileBridge;
    return api?.version === BRIDGE_VERSION ? api : undefined;
  }

  /**
   * Sends one command and unwraps its answer.
   *
   * Three failures are distinguished, because they mean different things: no
   * bridge at all (a programming error — this service was chosen in a
   * browser), the backend's own refusal (a real `FsError` with its code), and
   * a channel that threw (the main process died, or the payload would not
   * clone).
   */
  private async invoke<T>(request: object): Promise<T> {
    const api = this.api;
    if (api === undefined) {
      throw new FsError('The desktop bridge is not available.', 0, 'NETWORK_ERROR');
    }

    let response: unknown;
    try {
      response = await api.invoke(request);
    } catch (error) {
      throw FsError.from(error);
    }

    try {
      return FsBridgeService.unwrap<T>(response);
    } catch (error) {
      // A refused sign-in is its own answer; anything else refused for want
      // of one means the window has to sign in (again).
      if (error instanceof FsError && error.code === 'UNAUTHORIZED' && (request as { command?: string }).command !== 'login') {
        this.expiry.report();
      }
      throw error;
    }
  }

  private static unwrap<T>(response: unknown): T {
    if (typeof response !== 'object' || response === null) {
      throw new FsError('The desktop bridge returned nothing usable.', 0, 'UNKNOWN_ERROR');
    }

    const answer = response as FsBridgeResponse<T>;
    if ('error' in answer) {
      throw FsError.fromBridge(answer.error);
    }
    return answer.data;
  }
}

/** A progress value from what is known: `total` may be `0` for an empty file. */
function toProgress(loaded: number, total: number): FsUploadProgress {
  return { loaded, total, percent: total > 0 ? Math.round((loaded / total) * 100) : 100 };
}
