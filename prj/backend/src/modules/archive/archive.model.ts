/**
 * Archives (PRD 003, §6): what is inside a zip, as `GET /api/archive/list`
 * answers it — one folder of it at a time, like a listing.
 */

/** One entry of an archive's folder. `path` is inside the archive, `/`-separated, no leading slash. */
export interface ArchiveEntryDto {
  readonly name: string;
  readonly path: string;
  readonly type: 'file' | 'directory' | 'symlink';
  /** Uncompressed; `0` for a folder. */
  readonly size: number;
  /** ISO time; `null` for a folder only deeper entries name. */
  readonly modifiedAt: string | null;
}

export interface ArchiveListingDto {
  /** The archive, root-relative. */
  readonly path: string;
  /** The folder inside it; `''` is the top. */
  readonly inner: string;
  /** Folders first, then the rest, in natural order — as a listing is. */
  readonly entries: readonly ArchiveEntryDto[];
  /** Entries whose names would reach outside the archive: never listed, never extracted. */
  readonly unsafe: number;
}
