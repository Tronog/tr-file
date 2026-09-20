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

import type { DirectoryListingDto, FileDetailsDto } from '../files/models/index.js';

/** Every operation the bridge offers. */
export type FsBridgeCommand = 'list' | 'details' | 'read' | 'upload';

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
 * Read a file's bytes.
 *
 * `maxBytes` is refused *before* anything is read, which is the one place the
 * bridge is stricter than HTTP: an in-process caller gets the whole file as a
 * single buffer, so a cap is the only thing standing between a preview and a
 * gigabyte in memory.
 */
export interface FsReadRequest {
  readonly command: 'read';
  readonly path: string;
  readonly maxBytes?: number;
}

/** Store one file in a directory. `path` is the directory. */
export interface FsUploadRequest {
  readonly command: 'upload';
  readonly path: string;
  readonly filename: string;
  readonly content: Uint8Array;
  readonly overwrite: boolean;
}

export type FsBridgeRequest = FsListRequest | FsDetailsRequest | FsReadRequest | FsUploadRequest;

/** A file's bytes, with the metadata the HTTP headers would have carried. */
export interface FsReadResult {
  readonly path: string;
  readonly name: string;
  readonly size: number;
  /** Guessed from the extension; `null` when unknown. */
  readonly mimeType: string | null;
  readonly content: Uint8Array;
}

/** What each command answers with on success. */
export interface FsBridgeResults {
  readonly list: DirectoryListingDto;
  readonly details: FileDetailsDto;
  readonly read: FsReadResult;
  readonly upload: FileDetailsDto;
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
