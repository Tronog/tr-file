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

import type { AuthStatusDto } from '../auth/auth.model.js';
import type { DirectoryListingDto, FileDetailsDto } from '../files/models/index.js';

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
  | 'logout';

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

export type FsBridgeRequest =
  | FsAuthStatusRequest
  | FsLoginRequest
  | FsLogoutRequest
  | FsListRequest
  | FsDetailsRequest
  | FsReadRequest
  | FsUploadBeginRequest
  | FsUploadChunkRequest
  | FsUploadCommitRequest
  | FsUploadAbortRequest;

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
