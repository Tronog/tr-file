import type { FileSystemService } from '../file-system.service';
import type {
  FsGitBranches,
  FsGitDiff,
  FsGitInfo,
  FsGitLog,
  FsGitStatus,
  FsGitWriteAction,
} from '../file-system.model';

/**
 * Git on the backend (PRD 011, §1): the repository a folder is in, its log,
 * branches and diffs, and the changes to it. Every change answers with the
 * repository's status as it now is.
 *
 * Stateless, like the other features here — `GitFeature` in the workbench
 * keeps what is shown. Refusals arrive as `FsError`: `GIT_UNAVAILABLE` where
 * there is no git, `NOT_A_REPOSITORY`, and `GIT_FAILED` with git's own reason.
 */
export class FsGitFeature {
  constructor(private readonly parent: FileSystemService) {}

  /** Whether the backend can run git; a backend from before git says it cannot. */
  info(): Promise<FsGitInfo> {
    return this.parent.transport.git<FsGitInfo>('info');
  }

  status(path: string): Promise<FsGitStatus> {
    return this.parent.transport.git<FsGitStatus>('status', { path });
  }

  log(path: string, limit: number, skip = 0): Promise<FsGitLog> {
    return this.parent.transport.git<FsGitLog>('log', { path, limit, skip });
  }

  branches(path: string): Promise<FsGitBranches> {
    return this.parent.transport.git<FsGitBranches>('branches', { path });
  }

  /** One file's changes; `file` relative to the repository, as its status named it. */
  diff(path: string, file: string, staged: boolean): Promise<FsGitDiff> {
    return this.parent.transport.git<FsGitDiff>('diff', { path, file, staged });
  }

  /**
   * Changes the repository `path` is in — or, for `init`, makes one of the
   * folder — and answers with its status afterwards.
   */
  run(action: FsGitWriteAction, path: string, fields: Readonly<Record<string, string | boolean | readonly string[]>> = {}): Promise<FsGitStatus> {
    return this.parent.transport.git<FsGitStatus>(action, { ...fields, path });
  }
}
