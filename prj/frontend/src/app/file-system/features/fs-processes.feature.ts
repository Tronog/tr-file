import type { FileSystemService } from '../file-system.service';
import type { FsProcessEndResult, FsProcessesHistory, FsProcessesSnapshot } from '../file-system.model';

/**
 * The backend machine's processes (PRD 014, §1), measured there every two
 * seconds: the latest sample, the last ten minutes, and ending one.
 * Stateless, like the other features here; `TaskManagerFeature` in the
 * workbench polls and keeps them.
 */
export class FsProcessesFeature {
  constructor(private readonly parent: FileSystemService) {}

  list(): Promise<FsProcessesSnapshot> {
    return this.parent.transport.processes();
  }

  history(keys: readonly string[]): Promise<FsProcessesHistory> {
    return this.parent.transport.processHistory(keys);
  }

  end(key: string, tree = false): Promise<FsProcessEndResult> {
    return this.parent.transport.endProcess(key, tree);
  }
}
