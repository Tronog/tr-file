import type { Stats } from 'node:fs';
import { extname } from 'node:path';

import { FileEntry, type FileEntryDto, type FileEntryTargetType } from './file-entry.model.js';

/** A single read/write/execute triplet of the POSIX permission bits. */
export interface PermissionTripletDto {
  readonly read: boolean;
  readonly write: boolean;
  readonly execute: boolean;
}

export interface FilePermissionsDto {
  readonly owner: PermissionTripletDto;
  readonly group: PermissionTripletDto;
  readonly others: PermissionTripletDto;
}

/** Serialised shape returned by `GET /fs/details` and `POST /fs/upload`. */
export interface FileDetailsDto extends FileEntryDto {
  readonly parent: string | null;
  readonly accessedAt: string;
  readonly changedAt: string;
  readonly mode: string;
  readonly permissions: FilePermissionsDto;
  readonly uid: number;
  readonly gid: number;
  readonly inode: number;
  readonly sizeOnDisk: number;
  readonly mimeType: string | null;
  readonly symlinkTarget: string | null;
  readonly entryCount: number | null;
  /**
   * `entryCount` is where counting stopped, and there are more (PRD 004,
   * §3.1.3): a large folder is counted through only when asked (`recount`).
   */
  readonly entryCountMore?: true;
}

/**
 * Extension → media type table.
 *
 * Deliberately small and dependency-free: it only has to cover what this
 * application actually serves — web assets, source code, images, media and
 * archives. Anything unknown is reported as `null` so callers can fall back to
 * `application/octet-stream` themselves.
 */
const MIME_TYPES: Readonly<Record<string, string>> = {
  // Web / markup
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  json: 'application/json',
  map: 'application/json',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  wasm: 'application/wasm',
  // Text / code
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  toml: 'text/plain',
  ini: 'text/plain',
  env: 'text/plain',
  ts: 'text/plain',
  tsx: 'text/plain',
  jsx: 'text/plain',
  sh: 'text/x-shellscript',
  py: 'text/x-python',
  rb: 'text/x-ruby',
  rs: 'text/x-rust',
  go: 'text/x-go',
  java: 'text/x-java-source',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++src',
  sql: 'application/sql',
  // Images
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  // Fonts
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  // Audio / video
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // Documents
  pdf: 'application/pdf',
  rtf: 'application/rtf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Archives
  zip: 'application/zip',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  bz2: 'application/x-bzip2',
  xz: 'application/x-xz',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
};

/** Bytes a file system block accounts for in `Stats.blocks`. */
const BLOCK_SIZE = 512;

/**
 * Everything the detail view needs about one entry: the fields shared with a
 * listing (delegated to {@link FileEntry}) plus ownership, permissions and the
 * few derived values the UI would otherwise have to compute itself.
 */
export class FileDetails {
  readonly entry: FileEntry;
  readonly accessedAt: Date;
  readonly changedAt: Date;
  readonly mode: number;
  readonly uid: number;
  readonly gid: number;
  readonly inode: number;
  readonly sizeOnDisk: number;
  readonly symlinkTarget: string | null;
  readonly entryCount: number | null;
  readonly entryCountMore: boolean;

  constructor(props: {
    entry: FileEntry;
    accessedAt: Date;
    changedAt: Date;
    mode: number;
    uid: number;
    gid: number;
    inode: number;
    sizeOnDisk: number;
    symlinkTarget: string | null;
    entryCount: number | null;
    entryCountMore?: boolean;
  }) {
    this.entry = props.entry;
    this.accessedAt = props.accessedAt;
    this.changedAt = props.changedAt;
    this.mode = props.mode;
    this.uid = props.uid;
    this.gid = props.gid;
    this.inode = props.inode;
    this.sizeOnDisk = props.sizeOnDisk;
    this.symlinkTarget = props.symlinkTarget;
    this.entryCount = props.entryCount;
    this.entryCountMore = props.entryCountMore ?? false;
  }

  /**
   * Builds the model from a raw `lstat` result. The extras that cannot be read
   * from `Stats` — the resolved symlink target and the child count of a
   * directory — are supplied by the service.
   */
  static fromStats(
    relativePath: string,
    stats: Stats,
    extras: {
      symlinkTarget?: string | null;
      entryCount?: number | null;
      entryCountMore?: boolean;
      targetType?: FileEntryTargetType;
    } = {},
  ): FileDetails {
    return new FileDetails({
      entry: FileEntry.fromStats(relativePath, stats, extras.targetType),
      accessedAt: stats.atime,
      changedAt: stats.ctime,
      mode: stats.mode,
      uid: stats.uid,
      gid: stats.gid,
      inode: stats.ino,
      sizeOnDisk: stats.blocks * BLOCK_SIZE,
      symlinkTarget: extras.symlinkTarget ?? null,
      entryCount: extras.entryCount ?? null,
      entryCountMore: extras.entryCountMore ?? false,
    });
  }

  /** Root-relative parent path, or `null` when this is the root itself. */
  get parent(): string | null {
    const path = this.entry.path;
    if (path === '') {
      return null;
    }
    const index = path.lastIndexOf('/');
    return index === -1 ? '' : path.slice(0, index);
  }

  get mimeType(): string | null {
    return this.entry.isFolderLike ? null : FileDetails.guessMimeType(this.entry.name);
  }

  /** The permission bits only, as four octal digits (e.g. `'0644'`). */
  static formatMode(mode: number): string {
    return (mode & 0o7777).toString(8).padStart(4, '0');
  }

  /** Splits the nine permission bits into owner / group / others triplets. */
  static permissionsOf(mode: number): FilePermissionsDto {
    return {
      owner: FileDetails.tripletOf(mode, 6),
      group: FileDetails.tripletOf(mode, 3),
      others: FileDetails.tripletOf(mode, 0),
    };
  }

  /**
   * Media type for a file name, from its extension alone; `null` when the
   * extension is missing or unknown.
   */
  static guessMimeType(name: string): string | null {
    const extension = extname(name).slice(1).toLowerCase();
    if (extension === '') {
      return null;
    }
    return MIME_TYPES[extension] ?? null;
  }

  private static tripletOf(mode: number, shift: number): PermissionTripletDto {
    const bits = (mode >> shift) & 0o7;
    return {
      read: (bits & 0b100) !== 0,
      write: (bits & 0b010) !== 0,
      execute: (bits & 0b001) !== 0,
    };
  }

  toJSON(): FileDetailsDto {
    return {
      ...this.entry.toJSON(),
      parent: this.parent,
      accessedAt: this.accessedAt.toISOString(),
      changedAt: this.changedAt.toISOString(),
      mode: FileDetails.formatMode(this.mode),
      permissions: FileDetails.permissionsOf(this.mode),
      uid: this.uid,
      gid: this.gid,
      inode: this.inode,
      sizeOnDisk: this.sizeOnDisk,
      mimeType: this.mimeType,
      symlinkTarget: this.symlinkTarget,
      entryCount: this.entryCount,
      ...(this.entryCountMore ? { entryCountMore: true as const } : {}),
    };
  }
}
