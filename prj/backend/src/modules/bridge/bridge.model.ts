/**
 * The direct (non-HTTP) command surface of the file-system API
 * (PRD 001, §8.1).
 *
 * These shapes are the contract between the backend and any caller that can
 * reach it *in process* — on the desktop, the Electron main process, which
 * relays them over an IPC channel. They are deliberately plain data, because
 * everything crossing that channel is structured-cloned: no classes, no
 * `Error` instances, no streams.
 *
 * The vocabulary mirrors `/api/fs` one for one — same operations, same error
 * codes, same payloads — so the frontend can swap transports without either
 * side learning a second dialect.
 */

import type { ArchiveListingDto } from '../archive/archive.model.js';
import type { AuthStatusDto } from '../auth/auth.model.js';
import type { DirectoryListingDto, FileDetailsDto, FileEntryType, PlacesDto, SearchResultDto } from '../files/models/index.js';
import type { WatchResultDto } from '../files/watch.service.js';
import type { GitRequest } from '../git/git-request.js';
import type { ConflictPolicy, OperationJobDto, OperationsInfoDto } from '../operations/operation.model.js';

/** Every operation the bridge offers. */
export type FsBridgeCommand =
  | 'list'
  | 'details'
  | 'read'
  | 'upload-begin'
  | 'upload-chunk'
  | 'upload-commit'
  | 'upload-abort'
  | 'auth-status'
  | 'login'
  | 'logout'
  | 'op-info'
  | 'op-copy'
  | 'op-move'
  | 'op-trash'
  | 'op-empty-trash'
  | 'op-status'
  | 'op-cancel'
  | 'rename'
  | 'mkdir'
  | 'create-file'
  | 'search'
  | 'watch'
  | 'op-delete'
  | 'op-restore'
  | 'places'
  | 'archive-list'
  | 'op-compress'
  | 'op-extract'
  | 'git'
  | 'host-paths';

/**
 * Who is signed in on one bridge connection (PRD 003, §2) — for the desktop,
 * one window. The channel owns it and hands it to every `dispatch` from that
 * window; the bridge only reads and updates it. A connection starts signed
 * out, and only matters when signing in is switched on.
 */
export interface FsBridgeSession {
  username: string | null;
}

/**
 * The most bytes one `read` or `upload-chunk` carries. Every command is
 * structured-cloned across the channel, so this — not the file — bounds what
 * either process holds at once (PRD 003, §1).
 */
export const FS_BRIDGE_CHUNK_BYTES = 1024 * 1024;

/** List a directory. `''` is the files root. */
export interface FsListRequest {
  readonly command: 'list';
  readonly path: string;
}

/** Full metadata for one entry. */
export interface FsDetailsRequest {
  readonly command: 'details';
  readonly path: string;
}

/**
 * Read one chunk of a file: `length` bytes from `offset`, capped at
 * `FS_BRIDGE_CHUNK_BYTES`. A caller wanting the whole file asks again from
 * where the last chunk ended, until it has `size` bytes.
 *
 * `maxBytes` is checked on every call, before anything is read: a caller
 * that will not hold a file past a size says so, and an oversized one is
 * refused before its first byte crosses.
 */
export interface FsReadRequest {
  readonly command: 'read';
  readonly path: string;
  readonly offset?: number;
  readonly length?: number;
  readonly maxBytes?: number;
}

/**
 * Start storing one file in a directory. `path` is the directory. Everything
 * that can be refused without the bytes — a missing directory, an unsafe
 * name, a target that exists — is refused here, before any are sent.
 */
export interface FsUploadBeginRequest {
  readonly command: 'upload-begin';
  readonly path: string;
  readonly filename: string;
  readonly overwrite: boolean;
}

/** The next bytes of an upload, in order. */
export interface FsUploadChunkRequest {
  readonly command: 'upload-chunk';
  readonly uploadId: string;
  readonly content: Uint8Array;
}

/** Every byte has been sent: finish the file and describe it. */
export interface FsUploadCommitRequest {
  readonly command: 'upload-commit';
  readonly uploadId: string;
}

/** Give up on an upload; nothing it wrote is kept. */
export interface FsUploadAbortRequest {
  readonly command: 'upload-abort';
  readonly uploadId: string;
}

/** Whether this connection must sign in, and whether it has. */
export interface FsAuthStatusRequest {
  readonly command: 'auth-status';
}

export interface FsLoginRequest {
  readonly command: 'login';
  readonly username: string;
  readonly password: string;
}

export interface FsLogoutRequest {
  readonly command: 'logout';
}

/**
 * File operations (PRD 005, §1), the commands `/api/ops` answers: each start
 * answers with the job at once, and the caller asks `op-status` for progress.
 */
export interface FsOpInfoRequest {
  readonly command: 'op-info';
}

export interface FsOpTransferRequest {
  readonly command: 'op-copy' | 'op-move';
  readonly sources: readonly string[];
  readonly destination: string;
  readonly conflict: ConflictPolicy;
}

export interface FsOpTrashRequest {
  readonly command: 'op-trash';
  readonly paths: readonly string[];
}

export interface FsOpEmptyTrashRequest {
  readonly command: 'op-empty-trash';
}

export interface FsOpJobRequest {
  readonly command: 'op-status' | 'op-cancel';
  readonly jobId: string;
}

/**
 * Things every file manager has (PRD 003, §5) — the commands `/api/fs`
 * answers as `rename`, `mkdir`, `create`, `search` and `watch`.
 */

/** Rename or move one entry; `to` is the full root-relative path it will have. */
export interface FsRenameRequest {
  readonly command: 'rename';
  readonly path: string;
  readonly to: string;
}

/** Make an empty folder (`mkdir`) or file (`create-file`) called `name` in the folder `path`. */
export interface FsCreateRequest {
  readonly command: 'mkdir' | 'create-file';
  readonly path: string;
  readonly name: string;
}

/** Find entries by name beneath the folder `path`. */
export interface FsSearchRequest {
  readonly command: 'search';
  readonly path: string;
  readonly query: string;
  readonly limit?: number;
}

/** Which of the folders on screen changed since the session's last call; `null` starts a session. */
export interface FsWatchRequest {
  readonly command: 'watch';
  readonly watchId: string | null;
  readonly paths: readonly string[];
}

export interface FsOpDeleteRequest {
  readonly command: 'op-delete';
  readonly paths: readonly string[];
}

export interface FsOpRestoreRequest {
  readonly command: 'op-restore';
  readonly ids: readonly string[];
}

/** Where to start, and the Places pane (PRD 003, §6) — `GET /api/fs/places`. */
export interface FsPlacesRequest {
  readonly command: 'places';
}

/** One folder of a zip (PRD 003, §6) — `GET /api/archive/list`. */
export interface FsArchiveListRequest {
  readonly command: 'archive-list';
  readonly path: string;
  readonly inner: string;
}

/** *Compress* — `POST /api/ops/compress`. */
export interface FsOpCompressRequest {
  readonly command: 'op-compress';
  readonly sources: readonly string[];
  readonly destination: string;
  readonly name: string;
  readonly conflict: ConflictPolicy;
}

/** *Extract* — `POST /api/ops/extract`. */
export interface FsOpExtractRequest {
  readonly command: 'op-extract';
  readonly path: string;
  readonly destination: string;
  readonly conflict: ConflictPolicy;
}

/**
 * Git (PRD 011, §1) — `/api/git/<action>`, one command for all of it: the
 * fields beside `action` are that action's query or body, as HTTP sends them.
 */
export interface FsGitRequest {
  readonly command: 'git';
  readonly git: GitRequest;
}

/** Where entries are on the backend's disk (PRD 004, §1.3.2) — `GET /api/fs/host-paths`. */
export interface FsHostPathsRequest {
  readonly command: 'host-paths';
  readonly paths: readonly string[];
}

export type FsBridgeRequest =
  | FsHostPathsRequest
  | FsGitRequest
  | FsArchiveListRequest
  | FsOpCompressRequest
  | FsOpExtractRequest
  | FsPlacesRequest
  | FsAuthStatusRequest
  | FsLoginRequest
  | FsLogoutRequest
  | FsListRequest
  | FsDetailsRequest
  | FsReadRequest
  | FsUploadBeginRequest
  | FsUploadChunkRequest
  | FsUploadCommitRequest
  | FsUploadAbortRequest
  | FsOpInfoRequest
  | FsOpTransferRequest
  | FsOpTrashRequest
  | FsOpEmptyTrashRequest
  | FsOpJobRequest
  | FsRenameRequest
  | FsCreateRequest
  | FsSearchRequest
  | FsWatchRequest
  | FsOpDeleteRequest
  | FsOpRestoreRequest;

/** One chunk of a file, with the metadata the HTTP headers would have carried. */
export interface FsReadResult {
  readonly path: string;
  readonly name: string;
  /** Size of the whole file, not of this chunk. */
  readonly size: number;
  /** Guessed from the extension; `null` when unknown. */
  readonly mimeType: string | null;
  /** Where in the file `content` starts. */
  readonly offset: number;
  readonly content: Uint8Array;
}

/** An upload that has been accepted and is waiting for its bytes. */
export interface FsUploadBeginResult {
  readonly uploadId: string;
}

/**
 * Where an entry is on this machine — for the desktop shell only, to hand it
 * to the operating system (`FileSystemBridge.localPath`). Never a command: a
 * host path is not the renderer's business.
 */
export interface FsLocalPath {
  /** Absolute host path of the entry itself; a link is not followed. */
  readonly absolute: string;
  readonly name: string;
  /** What it is, a link judged by what it leads to. */
  readonly type: FileEntryType;
  /** A regular file with an execute bit set. */
  readonly executable: boolean;
}

/** What each command answers with on success. */
export interface FsBridgeResults {
  readonly list: DirectoryListingDto;
  readonly details: FileDetailsDto;
  readonly read: FsReadResult;
  readonly 'upload-begin': FsUploadBeginResult;
  readonly 'upload-chunk': { readonly received: number };
  readonly 'upload-commit': FileDetailsDto;
  readonly 'upload-abort': { readonly aborted: true };
  readonly 'auth-status': AuthStatusDto;
  readonly login: AuthStatusDto;
  readonly logout: AuthStatusDto;
  readonly 'op-info': OperationsInfoDto;
  readonly 'op-copy': OperationJobDto;
  readonly 'op-move': OperationJobDto;
  readonly 'op-trash': OperationJobDto;
  readonly 'op-empty-trash': OperationJobDto;
  readonly 'op-status': OperationJobDto;
  readonly 'op-cancel': OperationJobDto;
  readonly rename: FileDetailsDto;
  readonly mkdir: FileDetailsDto;
  readonly 'create-file': FileDetailsDto;
  readonly search: SearchResultDto;
  readonly watch: WatchResultDto;
  readonly 'op-delete': OperationJobDto;
  readonly 'op-restore': OperationJobDto;
  readonly places: PlacesDto;
  readonly 'archive-list': ArchiveListingDto;
  readonly 'op-compress': OperationJobDto;
  readonly 'op-extract': OperationJobDto;
  /** What the action answers: `GitInfoDto`, `GitStatusDto`, `GitLogDto`, … */
  readonly git: unknown;
  readonly 'host-paths': { readonly paths: readonly string[] };
}

export interface FsBridgeSuccess<T> {
  readonly data: T;
}

/**
 * A failure, flattened into data.
 *
 * `status` is the HTTP status the same failure would have produced. It is
 * carried even though no HTTP is involved, so one `FsError` in the frontend
 * can describe either transport without the caller knowing which it got.
 */
export interface FsBridgeFailure {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly status: number;
    readonly details?: unknown;
  };
}

export type FsBridgeResponse<T = unknown> = FsBridgeSuccess<T> | FsBridgeFailure;
