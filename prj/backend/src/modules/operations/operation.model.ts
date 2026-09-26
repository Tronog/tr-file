/**
 * File operations (PRD 005, §1): copy, move, move to trash, empty trash —
 * each a background job that reports how far it has got and can be stopped.
 */

export type OperationKind = 'copy' | 'move' | 'trash' | 'empty-trash';

export type OperationState = 'running' | 'done' | 'failed' | 'cancelled';

/**
 * What to do when an entry of that name is already at the destination.
 *
 * - `fail` — refuse before anything is done, naming every clash (`409`);
 * - `overwrite` — replace what is there;
 * - `skip` — leave what is there, and the source where it is;
 * - `rename` — keep both: `name copy.ext`, `name copy 2.ext`, … as VS Code does.
 */
export type ConflictPolicy = 'fail' | 'overwrite' | 'skip' | 'rename';

/** Starting a copy or a move. Paths are root-relative, as everywhere in the API. */
export interface TransferOperationRequest {
  readonly kind: 'copy' | 'move';
  readonly sources: readonly string[];
  /** The folder the sources go into. */
  readonly destination: string;
  readonly conflict: ConflictPolicy;
}

export interface TrashOperationRequest {
  readonly kind: 'trash';
  readonly paths: readonly string[];
}

export interface EmptyTrashOperationRequest {
  readonly kind: 'empty-trash';
}

export type OperationRequest = TransferOperationRequest | TrashOperationRequest | EmptyTrashOperationRequest;

/**
 * A job as the API describes it. A client asks for it again to see progress —
 * once a second is plenty, and is what the frontend does — so progress costs
 * one small message a second however fast the job moves.
 */
export interface OperationJobDto {
  readonly id: string;
  readonly kind: OperationKind;
  readonly state: OperationState;
  /** e.g. `Copying 3 items to /docs`. */
  readonly title: string;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  /** `null` while unknown — still counting, or not countable (a system trash). */
  readonly totalBytes: number | null;
  readonly doneBytes: number;
  readonly totalItems: number | null;
  readonly doneItems: number;
  /** The entry being worked on, root-relative. */
  readonly current: string | null;
  /** Entries passed over by `skip`. */
  readonly skipped: number;
  readonly error: { readonly code: string; readonly message: string } | null;
  /** Folders whose listing the job changed, root-relative: what a client should read again. */
  readonly affected: readonly string[];
}

/**
 * Where trashed entries go. The server keeps its own, inside the files root
 * (`ServerTrash`); the desktop, on its own machine, uses the system's — the
 * one the user's file manager shows — through the shell (`prj/desktop`).
 */
export interface TrashProvider {
  readonly kind: 'server' | 'system';
  /** Moves one entry to the trash. `relative` is its root-relative path, for the record. */
  trash(absolute: string, relative: string): Promise<void>;
  /**
   * Deletes everything in the trash, for good. Reports how far it has got
   * when it can count; a system trash emptied by the shell cannot.
   */
  empty(progress: (done: number, total: number | null) => void, signal: AbortSignal): Promise<void>;
  /** Whether `absolute` is the trash itself, or inside it — never a source or a destination. */
  contains(absolute: string): boolean;
  /** The folder whose listing emptying changes, root-relative, when it is inside the root. */
  readonly affected: readonly string[];
}

/** `GET /api/ops/info`: whose trash a trashed entry goes to. */
export interface OperationsInfoDto {
  readonly trash: TrashProvider['kind'];
}
