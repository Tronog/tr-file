import type { Signal } from '@angular/core';

/**
 * TypeScript mirrors of the `/api/fs` contract (PRD 001, Section 7).
 *
 * These are the wire shapes, one-for-one with the backend DTOs — no view
 * concerns, no formatting. Everything is `readonly`: nothing that comes off the
 * network is ever mutated in place.
 */

/** What a directory entry is, as the backend classifies it. */
export type FsEntryType = 'file' | 'directory' | 'symlink' | 'other';

/** One entry of a directory listing. */
export interface FsEntry {
  /** Basename; `''` for the root itself. */
  readonly name: string;
  /** Root-relative POSIX path, no leading slash. */
  readonly path: string;
  readonly type: FsEntryType;
  /** Size in bytes. */
  readonly size: number;
  /** True when the name starts with `.`. */
  readonly hidden: boolean;
  /** ISO 8601. */
  readonly modifiedAt: string;
  /** ISO 8601. */
  readonly createdAt: string;
}

/** The payload of `GET /api/fs/list`. */
export interface FsDirectoryListing {
  readonly path: string;
  /** `null` at the root. */
  readonly parent: string | null;
  /** Directories first, then files, case-insensitive. */
  readonly entries: readonly FsEntry[];
}

/** One `rwx` triplet of a POSIX mode. */
export interface FsPermissionTriplet {
  readonly read: boolean;
  readonly write: boolean;
  readonly execute: boolean;
}

/** The three triplets of a POSIX mode. */
export interface FsPermissions {
  readonly owner: FsPermissionTriplet;
  readonly group: FsPermissionTriplet;
  readonly others: FsPermissionTriplet;
}

/** The payload of `GET /api/fs/details`, and of a successful upload. */
export interface FsDetails extends FsEntry {
  /** `null` at the root. */
  readonly parent: string | null;
  readonly accessedAt: string;
  readonly changedAt: string;
  /** Four octal digits, e.g. `'0644'`. */
  readonly mode: string;
  readonly permissions: FsPermissions;
  readonly uid: number;
  readonly gid: number;
  readonly inode: number;
  /** `blocks * 512`. */
  readonly sizeOnDisk: number;
  /** Guessed from the extension; `null` when unknown. */
  readonly mimeType: string | null;
  /** Root-relative when the target is inside the root, else `null`. */
  readonly symlinkTarget: string | null;
  /** Directories only; `null` for anything else. */
  readonly entryCount: number | null;
}

/** Every JSON success response is wrapped in this envelope. */
export interface FsEnvelope<T> {
  readonly data: T;
}

/** Every error response body, for the statuses listed in the contract. */
export interface FsErrorBody {
  readonly error: {
    /** `BAD_REQUEST`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, … */
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}

/**
 * How far an upload has got.
 *
 * `total` and `percent` are `null` until the browser reports a content length —
 * some environments never do, so callers must handle the indeterminate case.
 */
export interface FsUploadProgress {
  readonly loaded: number;
  readonly total: number | null;
  readonly percent: number | null;
}

/**
 * A single in-flight upload.
 *
 * All of an upload's state lives on this object rather than on the feature, so
 * any number of uploads can run at once without treading on each other.
 */
export interface FsUpload {
  /** Bytes sent so far, updated as the request streams out. */
  readonly progress: Signal<FsUploadProgress>;
  /** Resolves with the stored file's details, or rejects with an `FsError`. */
  readonly result: Promise<FsDetails>;
  /** Aborts the request; `result` then rejects with an `FsError`. */
  cancel(): void;
}
