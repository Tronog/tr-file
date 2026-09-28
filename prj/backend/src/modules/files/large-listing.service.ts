import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';

import { HttpError, type Logger } from '../../core/index.js';
import type { FilePathResolver, ResolvedPath } from './file-path.resolver.js';
import type { FileEntryTargetType, FileEntryType } from './models/index.js';
import { LARGE_LISTING_WORKER_SOURCE } from './large-listing.worker.js';

/** The bounds of reading a large folder (PRD 004, §3.1). */
export const LARGE_LISTING = {
  /** A folder with this many entries or more is read in a worker, by stages; one with fewer at once, as ever. */
  threshold: 1000,
  /** Names the worker hands over per message (PRD 004, §3.1: in chunks of 10 000). */
  namesChunk: 10_000,
  /** Entries `lstat`ed per batch of details… */
  statBatch: 1000,
  /** …this many at a time. */
  concurrency: 64,
  /** Names one progress answer carries at most; the rest come with the next. */
  namesPerAnswer: 10_000,
  /** Details one progress answer carries at most. */
  detailsPerAnswer: 50_000,
  /** A listing nobody has asked about for this long is forgotten, its worker stopped. */
  idleMs: 60_000,
  /** Listings kept at once; the one asked about longest ago goes first. */
  maxListings: 8,
} as const;

export type LargeListingOptions = Partial<Record<keyof typeof LARGE_LISTING, number>>;

/** A name as the directory records it, before anything is known about the entry. */
export interface ListingNameDto {
  readonly name: string;
  readonly type: FileEntryType;
}

/** What `lstat` said about one entry, by its index among the names. */
export interface ListingDetailDto {
  readonly index: number;
  readonly type: FileEntryType;
  readonly size: number;
  readonly modifiedAt: string;
  readonly createdAt: string;
  /** Links only, as a listing has it. */
  readonly targetType?: FileEntryTargetType;
}

/**
 * Where a large listing has got to, from where the caller has got to:
 * `names` from its `namesFrom`, `details` from its `detailsFrom`. Asking
 * again from the same place gets the same answer, so a lost one costs nothing.
 */
export interface ListingProgressDto {
  readonly path: string;
  /** How many entries there are; `null` until every name has been read. */
  readonly total: number | null;
  readonly names: readonly ListingNameDto[];
  /** Every name has been handed out — with this answer or before it. */
  readonly namesDone: boolean;
  readonly details: readonly ListingDetailDto[];
  /** Indexes of entries that vanished before they could be described. */
  readonly gone: readonly number[];
  /** Everything has been handed out; there is nothing more to ask for. */
  readonly done: boolean;
}

interface WorkerDetail {
  readonly index: number;
  readonly gone?: true;
  readonly type?: FileEntryType;
  readonly size?: number;
  readonly modified?: number;
  readonly created?: number;
  readonly real?: string | null;
  readonly target?: FileEntryType;
}

type WorkerMessage =
  | { readonly kind: 'names'; readonly names: readonly string[]; readonly types: readonly FileEntryType[] }
  | { readonly kind: 'names-done'; readonly total: number }
  | { readonly kind: 'details'; readonly items: readonly WorkerDetail[] }
  | { readonly kind: 'done' }
  | { readonly kind: 'error'; readonly code: string | null; readonly message: string };

interface Listing {
  readonly path: string;
  readonly worker: Worker;
  total: number | null;
  readonly names: string[];
  readonly types: FileEntryType[];
  namesDone: boolean;
  /** Every batch of details, in the order they came: a log a caller reads from where it left off. */
  readonly details: WorkerDetail[];
  finished: boolean;
  error: HttpError | null;
  lastAsked: number;
}

/**
 * Large folders, read by stages in a worker thread (PRD 004, §3.1): a folder
 * of millions of entries would otherwise hold the process — the server, or
 * the desktop's main process — for as long as it takes to `lstat` them all,
 * and then answer with one enormous response.
 *
 * `start` hands back a token at once; `progress` answers, from a caller's
 * cursors, the names and the details that have come in since — and, once the
 * last name is in, how many there are. The
 * caller polls — once a second, as the PRD asks — until `done`. What the
 * worker reports is kept here until then, and a while after, so each answer
 * is a slice of it rather than something the worker must be asked for.
 */
export class LargeListings {
  private readonly listings = new Map<string, Listing>();
  private readonly limits: typeof LARGE_LISTING;
  private readonly sweeper: NodeJS.Timeout;

  constructor(
    private readonly resolver: FilePathResolver,
    private readonly logger: Logger,
    options: LargeListingOptions = {},
  ) {
    this.limits = { ...LARGE_LISTING, ...options } as typeof LARGE_LISTING;
    this.sweeper = setInterval(() => this.sweep(), Math.min(this.limits.idleMs, 15_000));
    this.sweeper.unref();
  }

  get threshold(): number {
    return this.limits.threshold;
  }

  /**
   * Starts reading `target` — a folder, already resolved and checked — and
   * names the listing. `first` are the names already read on the way here,
   * handed back to the caller at once: the listing starts with them, in that
   * order, and the worker adds the rest after them.
   */
  start(target: ResolvedPath, skip: readonly string[], first: readonly ListingNameDto[] = []): string {
    this.makeRoom();
    const token = randomBytes(16).toString('hex');
    const worker = new Worker(LARGE_LISTING_WORKER_SOURCE, {
      eval: true,
      workerData: {
        dir: target.absolute,
        skip,
        known: first.map(({ name, type }) => [name, type]),
        namesChunk: this.limits.namesChunk,
        statBatch: this.limits.statBatch,
        concurrency: this.limits.concurrency,
      },
    });
    const listing: Listing = {
      path: target.relative,
      worker,
      total: null,
      names: first.map(({ name }) => name),
      types: first.map(({ type }) => type),
      namesDone: false,
      details: [],
      finished: false,
      error: null,
      lastAsked: Date.now(),
    };
    worker.on('message', (message: WorkerMessage) => this.receive(listing, message));
    worker.on('error', (error) => this.fail(listing, null, error.message));
    worker.on('exit', () => {
      if (!listing.finished && listing.error === null) {
        this.fail(listing, null, 'The folder reader stopped');
      }
    });
    this.listings.set(token, listing);
    this.logger.debug('reading a large folder', { path: target.relative });
    return token;
  }

  /** Where the listing `token` names has got to, from the caller's cursors. */
  progress(token: string, namesFrom = 0, detailsFrom = 0): ListingProgressDto {
    const listing = this.listings.get(token);
    if (listing === undefined) {
      throw HttpError.notFound('That listing is no longer being read; list the folder again');
    }
    listing.lastAsked = Date.now();
    if (listing.error !== null) {
      throw listing.error;
    }

    const names = listing.names.slice(namesFrom, namesFrom + this.limits.namesPerAnswer);
    const namesOut = namesFrom + names.length;
    const namesDone = listing.namesDone && namesOut >= listing.names.length;
    // Details only once their names are out: an index must mean something to the caller.
    const pending = namesDone ? listing.details.slice(detailsFrom, detailsFrom + this.limits.detailsPerAnswer) : [];
    const detailsOut = detailsFrom + pending.length;
    const details: ListingDetailDto[] = [];
    const gone: number[] = [];
    for (const item of pending) {
      if (item.gone) {
        gone.push(item.index);
      } else {
        details.push(this.detailOf(item));
      }
    }
    return {
      path: listing.path,
      total: listing.total,
      names: names.map((name, index) => ({ name, type: listing.types[namesFrom + index] as FileEntryType })),
      namesDone,
      details,
      gone,
      // `details` counts batches' items, not answers: a cursor past every one of them.
      done: listing.finished && namesDone && detailsOut >= listing.details.length,
    };
  }

  /**
   * Stops reading a listing nobody wants any more — its panel went elsewhere
   * (PRD 004, §3.1.2) — and forgets it. An unknown token is no error: it may
   * have finished and been forgotten already.
   */
  cancel(token: string): void {
    this.forget(token);
  }

  /** Stops every reader, for a server shutting down. */
  close(): void {
    clearInterval(this.sweeper);
    for (const token of [...this.listings.keys()]) {
      this.forget(token);
    }
  }

  /* -- the worker's messages ------------------------------------------------ */

  private receive(listing: Listing, message: WorkerMessage): void {
    switch (message.kind) {
      case 'names':
        for (let index = 0; index < message.names.length; index++) {
          listing.names.push(message.names[index] as string);
          listing.types.push(message.types[index] as FileEntryType);
        }
        break;
      case 'names-done':
        listing.total = message.total;
        listing.namesDone = true;
        break;
      case 'details':
        for (const item of message.items) {
          listing.details.push(item);
        }
        break;
      case 'done':
        listing.finished = true;
        void listing.worker.terminate();
        break;
      case 'error':
        this.fail(listing, message.code, message.message);
        break;
    }
  }

  private fail(listing: Listing, code: string | null, message: string): void {
    if (listing.error !== null) {
      return;
    }
    listing.error =
      code === 'ENOENT'
        ? HttpError.notFound(`No such directory: ${listing.path || '/'}`)
        : code === 'EACCES' || code === 'EPERM'
          ? HttpError.forbidden(`Permission denied: ${listing.path || '/'}`)
          : HttpError.internal(`Could not read ${listing.path || '/'}: ${message}`);
    void listing.worker.terminate();
  }

  /** A worker's `lstat`, as a listing's entry has it. */
  private detailOf(item: WorkerDetail): ListingDetailDto {
    const type = item.type as FileEntryType;
    return {
      index: item.index,
      type,
      size: item.size ?? 0,
      modifiedAt: new Date(item.modified ?? 0).toISOString(),
      createdAt: new Date(item.created ?? 0).toISOString(),
      ...(type === 'symlink' ? { targetType: this.targetTypeOf(item) } : {}),
    };
  }

  /** What a link leads to, if that is inside the root — as `FilesService` judges it for a small listing. */
  private targetTypeOf(item: WorkerDetail): FileEntryTargetType {
    if (item.real === undefined || item.real === null || item.target === undefined || item.target === 'symlink') {
      return null;
    }
    return this.resolver.toRootRelative(item.real) === null ? null : item.target;
  }

  /* -- keeping the map small -------------------------------------------------- */

  private sweep(): void {
    const now = Date.now();
    for (const [token, listing] of this.listings) {
      if (now - listing.lastAsked > this.limits.idleMs) {
        this.forget(token);
      }
    }
  }

  private makeRoom(): void {
    while (this.listings.size >= this.limits.maxListings) {
      let oldest: [string, number] | null = null;
      for (const [token, listing] of this.listings) {
        if (oldest === null || listing.lastAsked < oldest[1]) {
          oldest = [token, listing.lastAsked];
        }
      }
      if (oldest === null) {
        return;
      }
      this.forget(oldest[0]);
    }
  }

  private forget(token: string): void {
    const listing = this.listings.get(token);
    this.listings.delete(token);
    if (listing !== undefined && !listing.finished) {
      listing.finished = true;
      void listing.worker.terminate();
    }
  }
}
