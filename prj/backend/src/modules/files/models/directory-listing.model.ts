import { FileEntry, type FileEntryDto } from './file-entry.model.js';

export interface DirectoryListingDto {
  readonly path: string;
  readonly parent: string | null;
  readonly entries: readonly FileEntryDto[];
}

/** A directory and the entries it directly contains. */
export class DirectoryListing {
  constructor(
    readonly path: string,
    readonly entries: readonly FileEntry[],
  ) {}

  /** Root-relative parent path, or `null` when this is the root itself. */
  get parent(): string | null {
    if (this.path === '') {
      return null;
    }
    const index = this.path.lastIndexOf('/');
    return index === -1 ? '' : this.path.slice(0, index);
  }

  /** Directories first, then files, each alphabetically (case-insensitive). */
  sorted(): DirectoryListing {
    const entries = [...this.entries].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return new DirectoryListing(this.path, entries);
  }

  toJSON(): DirectoryListingDto {
    return {
      path: this.path,
      parent: this.parent,
      entries: this.entries.map((entry) => entry.toJSON()),
    };
  }
}
