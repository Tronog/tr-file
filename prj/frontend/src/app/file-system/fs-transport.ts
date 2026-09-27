import type { AuthStatus } from '../auth/auth.model';
import type {
  FsDetails,
  FsDirectoryListing,
  FsArchiveListing,
  FsClipboardFiles,
  FsDownload,
  FsGitAction,
  FsGitFields,
  FsOperationDecision,
  FsOperationJob,
  FsPlaces,
  FsServerTime,
  FsOperationRequest,
  FsOperationsInfo,
  FsSearchResult,
  FsUpload,
  FsWatchResult,
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

  /**
   * Saves entries — a folder, or a selection — as one zip, `name`
   * (PRD 003, §6). Written as it is sent, so its size is not known ahead.
   */
  saveZip(paths: readonly string[], name: string): FsDownload;

  /** Uploads one file into `directoryPath`, reporting progress as it goes. */
  upload(directoryPath: string, file: File, options?: FsUploadOptions): FsUpload;

  /* -- changing names, making entries (PRD 003, §5) ------------------------ */

  /**
   * Renames an entry — `to` is its whole new path, so an entry can also be
   * put back into the folder it was moved from (Undo). Answers with what is
   * now at `to`; `CONFLICT` when that name is taken.
   */
  rename(path: string, to: string): Promise<FsDetails>;

  /** Makes an empty folder `name` in `parent`; `CONFLICT` when the name is taken. */
  createFolder(parent: string, name: string): Promise<FsDetails>;

  /** Makes an empty file `name` in `parent`; `CONFLICT` when the name is taken. */
  createFile(parent: string, name: string): Promise<FsDetails>;

  /** Entries under `path` whose names match `query` — a substring, or a glob with `*` / `?`. */
  search(path: string, query: string, limit?: number): Promise<FsSearchResult>;

  /**
   * Which of `paths` changed since this watch last asked (auto-refresh). A
   * `null` id starts a new watch; the answer carries the id to ask with next.
   */
  watch(watchId: string | null, paths: readonly string[]): Promise<FsWatchResult>;

  /* -- places and archives (PRD 003, §6) ----------------------------------- */

  /** Where to start, and what the Places pane lists; a server names only its root. */
  places(): Promise<FsPlaces>;

  /** The backend machine's clock, for the status bar (PRD 001, §13.1). */
  serverTime(): Promise<FsServerTime>;

  /** One folder of a zip; `inner` `''` is its top. */
  archiveList(path: string, inner: string): Promise<FsArchiveListing>;

  /* -- the user's own computer (PRD 003, §5) -------------------------------- */

  /**
   * Whether this transport can hand a file to the apps of the computer the
   * window runs on — the desktop can; a browser tab cannot show a folder in
   * the system's file manager. Enables *Reveal*, never branches behaviour.
   */
  readonly systemShell: boolean;

  /**
   * Opens an entry outside the app: with its default application on the
   * desktop (the main process asks before running a program), in a new tab of
   * the browser otherwise. Resolves `false` when the user declined.
   */
  openExternally(path: string, name: string): Promise<boolean>;

  /** Shows an entry in the system's file manager; refused where there is none (`NOT_SUPPORTED`). */
  reveal(path: string): Promise<void>;

  /**
   * Whether this window shares files with the system — its clipboard, drags
   * to and from other apps (PRD 003, §6). The desktop does; a browser tab
   * cannot. Enables those paths, never branches behaviour.
   */
  readonly systemFiles: boolean;

  /** Files on the system clipboard; none where there is no system to ask. */
  readClipboard(): Promise<FsClipboardFiles>;

  /** Puts entries on the system clipboard, for the system's file manager to paste. */
  writeClipboard(paths: readonly string[], cut: boolean): Promise<void>;

  /**
   * *Copy Path*: entries' paths as text on the clipboard, one per line, and
   * answers with the text. The desktop copies each entry's real host path,
   * from the main process; a browser copies the path the app shows (`/docs/a.md`).
   * Rejects with `NOT_SUPPORTED` where nothing may be copied at all.
   */
  copyPaths(paths: readonly string[]): Promise<string>;

  /** Starts the system's drag of these entries, for other apps to take; `false` where there is none. */
  startDrag(paths: readonly string[]): boolean;

  /**
   * Where files dropped on the window are in the root: a root-relative path
   * each, or `null` for one it does not hold. All `null` where the window
   * cannot know — a browser, or a remote server.
   */
  localPaths(files: readonly File[]): Promise<readonly (string | null)[]>;

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

  /** Answers a job that is `waiting` (PRD 001, Fix 3); rejects with `CONFLICT` when it is not. */
  resolveOperation(id: string, decision: FsOperationDecision): Promise<FsOperationJob>;

  /* -- git (PRD 011, §1) ---------------------------------------------------- */

  /**
   * One git action on the backend — `/api/git/<action>`, or the bridge's
   * `git` command — answering with what that action answers. The typed calls
   * are `FsGitFeature`'s; a transport only carries them.
   */
  git<T>(action: FsGitAction, fields?: FsGitFields): Promise<T>;
}
