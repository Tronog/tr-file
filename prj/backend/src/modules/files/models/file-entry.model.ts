import type { Stats } from 'node:fs';
import { posix } from 'node:path';

export type FileEntryType = 'file' | 'directory' | 'symlink' | 'other';

/**
 * What a symlink points at, when that is somewhere inside the files root.
 * `null` when the link is dangling, or leads outside the root — either way
 * there is nothing the API will let a caller reach through it.
 */
export type FileEntryTargetType = Exclude<FileEntryType, 'symlink'> | null;

/** Serialised shape returned by the API. */
export interface FileEntryDto {
  readonly name: string;
  readonly path: string;
  readonly type: FileEntryType;
  readonly size: number;
  readonly hidden: boolean;
  readonly modifiedAt: string;
  readonly createdAt: string;
  /** Symlinks only: what the link resolves to. Absent for anything else. */
  readonly targetType?: FileEntryTargetType;
}

/** Immutable domain model describing a single file-system entry. */
export class FileEntry {
  readonly name: string;
  readonly path: string;
  readonly type: FileEntryType;
  readonly size: number;
  readonly modifiedAt: Date;
  readonly createdAt: Date;
  /** Symlinks only; `undefined` for every other type. */
  readonly targetType: FileEntryTargetType | undefined;

  constructor(props: {
    name: string;
    path: string;
    type: FileEntryType;
    size: number;
    modifiedAt: Date;
    createdAt: Date;
    targetType?: FileEntryTargetType;
  }) {
    this.name = props.name;
    this.path = props.path;
    this.type = props.type;
    this.size = props.size;
    this.modifiedAt = props.modifiedAt;
    this.createdAt = props.createdAt;
    this.targetType = props.type === 'symlink' ? (props.targetType ?? null) : undefined;
  }

  /**
   * Builds an entry from `fs.Stats`; `relativePath` is root-relative, POSIX.
   * `stats` is an `lstat` result, so a symlink is described as itself;
   * `targetType` says what it points at, which only the caller can find out.
   */
  static fromStats(relativePath: string, stats: Stats, targetType?: FileEntryTargetType): FileEntry {
    return new FileEntry({
      name: relativePath === '' ? '' : posix.basename(relativePath),
      path: relativePath,
      type: FileEntry.typeOf(stats),
      size: stats.size,
      modifiedAt: stats.mtime,
      createdAt: stats.birthtime,
      ...(targetType === undefined ? {} : { targetType }),
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

  /** A directory, or a link to one: something a caller can list and open. */
  get isFolderLike(): boolean {
    return this.isDirectory || this.targetType === 'directory';
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
      ...(this.targetType === undefined ? {} : { targetType: this.targetType }),
    };
  }
}
