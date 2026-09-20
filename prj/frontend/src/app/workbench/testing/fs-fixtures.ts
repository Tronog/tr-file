import { HttpParams } from '@angular/common/http';
import type {
  FsDetails,
  FsDirectoryListing,
  FsEntry,
  FsEnvelope,
  FsErrorBody,
} from '../../file-system/file-system.model';

/**
 * Builders for the `/api/fs` wire shapes, shared by the workbench specs.
 *
 * Not a spec itself: a plain module the specs import, so each one can say
 * `fsDirectory('docs')` instead of restating twenty contract fields. Every
 * builder takes overrides, so a test only writes down what it is about.
 */

/** Basename of a root-relative path; `''` (the root) keeps an empty name. */
function basename(path: string): string {
  return path === '' ? '' : (path.split('/').at(-1) ?? path);
}

/** Parent of a root-relative path, or `null` for the root itself. */
function parentOf(path: string): string | null {
  if (path === '') {
    return null;
  }
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/* -- entries ------------------------------------------------------------- */

/** One file entry. `hidden` follows the name unless it is overridden. */
export function fsEntry(path: string, overrides: Partial<FsEntry> = {}): FsEntry {
  const name = basename(path);
  return {
    name,
    path,
    type: 'file',
    size: 1024,
    hidden: name.startsWith('.'),
    modifiedAt: '2026-09-20T13:04:00.000Z',
    createdAt: '2026-09-01T09:00:00.000Z',
    ...overrides,
  };
}

/** One directory entry. */
export function fsDirectory(path: string, overrides: Partial<FsEntry> = {}): FsEntry {
  return fsEntry(path, { type: 'directory', size: 4096, ...overrides });
}

/** A directory listing; `parent` is derived from `path`. */
export function fsListing(
  path: string,
  entries: readonly FsEntry[] = [],
  overrides: Partial<FsDirectoryListing> = {},
): FsDirectoryListing {
  return { path, parent: parentOf(path), entries, ...overrides };
}

/** Full details for one entry, defaulting to a readable 0644 file. */
export function fsDetails(path: string, overrides: Partial<FsDetails> = {}): FsDetails {
  const base = fsEntry(path);
  return {
    ...base,
    parent: parentOf(path),
    accessedAt: '2026-09-21T08:15:00.000Z',
    changedAt: '2026-09-20T13:04:00.000Z',
    mode: '0644',
    permissions: {
      owner: { read: true, write: true, execute: false },
      group: { read: true, write: false, execute: false },
      others: { read: true, write: false, execute: false },
    },
    uid: 1000,
    gid: 1000,
    inode: 42,
    sizeOnDisk: 4096,
    mimeType: null,
    symlinkTarget: null,
    entryCount: null,
    ...overrides,
  };
}

/** Full details for a directory: 0755, an entry count, no size on its own. */
export function fsDirectoryDetails(path: string, overrides: Partial<FsDetails> = {}): FsDetails {
  return fsDetails(path, {
    type: 'directory',
    size: 4096,
    mode: '0755',
    permissions: {
      owner: { read: true, write: true, execute: true },
      group: { read: true, write: false, execute: true },
      others: { read: true, write: false, execute: true },
    },
    entryCount: 3,
    ...overrides,
  });
}

/* -- envelopes ----------------------------------------------------------- */

/** Wraps a payload the way every successful response does. */
export function fsEnvelope<T>(data: T): FsEnvelope<T> {
  return { data };
}

/** The contract's error body, for `flush(…, { status })`. */
export function fsErrorBody(code: string, message: string): FsErrorBody {
  return { error: { code, message } };
}

/* -- URLs ---------------------------------------------------------------- */

function endpointUrl(endpoint: string, params: HttpParams): string {
  return `/api/fs/${endpoint}?${params.toString()}`;
}

/** The URL `FsReadFeature` lists a directory with. */
export function listUrl(path: string): string {
  return endpointUrl('list', new HttpParams().set('path', path));
}

/** The URL `FsReadFeature` reads one entry's details with. */
export function detailsUrl(path: string): string {
  return endpointUrl('details', new HttpParams().set('path', path));
}

/** The URL `FsTransferFeature` uploads into a directory with. */
export function uploadUrl(directoryPath: string, overwrite = false): string {
  return endpointUrl(
    'upload',
    new HttpParams().set('path', directoryPath).set('overwrite', overwrite ? 'true' : 'false'),
  );
}

/** The URL the browser is handed to download a file. */
export function downloadUrl(path: string): string {
  return endpointUrl('download', new HttpParams().set('path', path));
}

/* -- timing -------------------------------------------------------------- */

/**
 * Lets the promise chain behind the cache run to completion.
 *
 * `FsDataFeature` awaits the read feature, which awaits `firstValueFrom`, so a
 * flushed response lands several microtasks later. A macrotask drains all of
 * them, whatever the depth.
 */
export function settled(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
