/**
 * File operations (PRD 005, §1): copy, move, move to trash, empty trash —
 * each a background job that reports how far it has got and can be stopped —
 * and, since PRD 003 §5, delete for good and restore from the trash.
 */

export type OperationKind = 'copy' | 'move' | 'trash' | 'empty-trash' | 'delete' | 'restore' | 'compress' | 'extract';

/**
 * `waiting` — paused on an entry it could not do, until the client says what
 * to do about it (PRD 001, Fix 3); see `OperationDecision`.
 */
export type OperationState = 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';

/**
 * What a job does when an entry fails — it cannot be read, written, removed:
 *
 * - `fail` — the job ends there, `failed`, as it always has;
 * - `ask` — the job waits (`waiting`, with the `problem`), and the client
 *   answers with an `OperationDecision`, as Midnight Commander asks.
 *
 * Only a client that will answer asks for `ask`; one that never heard of it
 * gets `fail`, and so never a job that waits for nobody.
 */
export type OperationErrorPolicy = 'fail' | 'ask';

/**
 * The answer to a job that is `waiting` (PRD 001, Fix 3), Midnight
 * Commander's four: pass over this entry (`skip`), and every later one that
 * fails too (`skip-all`); try it again (`retry`); or stop the job (`abort`).
 */
export type OperationDecision = 'skip' | 'skip-all' | 'retry' | 'abort';

/** Why a job is `waiting`: the entry, root-relative, and what went wrong with it. */
export interface OperationProblemDto {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

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
  /** What an entry that fails does; `fail` when left out. */
  readonly errors?: OperationErrorPolicy;
}

export interface TrashOperationRequest {
  readonly kind: 'trash';
  readonly paths: readonly string[];
  readonly errors?: OperationErrorPolicy;
}

export interface EmptyTrashOperationRequest {
  readonly kind: 'empty-trash';
}

/** Removes entries for good — no trash. */
export interface DeleteOperationRequest {
  readonly kind: 'delete';
  readonly paths: readonly string[];
  readonly errors?: OperationErrorPolicy;
}

/** Puts trashed entries back, by the ids a trash job's `outcome` gave them. */
export interface RestoreOperationRequest {
  readonly kind: 'restore';
  readonly ids: readonly string[];
  readonly errors?: OperationErrorPolicy;
}

/**
 * *Compress* (PRD 003, §6): a zip of `sources` as `destination/name`.
 * `conflict` is what to do when that name is taken.
 */
export interface CompressOperationRequest {
  readonly kind: 'compress';
  readonly sources: readonly string[];
  readonly destination: string;
  readonly name: string;
  readonly conflict: ConflictPolicy;
}

/**
 * *Extract* (PRD 003, §6): a zip into `destination` — its one top entry
 * straight in, or everything into a folder named after the archive.
 * `conflict` is what to do when that top name is taken.
 */
export interface ExtractOperationRequest {
  readonly kind: 'extract';
  readonly path: string;
  readonly destination: string;
  readonly conflict: ConflictPolicy;
}

export type OperationRequest =
  | CompressOperationRequest
  | ExtractOperationRequest
  | TransferOperationRequest
  | TrashOperationRequest
  | EmptyTrashOperationRequest
  | DeleteOperationRequest
  | RestoreOperationRequest;

/**
 * Where one entry of a job ended up — what Undo needs (PRD 003, §5):
 *
 * - copy: the source → the copy made of it;
 * - move: the source → where it is now;
 * - trash: the source → the id the trash can restore it by (only when it has one);
 * - restore: that id → the path it is back at;
 * - compress: the first source → the zip made;
 * - extract: the archive → what it made at the destination's top.
 *
 * Top-level entries only, and only those actually done: a skipped one has none.
 */
export interface OperationOutcomeDto {
  readonly source: string;
  readonly target: string;
}

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
  /** While `waiting`: the entry it could not do, and why (PRD 001, Fix 3). */
  readonly problem: OperationProblemDto | null;
  /** Folders whose listing the job changed, root-relative: what a client should read again. */
  readonly affected: readonly string[];
  /** Where each entry went, filled in as they are done; see `OperationOutcomeDto`. */
  readonly outcome: readonly OperationOutcomeDto[];
}

/**
 * Where trashed entries go. The server keeps its own, inside the files root
 * (`ServerTrash`); the desktop, on its own machine, uses the system's — the
 * one the user's file manager shows — through the shell (`prj/desktop`).
 */
export interface TrashProvider {
  readonly kind: 'server' | 'system';
  /**
   * Moves one entry to the trash. `relative` is its root-relative path, for
   * the record. Resolves with the id `restore` knows it by — or `null` when
   * this trash cannot put things back (a system trash: the user's own file
   * manager does that).
   */
  trash(absolute: string, relative: string): Promise<string | null>;
  /**
   * Where the trashed entry `id` came from, root-relative, as it was
   * recorded; `null` when there is no such entry. Paired with `restore`.
   */
  originOf?(id: string): Promise<string | null>;
  /**
   * Moves the trashed entry `id` to `absolute` and forgets its record.
   * `OperationsService` decides `absolute` — the recorded place, or a free
   * name beside it — and makes its folder; the trash only lets go of it.
   * A trash that has this (and `originOf`) can restore.
   */
  restore?(id: string, absolute: string): Promise<void>;
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

/** `GET /api/ops/info`: whose trash a trashed entry goes to, and whether it can come back. */
export interface OperationsInfoDto {
  readonly trash: TrashProvider['kind'];
  /** `restore` works: the trash hands out ids (`outcome`) and puts entries back by them. */
  readonly canRestore: boolean;
}
