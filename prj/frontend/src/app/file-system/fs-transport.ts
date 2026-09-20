import type { FsDetails, FsDirectoryListing, FsUpload } from './file-system.model';

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

/**
 * A URL the browser can save a file from, and the cleanup that goes with it.
 *
 * Over HTTP it is the download endpoint and `release` does nothing. On the
 * desktop there is no such URL, so the bytes are fetched and wrapped in an
 * object URL — which must be revoked, hence `release`. Callers do not care
 * which they got; they must call `release` either way.
 */
export interface FsSaveUrl {
  readonly url: string;
  release(): void;
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
   * Reads a file's bytes.
   *
   * `maxBytes` is advisory: a transport that can refuse an oversized file
   * *before* reading it does so, and one that cannot simply ignores it. Either
   * way the caller still checks what it got, so both behave the same.
   */
  read(path: string, maxBytes?: number): Promise<Blob>;

  /** A URL the browser can stream to disk from; see {@link FsSaveUrl}. */
  saveUrl(path: string): Promise<FsSaveUrl>;

  /** Uploads one file into `directoryPath`, reporting progress as it goes. */
  upload(directoryPath: string, file: File, options?: FsUploadOptions): FsUpload;
}
