import type { FileEntry, FileEntryDto } from './file-entry.model.js';

/** Serialised shape returned by `GET /fs/search`. */
export interface SearchResultDto {
  /** The folder searched, root-relative; `''` is the root. */
  readonly path: string;
  /** The query exactly as it was asked. */
  readonly query: string;
  /** Matches, shallowest first. */
  readonly entries: readonly FileEntryDto[];
  /**
   * The search stopped before it had looked everywhere — more matches than
   * the limit, too many entries to look at, or out of time — so `entries` is
   * a first page, not the answer.
   */
  readonly truncated: boolean;
  /** How many entries were looked at. */
  readonly scanned: number;
}

/** What a name search beneath one folder found (PRD 003, §5). */
export class SearchResult {
  constructor(
    readonly path: string,
    readonly query: string,
    readonly entries: readonly FileEntry[],
    readonly truncated: boolean,
    readonly scanned: number,
  ) {}

  toJSON(): SearchResultDto {
    return {
      path: this.path,
      query: this.query,
      entries: this.entries.map((entry) => entry.toJSON()),
      truncated: this.truncated,
      scanned: this.scanned,
    };
  }
}
