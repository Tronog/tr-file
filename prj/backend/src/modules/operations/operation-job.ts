import { randomUUID } from 'node:crypto';

import type {
  OperationDecision,
  OperationErrorPolicy,
  OperationJobDto,
  OperationKind,
  OperationOutcomeDto,
  OperationProblemDto,
  OperationState,
} from './operation.model.js';

/**
 * How long a job waits for an answer about an entry it could not do (PRD 001,
 * Fix 3) before it gives up, as if told to abort — a client that went away
 * must not leave a job holding its place for ever.
 */
export const DECISION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * One running operation: its progress, updated as it goes, and the switch
 * that stops it. The runner writes the counters; `toJSON` is what a client
 * polling for progress sees.
 *
 * With `errors: 'ask'` an entry that fails does not end the job: the runner
 * calls `ask`, the job is `waiting` with the `problem`, and `decide` — the
 * client's answer — lets it go on. *Skip All* is remembered here, so every
 * later failure is passed over without asking again.
 */
export class OperationJob {
  readonly id = randomUUID();
  readonly controller = new AbortController();
  readonly startedAt = new Date();
  readonly affected = new Set<string>();
  /** Where each entry went, in the order they were done. */
  readonly outcome: OperationOutcomeDto[] = [];

  state: OperationState = 'running';
  finishedAt: Date | null = null;
  totalBytes: number | null = null;
  doneBytes = 0;
  totalItems: number | null = null;
  doneItems = 0;
  skipped = 0;
  current: string | null = null;
  error: { code: string; message: string } | null = null;
  problem: OperationProblemDto | null = null;

  /** Whether *Skip All* was chosen: later failures are skipped without asking. */
  private skipAll = false;
  /** The answer the runner is waiting for, while `waiting`. */
  private pending: { readonly resolve: (decision: OperationDecision) => void; readonly timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    readonly kind: OperationKind,
    readonly title: string,
    /** What an entry that fails does; see `OperationErrorPolicy`. */
    readonly errors: OperationErrorPolicy = 'fail',
  ) {
    // Cancelling a job that is waiting is the same as aborting it.
    this.controller.signal.addEventListener('abort', () => this.decide('abort'), { once: true });
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  /**
   * Waits for what to do about `problem`: `skip`, `retry` or `abort` —
   * `skip-all` arrives as `skip`, and is remembered. Answers at once with
   * `skip` after a *Skip All*, and with `abort` once the job is cancelled.
   */
  ask(problem: OperationProblemDto): Promise<Exclude<OperationDecision, 'skip-all'>> {
    if (this.signal.aborted) {
      return Promise.resolve('abort');
    }
    if (this.skipAll) {
      return Promise.resolve('skip');
    }
    this.state = 'waiting';
    this.problem = problem;
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.decide('abort'), DECISION_TIMEOUT_MS);
      timer.unref?.();
      this.pending = { resolve: (decision) => resolve(decision === 'skip-all' ? 'skip' : decision), timer };
    });
  }

  /** The client's answer while `waiting`; `false` when the job is not waiting for one. */
  decide(decision: OperationDecision): boolean {
    const pending = this.pending;
    if (pending === null) {
      return false;
    }
    this.pending = null;
    clearTimeout(pending.timer);
    if (decision === 'skip-all') {
      this.skipAll = true;
    }
    this.state = 'running';
    this.problem = null;
    pending.resolve(decision);
    return true;
  }

  finish(state: Exclude<OperationState, 'running' | 'waiting'>, error?: { code: string; message: string }): void {
    if (this.state !== 'running' && this.state !== 'waiting') {
      return;
    }
    this.state = state;
    this.finishedAt = new Date();
    this.current = null;
    this.problem = null;
    this.error = error ?? null;
  }

  toJSON(): OperationJobDto {
    return {
      id: this.id,
      kind: this.kind,
      state: this.state,
      title: this.title,
      startedAt: this.startedAt.toISOString(),
      finishedAt: this.finishedAt?.toISOString() ?? null,
      totalBytes: this.totalBytes,
      doneBytes: this.doneBytes,
      totalItems: this.totalItems,
      doneItems: this.doneItems,
      current: this.current,
      skipped: this.skipped,
      error: this.error,
      problem: this.problem,
      affected: [...this.affected],
      outcome: [...this.outcome],
    };
  }
}
