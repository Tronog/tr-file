import { computed, signal } from '@angular/core';
import type { FsOperationJob } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import type { WorkbenchService } from '../workbench.service';

/** How many changes Undo remembers; older ones fall off the bottom. */
const DEPTH = 20;

/**
 * One change Undo can take back — or explain why it cannot: `undo` is `null`
 * for a delete, or a trash nothing in the app can restore from, and `reason`
 * says where to go instead. Such a step still takes its place on the stack,
 * or `Ctrl`+`Z` would reach past it and undo something older by surprise.
 */
export interface UndoStep {
  /** What was done, for *Edit › Undo Rename* and the like. */
  readonly label: string;
  readonly undo: (() => Promise<void>) | null;
  readonly reason?: string;
}

function parentOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * `Ctrl`+`Z` for the file system (PRD 003, §5), the way Explorer and Finder
 * have it: the last change, taken back.
 *
 * - **Rename** — renamed back.
 * - **New folder / new file** — moved to the trash; whatever was put in it
 *   since is not lost.
 * - **Move** — each entry put back where it was, by a rename, since the job
 *   says where each one went (`outcome`).
 * - **Copy** — the copies moved to the trash, after asking.
 * - **Move to trash** — restored, where the trash can be restored from the
 *   app (the server's own); from the system's trash it is the user's to do.
 * - **Delete** — cannot be undone, and says so.
 *
 * One level of history per window, not per panel: the file system is shared,
 * and so is what was last done to it. Undoing is not itself undoable.
 */
export class UndoFeature {
  private readonly stack = signal<readonly UndoStep[]>([]);
  private readonly running = signal(false);

  constructor(private readonly parent: WorkbenchService) {}

  readonly canUndo = computed(() => this.stack().length > 0 && !this.running());

  /** `Undo Rename`, or plain `Undo` when there is nothing to take back. */
  readonly label = computed(() => {
    const step = this.stack().at(-1);
    return step === undefined ? 'Undo' : `Undo ${step.label}`;
  });

  record(step: UndoStep): void {
    this.stack.update((steps) => [...steps, step].slice(-DEPTH));
  }

  /**
   * A job the user started has ended; what it managed to do — even a
   * cancelled or failed one, part of the way — is recorded to take back.
   */
  recordJob(job: FsOperationJob, canRestore: boolean): void {
    const outcome = job.outcome ?? [];
    switch (job.kind) {
      case 'move':
        if (outcome.length > 0) {
          this.record({ label: 'Move', undo: () => this.putBack(outcome) });
        }
        break;
      case 'copy':
        if (outcome.length > 0) {
          this.record({ label: 'Copy', undo: () => this.removeCopies(outcome.map((pair) => pair.target)) });
        }
        break;
      case 'trash':
        if (canRestore && outcome.length > 0) {
          const ids = outcome.map((pair) => pair.target);
          this.record({ label: 'Move to Trash', undo: () => this.parent.operationsFt.restore(ids) });
        } else if (job.doneItems > 0) {
          this.record({
            label: 'Move to Trash',
            undo: null,
            reason: 'What was moved to the trash can be restored from the trash itself, with your file manager.',
          });
        }
        break;
      // What a zip made — the archive, or what was extracted — goes to the trash (PRD 003, §6).
      case 'compress':
      case 'extract':
        if (outcome.length > 0) {
          this.record({
            label: job.kind === 'compress' ? 'Compress' : 'Extract',
            undo: () => this.removeCopies(outcome.map((pair) => pair.target)),
          });
        }
        break;
      case 'delete':
        if (job.doneItems > 0) {
          this.record({ label: 'Delete', undo: null, reason: 'Deleting permanently cannot be undone.' });
        }
        break;
      default:
        break;
    }
  }

  /** Takes back the last change; `Ctrl`+`Z` in a panel, *Edit › Undo*. */
  async undo(): Promise<void> {
    const step = this.stack().at(-1);
    if (step === undefined || this.running()) {
      return;
    }
    this.stack.update((steps) => steps.slice(0, -1));
    if (step.undo === null) {
      await this.parent.modal.message({ message: `The last change — ${step.label.toLowerCase()} — cannot be undone.`, ...(step.reason ? { detail: step.reason } : {}) });
      return;
    }
    this.running.set(true);
    try {
      await step.undo();
    } catch (error) {
      await this.parent.modal.message({
        severity: 'error',
        message: `Could not undo ${step.label.toLowerCase()}.`,
        detail: FsError.from(error).message,
      });
    } finally {
      this.running.set(false);
    }
  }

  /** Each moved entry back where it came from, newest first; what cannot go back is named. */
  private async putBack(outcome: readonly { source: string; target: string }[]): Promise<void> {
    const failed: string[] = [];
    let problem: FsError | null = null;
    for (const { source, target } of [...outcome].reverse()) {
      try {
        await this.parent.fileSystem.editFt.rename(target, source);
        await this.parent.fileEditFt.renamed(target, source, null);
      } catch (error) {
        failed.push(nameOf(target));
        problem = FsError.from(error);
      }
    }
    if (problem !== null) {
      await this.parent.modal.message({
        severity: 'warning',
        message:
          failed.length === 1
            ? `'${failed[0]}' could not be moved back.`
            : `${failed.length} items could not be moved back.`,
        detail: problem.message,
      });
    }
  }

  /** The copies a copy made, moved to the trash — after asking, since they may have been changed since. */
  private async removeCopies(paths: readonly string[]): Promise<void> {
    const confirmed = await this.parent.modal.confirm({
      severity: 'warning',
      message:
        paths.length === 1
          ? `Undo the copy by moving '${nameOf(paths[0] as string)}' to the trash?`
          : `Undo the copy by moving the ${paths.length} copies to the trash?`,
      detail: `They are in '/${parentOf(paths[0] as string)}'.`,
      confirmLabel: 'Move to Trash',
    });
    if (confirmed) {
      await this.parent.operationsFt.trashQuietly(paths);
    }
  }
}
