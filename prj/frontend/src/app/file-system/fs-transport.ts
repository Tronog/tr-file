import type { AuthStatus } from '../auth/auth.model';
import type {
  FsDetails,
  FsDirectoryListing,
  FsDownload,
  FsOperationJob,
  FsOperationRequest,
  FsOperationsInfo,
  FsUpload,
} from './file-system.model';

/**
 * How the app reaches the backend (PRD 001, §8.1).
 *
 * There are two answers. In a browser it is HTTP — `/api/fs`, the contract of
 * Section 7. On the desktop the backend runs in the same application, so
 * talking to it over a socket would mean serialising, framing and parsing
 * requests that never leave the machine; there, the calls go straight through
 * an IPC channel to the very same `FilesService`.
 *
 * Everything above this line is transport-agnostic: `FsReadFeature` and
 * `FsTransferFeature` hold the behaviour, `FsError` describes the failures,
 * and neither knows which implementation it is standing on. That is what
 * "eliminate the HTTP communication layer" is allowed to mean without the
 * workbench noticing.
 */
export type FsTransportKind = 'http' | 'desktop';

/** Options accepted by {@link FsTransport.upload}. */
export interface FsUploadOptions {
  /** Replace an existing file instead of failing with `CONFLICT`. */
  readonly overwrite?: boolean;
}

/** The primitives every transport provides. Nothing here is UI-aware. */
export interface FsTransport {
  /** Which implementation this is; for diagnostics, not for branching. */
  readonly kind: FsTransportKind;

  /** Lists a directory. `''` is the configured files root. */
  list(path: string): Promise<FsDirectoryListing>;

  /** Describes one file or directory in full. */
  details(path: string): Promise<FsDetails>;

  /**
   * Reads a file's bytes, for the app itself to use (a preview, a thumbnail).
   * Not for saving: see `save`.
   *
   * `maxBytes` is advisory: a transport that can refuse an oversized file
   * *before* reading it does so, and one that cannot simply ignores it. Either
   * way the caller still checks what it got, so both behave the same.
   */
  read(path: string, maxBytes?: number): Promise<Blob>;

  /**
   * Saves a file to the user's disk, as `name`. The browser does it over HTTP;
   * the desktop asks where with a native dialog and streams the copy. Neither
   * pulls the whole file through the page's memory.
   */
  save(path: string, name: string): FsDownload;

  /** Uploads one file into `directoryPath`, reporting progress as it goes. */
  upload(directoryPath: string, file: File, options?: FsUploadOptions): FsUpload;

  /** Whether the backend asks to sign in, and whether this session has (PRD 003, §2). */
  authStatus(): Promise<AuthStatus>;

  /** Signs in; rejects with `UNAUTHORIZED` or `TOO_MANY_REQUESTS`. */
  login(username: string, password: string): Promise<AuthStatus>;

  logout(): Promise<AuthStatus>;

  /* -- file operations (PRD 005, §1) --------------------------------------- */

  /** Whose trash this backend puts things in. */
  operationsInfo(): Promise<FsOperationsInfo>;

  /**
   * Starts a copy, move, trash or empty-trash on the backend and answers with
   * the job at once. Rejects with `CONFLICT` (naming the clashes in
   * `details.conflicts`) when the request said to fail on one.
   */
  startOperation(request: FsOperationRequest): Promise<FsOperationJob>;

  /** How far a job has got. */
  operationStatus(id: string): Promise<FsOperationJob>;

  /** Stops a job; answers with how it stands. */
  cancelOperation(id: string): Promise<FsOperationJob>;
}
