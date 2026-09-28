import { DestroyRef, inject } from '@angular/core';
import { FsError } from '../../file-system/fs-error';
import type { WorkbenchService } from '../workbench.service';

/** How often the backend is asked what changed: often enough to feel live, rarely enough to cost nothing. */
export const WATCH_POLL_MS = 2000;

/** After a failed ask, how long before the next — the network, or a server restarting. */
const WATCH_RETRY_MS = 10_000;

/** The backend watches at most this many folders for one window. */
const WATCH_LIMIT = 256;

function parentOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}

/**
 * Listings that keep themselves current (PRD 003, §5): a file another
 * program writes, a folder someone else empties — the panels and the
 * explorer show it without a Refresh.
 *
 * The backend watches the folders; the workbench asks it, every
 * `WATCH_POLL_MS`, which of the folders on screen changed — the same pattern
 * jobs are followed by, so it costs one small message however busy the disk
 * is, and works alike over HTTP, the desktop bridge and a remote server.
 * What changed is read again, keeping what is on screen until the answer
 * lands, like any reload; the details sidebar follows when the entry it
 * describes is in one of them.
 *
 * Only what is on screen is watched: each panel's folder (and the folders
 * open in its tree view) and the explorer's open folders. A listing that
 * leaves the screen is kept but marked stale, so going back to it shows it at
 * once and reads it again. Polling pauses while the page is hidden, and
 * stops for good against a backend too old to know the command.
 */
export class AutoRefreshFeature {
  private watchId: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private watched: ReadonlySet<string> = new Set();
  private stopped = true;

  constructor(private readonly parent: WorkbenchService) {
    // Constructed while the service is, so the injection context is there.
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  /** Starts asking; the workbench calls it once it is up. */
  start(): void {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.schedule(WATCH_POLL_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * The folders whose listings are on screen right now — but for large ones
   * (PRD 004, §3.1.1): a folder of a million entries is read again only when
   * someone asks, with Refresh, never because the backend saw it change.
   */
  foldersShown(): readonly string[] {
    const folders = new Set([...this.parent.fileBrowserFt.foldersShown(), ...this.parent.explorerFt.foldersShown()]);
    return [...folders].filter((path) => !this.parent.fsDataFt.isLarge(path)).slice(0, WATCH_LIMIT);
  }

  /**
   * What is asked about: the folders on screen, and the shown repository's
   * `.git` (PRD 011, §1) — where a commit or a checkout made elsewhere lands.
   */
  private foldersWatched(): readonly string[] {
    const folders = this.foldersShown();
    const git = this.parent.gitFt.watchedFolders().filter((path) => !folders.includes(path));
    return [...folders.slice(0, WATCH_LIMIT - git.length), ...git];
  }

  /** One ask: what changed among the folders on screen. Public so a test can drive it. */
  async poll(): Promise<void> {
    const folders = this.foldersWatched();
    this.forgetUnwatched(folders);
    let delay = WATCH_POLL_MS;
    try {
      const answer = await this.parent.fileSystem.readFt.watch(this.watchId, folders);
      this.watchId = answer.watchId;
      this.refresh(answer.changed);
    } catch (error) {
      const failure = FsError.from(error);
      // A backend that predates watching: nothing to ask, ever.
      if (failure.status === 404 || (failure.code === 'BAD_REQUEST' && /unknown/i.test(failure.message))) {
        this.stop();
        return;
      }
      delay = WATCH_RETRY_MS;
    }
    this.schedule(delay);
  }

  private schedule(delay: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      if (globalThis.document?.visibilityState === 'hidden') {
        this.schedule(WATCH_POLL_MS);
        return;
      }
      void this.poll();
    }, delay);
  }

  /** Folders that left the screen are no longer watched, so what is cached of them may go stale. */
  private forgetUnwatched(folders: readonly string[]): void {
    const now = new Set(folders);
    for (const path of this.watched) {
      if (!now.has(path)) {
        this.parent.fsDataFt.expire(path);
      }
    }
    this.watched = now;
  }

  private refresh(changed: readonly string[]): void {
    if (changed.length === 0) {
      return;
    }
    this.parent.gitFt.noticeChanges(changed);
    const git = this.parent.gitFt.watchedFolders();
    for (const path of changed.filter((candidate) => !git.includes(candidate))) {
      void this.parent.fsDataFt.reloadListing(path);
    }
    const selected = this.parent.selectedEntryId();
    if (changed.includes(selected) || changed.includes(parentOf(selected))) {
      this.parent.fsDataFt.reloadDetails(selected);
    }
  }
}
