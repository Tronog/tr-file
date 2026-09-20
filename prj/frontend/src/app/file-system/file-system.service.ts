import { Service, inject } from '@angular/core';
import { FsReadFeature } from './features/fs-read.feature';
import { FsTransferFeature } from './features/fs-transfer.feature';
import { FsBridgeService } from './fs-bridge.service';
import { FsHttpService } from './fs-http.service';
import type { FsTransport } from './fs-transport';

/**
 * Access to the backend file system (PRD 001, §7).
 *
 * Deliberately thin, per `docs/ai/ANGULAR.md`: it owns the transport, one
 * instance of each feature class, and nothing else. All behaviour — listing,
 * details, download, upload — lives in the features.
 *
 * Since §8.1 it also owns the one decision the app makes about *how* it
 * reaches the backend. Inside the Electron shell a preload script has put a
 * bridge on `window`, and going through it reaches the same `FilesService`
 * directly; in a browser there is no bridge and the transport is `/api/fs`
 * over HTTP. The choice is made once, here, so that nothing downstream —
 * features, workbench, components — ever branches on it.
 */
@Service()
export class FileSystemService {
  private readonly httpTransport = inject(FsHttpService);
  private readonly bridgeTransport = inject(FsBridgeService);

  /** How this session talks to the backend; fixed for its lifetime. */
  readonly transport: FsTransport = this.bridgeTransport.isAvailable
    ? this.bridgeTransport
    : this.httpTransport;

  /* -- features ---------------------------------------------------------- */

  /** Directory listings and entry details. */
  readonly readFt = new FsReadFeature(this);

  /** Downloads and uploads, including per-upload progress. */
  readonly transferFt = new FsTransferFeature(this);
}
