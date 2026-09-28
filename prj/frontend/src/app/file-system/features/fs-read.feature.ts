import type { FileSystemService } from '../file-system.service';
import type { FsArchiveListing, FsDetails, FsDirectoryListing, FsListingProgress, FsPlaces, FsSearchResult, FsServerTime, FsWatchResult } from '../file-system.model';

/**
 * Reading the file system: directory listings and entry details.
 *
 * Both calls are one-shot and reject with `FsError`. Neither knows how the
 * backend is reached — since §8.1 that is the transport's business, and on the
 * desktop no HTTP is involved at all.
 *
 * The reactive `httpResource` readers that used to live here moved to
 * `FsHttpService`, where they belong: an `httpResource` is an HTTP thing, and
 * a feature that must work over both transports cannot offer one.
 */
export class FsReadFeature {
  constructor(private readonly parent: FileSystemService) {}

  /** Lists a directory. `''` is the configured files root. */
  async list(path: string): Promise<FsDirectoryListing> {
    return this.parent.transport.list(path);
  }

  /** Stops the backend reading a large folder (PRD 004, §3.1.2). */
  async listCancel(token: string): Promise<void> {
    return this.parent.transport.listCancel(token);
  }

  /** A large folder's reading (PRD 004, §3.1), from the caller's cursors. */
  async listProgress(token: string, namesFrom: number, detailsFrom: number): Promise<FsListingProgress> {
    return this.parent.transport.listProgress(token, namesFrom, detailsFrom);
  }

  /** Describes one file or directory in full. */
  async details(path: string): Promise<FsDetails> {
    return this.parent.transport.details(path);
  }

  /**
   * Entries under `path` whose names match `query`, shallowest first
   * (PRD 003, §5) — a substring, or a glob when it has `*` or `?`.
   */
  async search(path: string, query: string, limit?: number): Promise<FsSearchResult> {
    return this.parent.transport.search(path, query, limit);
  }

  /** Where a session starts, and what the Places pane lists (PRD 003, §6). */
  async places(): Promise<FsPlaces> {
    return this.parent.transport.places();
  }

  /** The backend machine's clock (PRD 001, §13.1). */
  async serverTime(): Promise<FsServerTime> {
    return this.parent.transport.serverTime();
  }

  /** One folder of a zip (PRD 003, §6); `inner` `''` is its top. */
  async archive(path: string, inner: string): Promise<FsArchiveListing> {
    return this.parent.transport.archiveList(path, inner);
  }

  /** Which of `paths` changed since the watch last asked; see `FsTransport.watch`. */
  async watch(watchId: string | null, paths: readonly string[]): Promise<FsWatchResult> {
    return this.parent.transport.watch(watchId, paths);
  }
}
