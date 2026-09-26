import { randomUUID } from 'node:crypto';

import type { OperationJobDto, OperationKind, OperationState } from './operation.model.js';

/**
 * One running operation: its progress, updated as it goes, and the switch
 * that stops it. The runner writes the counters; `toJSON` is what a client
 * polling for progress sees.
 */
export class OperationJob {
  readonly id = randomUUID();
  readonly controller = new AbortController();
  readonly startedAt = new Date();
  readonly affected = new Set<string>();

  state: OperationState = 'running';
  finishedAt: Date | null = null;
  totalBytes: number | null = null;
  doneBytes = 0;
  totalItems: number | null = null;
  doneItems = 0;
  skipped = 0;
  current: string | null = null;
  error: { code: string; message: string } | null = null;

  constructor(
    readonly kind: OperationKind,
    readonly title: string,
  ) {}

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  finish(state: Exclude<OperationState, 'running'>, error?: { code: string; message: string }): void {
    if (this.state !== 'running') {
      return;
    }
    this.state = state;
    this.finishedAt = new Date();
    this.current = null;
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
      affected: [...this.affected],
    };
  }
}
