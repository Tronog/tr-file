import type { FileSystemService } from '../file-system.service';
import type { FsOperationDecision, FsOperationJob, FsOperationRequest, FsOperationsInfo } from '../file-system.model';

/**
 * File operations on the backend (PRD 005, §1): copy, move, move to trash and
 * empty trash, each a background job there.
 *
 * Stateless, like `FsTransferFeature`: a job is started and then asked about
 * by id — how often is the caller's business (the workbench asks once a
 * second). On the desktop against its own machine the backend runs in the
 * main process and trashes into the system trash; over HTTP, or on a remote
 * server, it is that server that does the work. Neither shows here.
 */
export class FsOperationsFeature {
  private info: Promise<FsOperationsInfo> | null = null;

  constructor(private readonly parent: FileSystemService) {}

  /** Whose trash things go to; asked once, and a failure asks again next time. */
  operationsInfo(): Promise<FsOperationsInfo> {
    this.info ??= this.parent.transport.operationsInfo().catch((error: unknown) => {
      this.info = null;
      throw error;
    });
    return this.info;
  }

  start(request: FsOperationRequest): Promise<FsOperationJob> {
    return this.parent.transport.startOperation(request);
  }

  status(id: string): Promise<FsOperationJob> {
    return this.parent.transport.operationStatus(id);
  }

  cancel(id: string): Promise<FsOperationJob> {
    return this.parent.transport.cancelOperation(id);
  }

  /** What a waiting job should do about the entry it could not do (PRD 001, Fix 3). */
  resolve(id: string, decision: FsOperationDecision): Promise<FsOperationJob> {
    return this.parent.transport.resolveOperation(id, decision);
  }
}
