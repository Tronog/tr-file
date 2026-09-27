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

  /**
   * Paths asked to reload while a request for them was already in flight. That
   * answer may predate the change being reported, so they are read once more
   * when it lands — otherwise the last of several uploads could go unseen.
   */
  private readonly staleListings = new Set<string>();

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
   * is showing them. Empty until the first answer, or on error — callers
   * render those states from `listingState`. While a reload is in flight these
   * are still the previous entries, so nothing on screen blanks meanwhile.
   */
  entries(path: string): readonly FsEntry[] {
    const entries = this.listings().get(path)?.listing?.entries ?? [];
    return this.parent.showHidden() ? entries : entries.filter((entry) => !entry.hidden);
  }

  /**
   * One entry, looked up in its parent's listing. `undefined` when that
   * directory has not been read yet — the root itself has no entry of its own.
   */
  entryAt(path: string): FsEntry | undefined {
    if (path === '') {
      return undefined;
    }
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const entries = this.listings().get(parentPath)?.listing?.entries ?? [];
    return entries.find((entry) => entry.path === path);
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
      this.staleListings.add(path);
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

  /**
   * Reads a directory. A reload keeps the entries already cached — status
   * `loading` with a `listing` — so every view goes from the old listing
   * straight to the new one instead of through an empty frame.
   */
  private async fetchListing(path: string): Promise<void> {
    this.pendingListings.add(path);
    const previous = this.listings().get(path)?.listing;
    this.patchListing(path, { status: 'loading', ...(previous ? { listing: previous } : {}) });
    try {
      const listing = await this.parent.fileSystem.readFt.list(path);
      this.patchListing(path, { status: 'ready', listing });
    } catch (error) {
      this.patchListing(path, { status: 'error', error: FsError.from(error) });
    } finally {
      this.pendingListings.delete(path);
      if (this.staleListings.delete(path)) {
        void this.fetchListing(path);
      }
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
    // As with listings: a reload keeps what is shown until the answer replaces it.
    const previous = this.details().get(path)?.details;
    this.patchDetails(path, { status: 'loading', ...(previous ? { details: previous } : {}) });
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
