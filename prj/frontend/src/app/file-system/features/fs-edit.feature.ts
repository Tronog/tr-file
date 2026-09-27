import type { FileSystemService } from '../file-system.service';
import type { FsDetails } from '../file-system.model';

/**
 * Changing the file system one entry at a time (PRD 003, §5): renaming, and
 * making a new folder or file. Each is quick, so each is a single request
 * that answers with the entry as it now is — unlike copy, move and trash,
 * which are jobs (`FsOperationsFeature`).
 *
 * Stateless, like the other features here. Refusals arrive as `FsError`:
 * `CONFLICT` when the name is taken, `BAD_REQUEST` for a name no file system
 * would take.
 */
export class FsEditFeature {
  constructor(private readonly parent: FileSystemService) {}

  /** Moves `path` to `to` — the same folder with a new name, or back where it came from. */
  rename(path: string, to: string): Promise<FsDetails> {
    return this.parent.transport.rename(path, to);
  }

  createFolder(parent: string, name: string): Promise<FsDetails> {
    return this.parent.transport.createFolder(parent, name);
  }

  createFile(parent: string, name: string): Promise<FsDetails> {
    return this.parent.transport.createFile(parent, name);
  }
}
