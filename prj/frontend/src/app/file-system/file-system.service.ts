import { HttpClient } from '@angular/common/http';
import { Injector, Service, inject } from '@angular/core';
import { FsReadFeature } from './features/fs-read.feature';
import { FsTransferFeature } from './features/fs-transfer.feature';

/**
 * Access to the backend file system (`/api/fs`, PRD 001 Section 7).
 *
 * Deliberately thin, per `docs/ai/ANGULAR.md`: it owns the `HttpClient`, the
 * base path every request hangs off, and one instance of each feature class.
 * All behaviour — listing, details, download, upload — lives in the features.
 *
 * Nothing here is wired into the UI yet; the PRD defers that.
 */
@Service()
export class FileSystemService {
  /** The single HTTP entry point the features share. */
  readonly http = inject(HttpClient);

  /**
   * Captured so `httpResource()` can be created outside an injection context —
   * a caller may build a reader from a lifecycle hook or an event handler.
   */
  readonly injector = inject(Injector);

  /** Every endpoint of the contract hangs off this prefix. */
  readonly baseUrl = '/api/fs';

  /* -- features ---------------------------------------------------------- */

  /** Directory listings and entry details, imperative and reactive. */
  readonly readFt = new FsReadFeature(this);

  /** Downloads and uploads, including per-upload progress. */
  readonly transferFt = new FsTransferFeature(this);
}
