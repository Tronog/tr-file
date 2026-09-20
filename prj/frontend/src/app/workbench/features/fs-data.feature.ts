import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import type { FsDetails, FsDirectoryListing, FsEntry } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import type { WorkbenchService } from '../workbench.service';

/** Where a cached request stands. */
export type FsLoadStatus = 'loading' | 'ready' | 'error';

/** One cached directory listing. */
export interface FsListingState {
  readonly status: FsLoadStatus;
  readonly listing?: FsDirectoryListing;
  readonly error?: FsError;
}

/** One cached entry's details. */
export interface FsDetailsState {
  readonly status: FsLoadStatus;
  readonly details?: FsDetails;
  readonly error?: FsError;
}

const LOADING: FsListingState = { status: 'loading' };

/**
 * The workbench's view of the backend file system.
 *
 * Everything the UI renders comes from this cache, keyed by path, so the tree,
 * the panels and the details sidebar all agree and a folder open in two places
 * is fetched once. Loads are only ever started from an action — expanding a
 * node, opening a folder, selecting an entry — never from a computed, because
 * a computed that writes signals is a change-detection loop waiting to happen.
 */
export class FsDataFeature {
  private readonly listings: WritableSignal<ReadonlyMap<string, FsListingState>>;
  private readonly details: WritableSignal<ReadonlyMap<string, FsDetailsState>>;

  /** Paths with a request in flight; guards against duplicate fetches. */
  private readonly pendingListings = new Set<string>();
  private readonly pendingDetails = new Set<string>();

  constructor(private readonly parent: WorkbenchService) {
    this.listings = signal<ReadonlyMap<string, FsListingState>>(new Map());
    this.details = signal<ReadonlyMap<string, FsDetailsState>>(new Map());
  }

  /** Every path that failed to load, newest first — feeds the status bar. */
  readonly errors: Signal<readonly { path: string; error: FsError }[]> = computed(() => {
    const failures: { path: string; error: FsError }[] = [];
    for (const [path, state] of this.listings()) {
      if (state.error) {
        failures.push({ path, error: state.error });
      }
    }
    return failures;
  });

  /* -- listings ---------------------------------------------------------- */

  /** Cached state for a directory, or `undefined` when it was never asked for. */
  listingState(path: string): FsListingState | undefined {
    return this.listings().get(path);
  }

  /**
   * The entries of a directory, hidden ones filtered out unless the workbench
   * is showing them. Empty while loading or on error — callers render those
   * states from `listingState`.
   */
  entries(path: string): readonly FsEntry[] {
    const entries = this.listings().get(path)?.listing?.entries ?? [];
    return this.parent.showHidden() ? entries : entries.filter((entry) => !entry.hidden);
  }

  /**
   * Fetches a directory unless it is already cached or in flight.
   *
   * A cached *failure* does not count as cached: asking again — re-expanding
   * the folder, opening it in another panel — is the natural way to retry, and
   * the previous error may have been a restart or a blip.
   */
  ensureListing(path: string): void {
    if (this.pendingListings.has(path) || this.isSettled(this.listings().get(path))) {
      return;
    }
    void this.fetchListing(path);
  }

  /** Re-fetches a directory even when it is cached (the Refresh action). */
  reloadListing(path: string): void {
    if (this.pendingListings.has(path)) {
      return;
    }
    void this.fetchListing(path);
  }

  /**
   * Drops a directory from the cache and reloads it if anything is showing it.
   * Called after an upload lands in that directory.
   */
  invalidateListing(path: string): void {
    if (this.listings().has(path)) {
      this.reloadListing(path);
    }
  }

  private async fetchListing(path: string): Promise<void> {
    this.pendingListings.add(path);
    this.patchListing(path, LOADING);
    try {
      const listing = await this.parent.fileSystem.readFt.list(path);
      this.patchListing(path, { status: 'ready', listing });
    } catch (error) {
      this.patchListing(path, { status: 'error', error: FsError.from(error) });
    } finally {
      this.pendingListings.delete(path);
    }
  }

  private patchListing(path: string, state: FsListingState): void {
    this.listings.update((cache) => new Map(cache).set(path, state));
  }

  /* -- details ----------------------------------------------------------- */

  detailsState(path: string): FsDetailsState | undefined {
    return this.details().get(path);
  }

  /** As `ensureListing`: a cached failure is retried when asked for again. */
  ensureDetails(path: string): void {
    if (this.pendingDetails.has(path) || this.isSettled(this.details().get(path))) {
      return;
    }
    void this.fetchDetails(path);
  }

  reloadDetails(path: string): void {
    if (!this.pendingDetails.has(path)) {
      void this.fetchDetails(path);
    }
  }

  private async fetchDetails(path: string): Promise<void> {
    this.pendingDetails.add(path);
    this.patchDetails(path, { status: 'loading' });
    try {
      const details = await this.parent.fileSystem.readFt.details(path);
      this.patchDetails(path, { status: 'ready', details });
    } catch (error) {
      this.patchDetails(path, { status: 'error', error: FsError.from(error) });
    } finally {
      this.pendingDetails.delete(path);
    }
  }

  private patchDetails(path: string, state: FsDetailsState): void {
    this.details.update((cache) => new Map(cache).set(path, state));
  }

  /** A cache entry worth reusing: anything that did not end in an error. */
  private isSettled(state: { readonly status: FsLoadStatus } | undefined): boolean {
    return state !== undefined && state.status !== 'error';
  }
}
