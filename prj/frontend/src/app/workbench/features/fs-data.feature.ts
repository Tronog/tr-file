import { computed, signal, type Signal, type WritableSignal } from '@angular/core';
import type { FsDetails, FsDirectoryListing, FsEntry } from '../../file-system/file-system.model';
import { FsError } from '../../file-system/fs-error';
import type { WorkbenchService } from '../workbench.service';
import { deltaOf, recordDelta } from '../listing/array-delta';

/** Where a cached request stands. */
export type FsLoadStatus = 'loading' | 'ready' | 'error';

/** How far a large folder's reading has got (PRD 004, §3.1). */
export interface FsListingProgressState {
  /** How many entries there are; `null` while they are being counted. */
  readonly total: number | null;
  /** Names received. */
  readonly named: number;
  /** Entries described — their size and dates known. */
  readonly detailed: number;
}

/** One cached directory listing. */
export interface FsListingState {
  readonly status: FsLoadStatus;
  readonly listing?: FsDirectoryListing;
  readonly error?: FsError;
  /** A large folder still being read: count, names, details. Gone once it is all in. */
  readonly progress?: FsListingProgressState;
  /**
   * Read as a large folder (PRD 004, §3.1) — so not watched for changes
   * (§3.1.1): it is read again only when someone asks, with Refresh.
   */
  readonly large?: true;
}

const NO_ENTRIES: readonly FsEntry[] = [];

/** A large folder being read: its backend token, and whether it was given up (PRD 004, §3.1.2). */
interface LargeRead {
  readonly token: string;
  aborted: boolean;
  /** Ends the pause between questions early. */
  wake: (() => void) | null;
  /** The listing shown before this reading began, put back if it is given up. */
  readonly previous: FsDirectoryListing | undefined;
}

/** A large folder's reading is asked after, and put on screen, at most this often (PRD 004, §3.1). */
export const LARGE_LISTING_INTERVAL_MS = 1000;

/** An answer carrying this many names or details says more are waiting: ask again at once. */
const FULL_ANSWER = 10_000;

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

  /** The read in flight for each path, so a caller can wait for the listing it asked for. */
  private readonly inflight = new Map<string, Promise<void>>();

  /**
   * Listings no longer watched for changes (PRD 003, §5): kept, so going back
   * to one shows it at once, but read again when it is next asked for — it
   * may have changed while nobody was looking.
   */
  private readonly expired = new Set<string>();

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
  /** Whether `path` was read as a large folder, which is refreshed by hand only (PRD 004, §3.1.1). */
  isLarge(path: string): boolean {
    return this.listings().get(path)?.large === true;
  }

  entries(path: string): readonly FsEntry[] {
    const entries = this.listings().get(path)?.listing?.entries ?? NO_ENTRIES;
    if (this.parent.showHidden()) {
      return entries;
    }
    // The same array for the same listing: a large folder's order is kept per array (PRD 004, §3.1).
    let shown = this.withoutHidden.get(entries);
    if (shown === undefined) {
      shown = this.hideIn(entries);
      this.withoutHidden.set(entries, shown);
    }
    return shown;
  }

  private readonly withoutHidden = new WeakMap<readonly FsEntry[], readonly FsEntry[]>();
  /** Where each entry of a listing sits once its hidden ones are left out; `-1` for a hidden one. */
  private readonly shownAt = new WeakMap<readonly FsEntry[], Int32Array>();

  /**
   * `entries` without the hidden ones — the listing itself when it has none.
   * A listing that is the last one with a few entries described (PRD 004,
   * §3.1) is made from the last result, those few put in their places.
   */
  private hideIn(entries: readonly FsEntry[]): readonly FsEntry[] {
    const delta = deltaOf(entries);
    const before = delta === undefined ? undefined : this.withoutHidden.get(delta.from);
    if (delta !== undefined && before !== undefined) {
      if (before === delta.from) {
        return entries;
      }
      const positions = this.shownAt.get(before);
      if (positions !== undefined) {
        const shown = before.slice();
        const changed: number[] = [];
        for (const index of delta.changed) {
          const at = positions[index] ?? -1;
          if (at >= 0) {
            shown[at] = entries[index] as FsEntry;
            changed.push(at);
          }
        }
        this.shownAt.set(shown, positions);
        recordDelta(shown, before, changed);
        return shown;
      }
    }
    if (!entries.some((entry) => entry.hidden)) {
      return entries;
    }
    const positions = new Int32Array(entries.length);
    const shown: FsEntry[] = [];
    entries.forEach((entry, index) => {
      positions[index] = entry.hidden ? -1 : shown.push(entry) - 1;
    });
    this.shownAt.set(shown, positions);
    return shown;
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
    const entries = this.listings().get(parentPath)?.listing?.entries ?? NO_ENTRIES;
    return this.indexOf(entries).get(path);
  }

  /** `path` if the listing of `folder` shows it — hidden entries only while they are shown. */
  shownEntryAt(folder: string, path: string): FsEntry | undefined {
    const parentPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (parentPath !== folder) {
      return undefined;
    }
    const entry = this.entryAt(path);
    return entry !== undefined && (this.parent.showHidden() || !entry.hidden) ? entry : undefined;
  }

  /**
   * A listing's entries by path, made once per listing: menus, commands and
   * the details sidebar look entries up many times a render, and a folder of
   * a million (PRD 004, §3.1) cannot be searched from the top each time.
   */
  private indexOf(entries: readonly FsEntry[]): ReadonlyMap<string, FsEntry> {
    let index = this.indexes.get(entries);
    if (index === undefined) {
      // A listing a few entries on from the last: the last one's index, those few updated. The
      // older listing's lookups then answer with the newer entries, which is what anyone wants.
      const delta = deltaOf(entries);
      const before = delta === undefined ? undefined : this.indexes.get(delta.from);
      if (delta !== undefined && before !== undefined) {
        for (const at of delta.changed) {
          const entry = entries[at] as FsEntry;
          before.set(entry.path, entry);
        }
        index = before;
      } else {
        index = new Map(entries.map((entry) => [entry.path, entry]));
      }
      this.indexes.set(entries, index);
    }
    return index;
  }

  private readonly indexes = new WeakMap<readonly FsEntry[], Map<string, FsEntry>>();

  /**
   * Fetches a directory unless it is already cached or in flight.
   *
   * A cached *failure* does not count as cached: asking again — re-expanding
   * the folder, opening it in another panel — is the natural way to retry, and
   * the previous error may have been a restart or a blip.
   */
  ensureListing(path: string): void {
    if (this.expired.delete(path) && this.listings().has(path)) {
      void this.reloadListing(path);
      return;
    }
    if (this.pendingListings.has(path) || this.isSettled(this.listings().get(path))) {
      return;
    }
    void this.fetchListing(path);
  }

  /**
   * Re-fetches a directory even when it is cached (the Refresh action).
   * Resolves once the listing on screen is one read after this was asked —
   * for a caller that wants to select something the read will bring.
   */
  reloadListing(path: string): Promise<void> {
    this.expired.delete(path);
    const running = this.inflight.get(path);
    if (running !== undefined) {
      this.staleListings.add(path);
      // The read after this one is started as this one ends; wait for that.
      return running.then(() => this.inflight.get(path));
    }
    return this.fetchListing(path);
  }

  /** A listing nobody watches any more is read again the next time it is shown; see `expired`. */
  expire(path: string): void {
    if (this.listings().has(path)) {
      this.expired.add(path);
    }
  }

  /**
   * Drops a directory from the cache and reloads it if anything is showing it.
   * Called after an upload lands in that directory. Resolves once it is read
   * again — at once when nothing shows it.
   */
  invalidateListing(path: string): Promise<void> {
    return this.listings().has(path) ? this.reloadListing(path) : Promise.resolve();
  }

  /**
   * Reads a directory. A reload keeps the entries already cached — status
   * `loading` with a `listing` — so every view goes from the old listing
   * straight to the new one instead of through an empty frame.
   */
  private fetchListing(path: string): Promise<void> {
    const read = this.readListing(path);
    this.inflight.set(path, read);
    void read.finally(() => {
      if (this.inflight.get(path) === read) {
        this.inflight.delete(path);
      }
    });
    return read;
  }

  private async readListing(path: string): Promise<void> {
    this.pendingListings.add(path);
    const previous = this.listings().get(path)?.listing;
    this.patchListing(path, { status: 'loading', ...(previous ? { listing: previous } : {}) });
    try {
      const listing = await this.parent.fileSystem.readFt.list(path);
      if (listing.progressive === undefined) {
        this.patchListing(path, { status: 'ready', listing });
      } else {
        // Large from the first answer on: not watched even before the count comes (§3.1.1).
        this.patchListing(path, { status: 'loading', large: true, ...(previous ? { listing: previous } : {}) });
        await this.readLarge(path, listing, listing.progressive.token, previous);
      }
    } catch (error) {
      this.patchListing(path, { status: 'error', error: FsError.from(error) });
    } finally {
      this.pendingListings.delete(path);
      if (this.staleListings.delete(path)) {
        void this.fetchListing(path);
      }
    }
  }

  /**
   * A large folder (PRD 004, §3.1), read by stages — the backend's worker
   * counts it, names it, then describes it in batches, and this asks after
   * each from where it has got to:
   *
   * - until every name is in, the listing on screen stays what it was (a
   *   reload keeps the old one; a first read has none, and the panel says how
   *   many entries are being read);
   * - then the entries are shown, `partial` — names and types, no sizes or
   *   dates yet;
   * - then their details fill in, batch by batch.
   *
   * The screen is updated at most once a second, and the backend asked about
   * as often — at once, though, while it still has big chunks waiting, so a
   * million names do not take a second per hundred thousand. Resolves once
   * everything is in, which is what keeps the path `pending` meanwhile.
   */
  private async readLarge(path: string, first: FsDirectoryListing, token: string, previous: FsDirectoryListing | undefined): Promise<void> {
    const reading: LargeRead = { token, aborted: false, wake: null, previous };
    this.largeReads.set(path, reading);
    if (this.abandoned.delete(path)) {
      this.abortLarge(path);
    }
    try {
      await this.followLarge(path, first, reading, previous);
    } catch (error) {
      // Once given up, the backend has forgotten the token: a question still on its way fails, harmlessly.
      if (!reading.aborted) {
        throw error;
      }
    } finally {
      this.largeReads.delete(path);
    }
  }

  /**
   * Stops reading a large folder nobody is looking at any more — the panel
   * that showed it went elsewhere (PRD 004, §3.1.2): no more questions to the
   * backend, whose worker is stopped too, and no read queued after it.
   */
  abortLarge(path: string): void {
    const reading = this.largeReads.get(path);
    if (reading === undefined) {
      // Left while its first answer is still on the way: given up the moment it turns out large.
      if (this.pendingListings.has(path)) {
        this.abandoned.add(path);
      }
      return;
    }
    if (reading.aborted) {
      return;
    }
    reading.aborted = true;
    reading.wake?.();
    this.staleListings.delete(path);
    // At once, not when the question on its way comes back: the last whole listing if there was
    // one, else nothing — so the folder is read afresh when it is next opened.
    if (reading.previous !== undefined) {
      this.patchListing(path, { status: 'ready', listing: reading.previous, large: true });
    } else {
      this.listings.update((cache) => {
        const next = new Map(cache);
        next.delete(path);
        return next;
      });
    }
    void this.parent.fileSystem.readFt.listCancel(reading.token).catch(() => undefined);
  }

  /** A folder shown again: whatever its reading was given up for, it is wanted after all. */
  keepLarge(path: string): void {
    this.abandoned.delete(path);
  }

  /** Folders left before their first answer came — given up if it says they are large. */
  private readonly abandoned = new Set<string>();

  /** Whether a large folder is being read right now. */
  isReadingLarge(path: string): boolean {
    return this.largeReads.has(path);
  }

  private readonly largeReads = new Map<string, LargeRead>();

  private async followLarge(path: string, first: FsDirectoryListing, reading: LargeRead, previous: FsDirectoryListing | undefined): Promise<void> {
    const read = this.parent.fileSystem.readFt;
    const token = reading.token;
    const prefix = first.path === '' ? '' : `${first.path}/`;
    // Index-aligned with the backend's names: details say which slot they fill; a vanished entry leaves `null`.
    const slots: (FsEntry | null)[] = [];
    let detailsFrom = 0;
    let shown = Number.NEGATIVE_INFINITY;
    let namesShown = false;
    // What changed since the listing last put on screen: while only details came, the next
    // listing is that one with a few entries replaced, and says so (`recordDelta`).
    let published: readonly FsEntry[] | null = null;
    const described = new Set<number>();
    let reshaped = false;
    let goneAny = false;

    for (;;) {
      if (reading.aborted) {
        return;
      }
      const asked = Date.now();
      const answer = await read.listProgress(token, slots.length, detailsFrom);
      if (reading.aborted) {
        return;
      }
      for (const { name, type } of answer.names) {
        slots.push({ name, path: prefix + name, type, size: 0, hidden: name.startsWith('.'), modifiedAt: '', createdAt: '', partial: true });
        reshaped = true;
      }
      for (const detail of answer.details) {
        const slot = slots[detail.index];
        if (slot) {
          const { index: _index, ...known } = detail;
          slots[detail.index] = { name: slot.name, path: slot.path, hidden: slot.hidden, ...known };
          described.add(detail.index);
        }
      }
      for (const index of answer.gone) {
        slots[index] = null;
        reshaped = true;
        goneAny = true;
      }
      detailsFrom += answer.details.length + answer.gone.length;

      // Once a second — and the moment the names are all in, and when everything is.
      const now = Date.now();
      if (answer.done || (answer.namesDone && !namesShown) || now - shown >= LARGE_LISTING_INTERVAL_MS) {
        shown = now;
        const progress: FsListingProgressState = { total: answer.total, named: slots.length, detailed: detailsFrom };
        if (!answer.namesDone) {
          this.patchListing(path, { status: 'loading', progress, large: true, ...(previous ? { listing: previous } : {}) });
        } else {
          namesShown = true;
          const entries = goneAny ? slots.filter((slot): slot is FsEntry => slot !== null) : (slots.slice() as FsEntry[]);
          if (published !== null && !reshaped) {
            recordDelta(entries, published, [...described]);
          }
          published = entries;
          described.clear();
          reshaped = false;
          const listing: FsDirectoryListing = { path: first.path, parent: first.parent, entries };
          this.patchListing(path, answer.done ? { status: 'ready', listing, large: true } : { status: 'loading', listing, progress, large: true });
        }
      }
      if (answer.done) {
        return;
      }
      const full = answer.names.length >= FULL_ANSWER || answer.details.length >= FULL_ANSWER;
      // A pause an abort cuts short: nobody waits a second for a folder they have left.
      await Promise.race([
        this.wait(full ? 0 : Math.max(0, LARGE_LISTING_INTERVAL_MS - (Date.now() - asked))),
        new Promise<void>((resolve) => {
          reading.wake = resolve;
        }),
      ]);
      reading.wake = null;
      if (reading.aborted) {
        return;
      }
    }
  }

  /** A pause between questions about a large folder; a seam, so specs need not wait. */
  wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
