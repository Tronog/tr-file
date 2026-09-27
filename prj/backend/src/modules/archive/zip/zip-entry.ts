/** One entry of an archive's central directory, as `ZipReader` found it. */
export interface ZipEntry {
  /**
   * The normalized relative path (`/`-separated, no leading or trailing
   * slash) — or, for an `unsafe` entry, the name exactly as decoded, which
   * must then only ever be shown, never used as a path.
   */
  readonly name: string;
  /** The name as the archive decodes it, before normalization. */
  readonly rawName: string;
  /** The name is absolute, climbs out with `..`, or is otherwise not a usable relative path. */
  readonly unsafe: boolean;
  readonly isDirectory: boolean;
  /** Unix-made archives only: a symlink's entry holds its target as the content. */
  readonly isSymlink: boolean;
  /** Uncompressed size in bytes. */
  readonly size: number;
  readonly compressedSize: number;
  /** From the extended timestamp when there is one (UTC, 1 s), the DOS date and time otherwise (local, 2 s). */
  readonly mtime: Date;
  /** The Unix mode, type bits included, when a Unix tool made the entry; `null` otherwise. */
  readonly mode: number | null;
  /** 0 is stored, 8 is deflate; anything else cannot be read. */
  readonly method: number;
  readonly crc32: number;
  readonly encrypted: boolean;
  /** Where the entry's local header starts, already corrected for data prepended to the archive. */
  readonly localHeaderOffset: number;
}

/** One direct child of a folder inside an archive, as `ZipReader.list` returns it. */
export interface ZipListItem {
  /** The last segment of `path`. */
  readonly name: string;
  /** Normalized path inside the archive. */
  readonly path: string;
  readonly isDirectory: boolean;
  readonly isSymlink: boolean;
  /** Uncompressed size; 0 for a folder. */
  readonly size: number;
  /** `null` for a folder that exists only because deeper entries name it. */
  readonly mtime: Date | null;
  /** The entry behind the item — `null` for such an implicit folder. */
  readonly entry: ZipEntry | null;
}
