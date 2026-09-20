import type { Stats } from 'node:fs';
import { basename } from 'node:path';

export type FileEntryType = 'file' | 'directory' | 'symlink' | 'other';

/** Serialised shape returned by the API. */
export interface FileEntryDto {
  readonly name: string;
  readonly path: string;
  readonly type: FileEntryType;
  readonly size: number;
  readonly hidden: boolean;
  readonly modifiedAt: string;
  readonly createdAt: string;
}

/** Immutable domain model describing a single file-system entry. */
export class FileEntry {
  readonly name: string;
  readonly path: string;
  readonly type: FileEntryType;
  readonly size: number;
  readonly modifiedAt: Date;
  readonly createdAt: Date;

  constructor(props: {
    name: string;
    path: string;
    type: FileEntryType;
    size: number;
    modifiedAt: Date;
    createdAt: Date;
  }) {
    this.name = props.name;
    this.path = props.path;
    this.type = props.type;
    this.size = props.size;
    this.modifiedAt = props.modifiedAt;
    this.createdAt = props.createdAt;
  }

  /** Builds an entry from `fs.Stats`; `relativePath` is root-relative, POSIX. */
  static fromStats(relativePath: string, stats: Stats): FileEntry {
    return new FileEntry({
      name: relativePath === '' ? '' : basename(relativePath),
      path: relativePath,
      type: FileEntry.typeOf(stats),
      size: stats.size,
      modifiedAt: stats.mtime,
      createdAt: stats.birthtime,
    });
  }

  static typeOf(stats: Pick<Stats, 'isDirectory' | 'isFile' | 'isSymbolicLink'>): FileEntryType {
    if (stats.isSymbolicLink()) {
      return 'symlink';
    }
    if (stats.isDirectory()) {
      return 'directory';
    }
    if (stats.isFile()) {
      return 'file';
    }
    return 'other';
  }

  get isDirectory(): boolean {
    return this.type === 'directory';
  }

  get hidden(): boolean {
    return this.name.startsWith('.');
  }

  toJSON(): FileEntryDto {
    return {
      name: this.name,
      path: this.path,
      type: this.type,
      size: this.size,
      hidden: this.hidden,
      modifiedAt: this.modifiedAt.toISOString(),
      createdAt: this.createdAt.toISOString(),
    };
  }
}
