import { FileEntry, type FileEntryDto, type FileEntryType } from './file-entry.model.js';

/** One collator for every listing: building one per comparison is slow. */
const NATURAL_ORDER = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

export interface DirectoryListingDto {
  readonly path: string;
  readonly parent: string | null;
  readonly entries: readonly FileEntryDto[];
  /**
   * A large folder (PRD 004, §3.1): `entries` is empty, and the folder is
   * being read by stages — asked after with `GET /api/fs/list-progress`.
   * `names` are the first of them, read on the way to finding it large; the
   * progress answers go on from after them.
   */
  readonly progressive?: { readonly token: string; readonly names: readonly { readonly name: string; readonly type: FileEntryType }[] };
}

/** A directory and the entries it directly contains. */
export class DirectoryListing {
  constructor(
    readonly path: string,
    readonly entries: readonly FileEntry[],
    /** A large folder's reading, by stages; see `DirectoryListingDto.progressive`. */
    readonly progressive: NonNullable<DirectoryListingDto['progressive']> | null = null,
  ) {}

  /** Root-relative parent path, or `null` when this is the root itself. */
  get parent(): string | null {
    if (this.path === '') {
      return null;
    }
    const index = this.path.lastIndexOf('/');
    return index === -1 ? '' : this.path.slice(0, index);
  }

  /**
   * Folders first — links to folders included — then everything else, each in
   * natural order: case-insensitive, and numeric runs compared as numbers, so
   * `file2` comes before `file10`.
   */
  sorted(): DirectoryListing {
    const entries = [...this.entries].sort((a, b) => {
      if (a.isFolderLike !== b.isFolderLike) {
        return a.isFolderLike ? -1 : 1;
      }
      return NATURAL_ORDER.compare(a.name, b.name);
    });
    return new DirectoryListing(this.path, entries, this.progressive);
  }

  toJSON(): DirectoryListingDto {
    return {
      path: this.path,
      parent: this.parent,
      entries: this.entries.map((entry) => entry.toJSON()),
      ...(this.progressive === null ? {} : { progressive: this.progressive }),
    };
  }
}
