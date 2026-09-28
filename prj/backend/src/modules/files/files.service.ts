import { randomBytes } from 'node:crypto';
import { createWriteStream, type Stats } from 'node:fs';
import { lstat, mkdir, open, opendir, readdir, readlink, realpath, rename, stat, unlink } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, resolve as resolvePath, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { HttpError, type Logger } from '../../core/index.js';
import { FilePathResolver, ResolvedPath } from './file-path.resolver.js';
import { LargeListings, type ListingProgressDto } from './large-listing.service.js';
import {
  DirectoryListing,
  FileDetails,
  FileEntry,
  SearchResult,
  type FileEntryTargetType,
  type FileEntryType,
} from './models/index.js';

/**
 * How many entries of one directory are `lstat`ed at once. Enough to keep a
 * network mount busy, few enough never to exhaust file descriptors.
 */
const LISTING_CONCURRENCY = 64;

/**
 * The bounds of one name search (PRD 003, §5). A search is a walk of the
 * tree, and a tree can be a whole disk: it stops — and says so, `truncated`
 * — at the first of these rather than keep a request open for minutes.
 */
export const SEARCH_LIMITS = {
  /** Matches returned when the caller does not say. */
  defaultResults: 500,
  /** Matches returned at most; a bigger `limit` is clamped to this. */
  maxResults: 2000,
  /** Entries looked at, at most. */
  maxScanned: 200_000,
  /** Time spent walking, at most. */
  budgetMs: 10_000,
  /** Folders read at once, as a listing `lstat`s entries. */
  concurrency: 16,
} as const;

/** The most paths one `hostPaths` call answers for. */
export const HOST_PATHS_MAX = 10_000;

/** Top-level folders of `/` a search passes over: the kernel's, not anyone's files. */
const PSEUDO_FILE_SYSTEMS: ReadonlySet<string> = new Set(['proc', 'sys', 'dev', 'run']);

/**
 * What the list of drives is described as: a folder with no size, no owner
 * and no date — it is not on any disk.
 */
const VIRTUAL_FOLDER_STATS = {
  isDirectory: () => true,
  isFile: () => false,
  isSymbolicLink: () => false,
  size: 0,
  mode: 0o40555,
  uid: 0,
  gid: 0,
  ino: 0,
  blocks: 0,
  atime: new Date(0),
  mtime: new Date(0),
  ctime: new Date(0),
  birthtime: new Date(0),
} as unknown as Stats;

/** What the desktop shell needs to hand one entry to the operating system. */
export interface LocalPath {
  /** Absolute host path — the entry itself, not what a link leads to. */
  readonly absolute: string;
  readonly name: string;
  /** What the entry is, a link judged by what it leads to. */
  readonly type: FileEntryType;
  /** A regular file with any execute bit set. */
  readonly executable: boolean;
}

/** Everything the download route needs to stream one file back. */
export interface DownloadTarget {
  /** Absolute host path, safe to hand to `res.sendFile`. */
  readonly absolutePath: string;
  readonly name: string;
  readonly size: number;
  readonly mimeType: string | null;
}

/** One file part of a multipart upload, already separated from its transport. */
export interface UploadRequest {
  /** Root-relative directory the file is stored in; `undefined` is the root. */
  readonly directoryPath: string | undefined;
  /** Client-supplied name; reduced to a basename and validated here. */
  readonly filename: string;
  /** Body of the file part. */
  readonly content: Readable;
  /** Replace an existing target instead of failing with `409`. */
  readonly overwrite: boolean;
}

/**
 * An upload that has passed every check that does not need its bytes: the
 * directory exists, the name is safe, and the target may be written. Made by
 * `prepareUpload`, consumed by `storeUpload`.
 */
export interface PreparedUpload {
  /** Root-relative path the file will have. */
  readonly relative: string;
  readonly target: ResolvedPath;
  readonly directory: ResolvedPath;
  readonly name: string;
}

/** Browsing, downloading and uploading beneath the configured root. */
export class FilesService {
  constructor(
    private readonly resolver: FilePathResolver,
    private readonly logger: Logger,
    /** Hard ceiling for a single uploaded file body, in bytes. */
    private readonly uploadMaxBytes: number,
    /** Where large folders are read (PRD 004, §3.1). */
    readonly largeListings: LargeListings = new LargeListings(resolver, logger),
  ) {}

  get root(): string {
    return this.resolver.rootPath;
  }

  /**
   * Lists the direct children of a directory — or of the directory a symlink
   * leads to, which `resolveReal` has already proven to be inside the root.
   *
   * Entries are `lstat`ed in parallel, `LISTING_CONCURRENCY` at a time: one
   * after another, a folder of ten thousand entries is ten thousand round
   * trips before the first byte of the answer, which on a network mount is
   * the difference between instant and minutes.
   *
   * A folder of `LargeListings.threshold` entries or more is not read here at
   * all (PRD 004, §3.1): counting stops at the threshold, and a worker thread
   * reads the folder by stages — the listing comes back empty, with the token
   * `listProgress` answers for. Below it nothing changes, and the names read
   * while counting are the ones listed, so a small folder is read once.
   */
  async listDirectory(requestedPath: string | undefined): Promise<DirectoryListing> {
    const target = await this.resolver.resolveReal(requestedPath);
    if (this.isDriveList(target)) {
      return new DirectoryListing('', await this.listDrives());
    }
    const stats = await this.statOrFail(target);

    if (!stats.isDirectory()) {
      throw HttpError.badRequest(`Not a directory: ${target.relative || '/'}`);
    }

    const skip = target.relative === '' ? this.resolver.reservedNames : [];
    const read = await this.readBelowOrFail(target, this.largeListings.threshold, skip);
    if (read === null) {
      return new DirectoryListing(target.relative, [], this.largeListings.start(target, skip));
    }
    const dirents = read;
    const entries = await mapLimited(dirents, LISTING_CONCURRENCY, (dirent) => {
      const childRelative =
        target.relative === '' ? dirent.name : `${target.relative}/${dirent.name}`;
      return this.describeChild(join(target.absolute, dirent.name), childRelative);
    });

    return new DirectoryListing(
      target.relative,
      entries.filter((entry): entry is FileEntry => entry !== null),
    ).sorted();
  }

  /** One listing entry, or `null` when it vanished or cannot be read. */
  private async describeChild(absolute: string, relative: string): Promise<FileEntry | null> {
    try {
      const stats = await lstat(absolute);
      return FileEntry.fromStats(
        relative,
        stats,
        stats.isSymbolicLink() ? await this.linkTargetType(absolute) : undefined,
      );
    } catch (error) {
      // A racing unlink or an unreadable entry must not fail the whole listing.
      this.logger.debug('skipped unreadable entry', {
        path: relative,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * What a symlink leads to, if that is inside the root: a link to a folder
   * is opened like one, while a dangling link or one that leaves the root is
   * `null` — the resolver would refuse to follow it anyway.
   */
  private async linkTargetType(absolute: string): Promise<FileEntryTargetType> {
    try {
      const real = await realpath(absolute);
      if (this.resolver.toRootRelative(real) === null) {
        return null;
      }
      return FileEntry.typeOf(await stat(real)) as FileEntryTargetType;
    } catch {
      return null;
    }
  }

  /**
   * The drives of a Windows machine, as the listing of a
   * `FilePathResolver.drives()` root (PRD 003, §6): every letter whose root
   * answers a `stat`, so an empty card reader or a lost network drive is
   * simply not there.
   */
  private async listDrives(): Promise<FileEntry[]> {
    const letters = Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index));
    const drives = await mapLimited(letters, letters.length, async (letter) => {
      try {
        return FileEntry.fromStats(`${letter}:`, await stat(`${letter}:\\`));
      } catch {
        return null;
      }
    });
    return drives.filter((entry): entry is FileEntry => entry !== null);
  }

  /** Whether `target` is the list of drives rather than anything on disk. */
  private isDriveList(target: ResolvedPath): boolean {
    return this.resolver.allDrives && target.relative === '';
  }

  /** Returns metadata for a single entry (file or directory). */
  async statEntry(requestedPath: string | undefined): Promise<FileEntry> {
    const target = await this.resolver.resolveReal(requestedPath);
    if (this.isDriveList(target)) {
      return FileEntry.fromStats('', VIRTUAL_FOLDER_STATS);
    }
    return FileEntry.fromStats(target.relative, await this.lstatOrFail(target));
  }

  /** Full detail view of one entry, as served by `GET /fs/details`. */
  async getDetails(requestedPath: string | undefined): Promise<FileDetails> {
    return this.describe(await this.resolver.resolveReal(requestedPath));
  }

  /**
   * The details of an entry whose place is already proven — the entry itself,
   * `lstat`ed, so a link that was just renamed or made is described even when
   * what it leads to is outside the root.
   */
  private async describe(target: ResolvedPath): Promise<FileDetails> {
    if (this.isDriveList(target)) {
      return FileDetails.fromStats('', VIRTUAL_FOLDER_STATS, { entryCount: (await this.listDrives()).length });
    }
    const stats = await this.lstatOrFail(target);
    const targetType = stats.isSymbolicLink() ? await this.linkTargetType(target.absolute) : undefined;
    const folder = stats.isDirectory() || targetType === 'directory';

    return FileDetails.fromStats(target.relative, stats, {
      entryCount: folder ? await this.countEntries(target) : null,
      symlinkTarget: stats.isSymbolicLink() ? await this.readSymlinkTarget(target) : null,
      ...(targetType === undefined ? {} : { targetType }),
    });
  }

  /**
   * Renames or moves one entry (PRD 003, §5): `to` is the full root-relative
   * path it will have — usually the same folder under a new name, but Undo of
   * a move hands in another folder.
   *
   * The entry is taken as itself: a symlink is renamed as a link, never
   * followed, so only its *folder* has to be proven inside the root, not what
   * it leads to. A name that is taken is a `409` — except when it is the very
   * same entry, which is a case-only rename on a case-insensitive disk.
   * Crossing file systems is refused rather than turned into a copy: that is
   * a job, with progress, and `/api/ops/move` is where it lives.
   */
  async rename(requestedPath: string | undefined, to: string): Promise<FileDetails> {
    const source = await this.resolveEntry(requestedPath);
    if (this.resolver.isRoot(source.relative)) {
      throw HttpError.badRequest('The root folder itself cannot be renamed');
    }
    const sourceStats = await this.lstatOrFail(source);

    const split = to.lastIndexOf('/');
    const name = FilesService.safeFilename(split === -1 ? to : to.slice(split + 1));
    const folder = await this.resolver.resolveReal(split === -1 ? '' : to.slice(0, split));
    const folderStats = await this.statOrFail(folder);
    if (!folderStats.isDirectory()) {
      throw HttpError.badRequest(`Not a directory: ${folder.relative || '/'}`);
    }
    const target = this.resolver.resolve(folder.relative === '' ? name : `${folder.relative}/${name}`);
    if (this.resolver.isRoot(target.relative)) {
      throw HttpError.badRequest('Nothing can be renamed to the root folder');
    }
    if (target.absolute === source.absolute) {
      return this.describe(target); // Renamed to what it is already called.
    }

    if (sourceStats.isDirectory()) {
      const sourceReal = await realpath(source.absolute);
      const folderReal = await realpath(folder.absolute);
      if (folderReal === sourceReal || folderReal.startsWith(sourceReal + sep)) {
        throw HttpError.badRequest(`A folder cannot go into itself: ${source.relative}`);
      }
    }

    const existing = await lstat(target.absolute).catch(() => null);
    if (existing !== null && !(existing.ino === sourceStats.ino && existing.dev === sourceStats.dev)) {
      throw HttpError.conflict(`'${name}' already exists in ${folder.relative || '/'}`);
    }

    try {
      await rename(source.absolute, target.absolute);
    } catch (error) {
      if (FilePathResolver.isErrnoException(error) && error.code === 'EXDEV') {
        throw HttpError.badRequest(
          `'${posix.basename(source.relative)}' is on another disk than ${folder.relative || '/'}; move it instead of renaming it`,
        );
      }
      throw FilesService.toHttpError(error, source);
    }

    this.logger.debug('renamed', { from: source.relative, to: target.relative });
    return this.describe(target);
  }

  /** Makes an empty folder `name` in `parent` (PRD 003, §5); a taken name is a `409`. */
  async createFolder(parent: string | undefined, name: string): Promise<FileDetails> {
    const target = await this.newChild(parent, name);
    try {
      await mkdir(target.absolute);
    } catch (error) {
      throw FilesService.toHttpError(error, target);
    }
    return this.describe(target);
  }

  /**
   * Makes an empty file `name` in `parent` (PRD 003, §5). Opened with `wx`,
   * so a name taken in the meantime is a `409` and never a truncated file.
   */
  async createFile(parent: string | undefined, name: string): Promise<FileDetails> {
    const target = await this.newChild(parent, name);
    try {
      await (await open(target.absolute, 'wx')).close();
    } catch (error) {
      throw FilesService.toHttpError(error, target);
    }
    return this.describe(target);
  }

  /**
   * Finds entries by name beneath a folder (PRD 003, §5).
   *
   * Case-insensitive; a query with `*` or `?` is a glob over the whole name,
   * anything else a substring. The walk is breadth-first, so what is near
   * the top — usually what someone means — comes first, and it reads
   * `SEARCH_LIMITS.concurrency` folders at a time. It never follows a linked
   * folder: that could loop, or walk a second copy of the tree; a link is
   * still matched and reported, with `targetType` as a listing has it. The
   * server's trash is skipped, and a folder that cannot be read is passed
   * over in silence — one private folder must not fail a search of the rest.
   */
  async search(requestedPath: string | undefined, query: string, limit: number = SEARCH_LIMITS.defaultResults): Promise<SearchResult> {
    const matches = FilesService.matcher(query);
    if (!Number.isInteger(limit) || limit < 1) {
      throw HttpError.badRequest('"limit" must be a whole number of at least 1');
    }
    const wanted = Math.min(limit, SEARCH_LIMITS.maxResults);
    const start = await this.resolver.resolveReal(requestedPath);
    if (this.isDriveList(start)) {
      throw HttpError.badRequest('Choose a drive to search');
    }
    if (!(await this.statOrFail(start)).isDirectory()) {
      throw HttpError.badRequest(`Not a directory: ${start.relative || '/'}`);
    }

    const deadline = performance.now() + SEARCH_LIMITS.budgetMs;
    const found: { absolute: string; relative: string }[] = [];
    let scanned = 0;
    let truncated = false;
    let level: { absolute: string; relative: string }[] = [{ absolute: start.absolute, relative: start.relative }];

    walk: while (level.length > 0) {
      const next: typeof level = [];
      // A batch at a time, so a level of a hundred thousand folders is never all in memory at once.
      for (let offset = 0; offset < level.length; offset += SEARCH_LIMITS.concurrency) {
        if (performance.now() > deadline) {
          truncated = true;
          break walk;
        }
        const batch = level.slice(offset, offset + SEARCH_LIMITS.concurrency);
        const listings = await mapLimited(batch, SEARCH_LIMITS.concurrency, (folder) =>
          readdir(folder.absolute, { withFileTypes: true }).catch(() => null),
        );
        for (const [index, dirents] of listings.entries()) {
          const folder = batch[index] as (typeof batch)[number];
          for (const dirent of dirents ?? []) {
            if (folder.relative === '' && this.resolver.isReserved(dirent.name)) {
              continue;
            }
            // The whole file system (PRD 003, §6): the kernel's own trees are
            // endless, or files nobody named, and are never walked into.
            if (folder.absolute === '/' && PSEUDO_FILE_SYSTEMS.has(dirent.name)) {
              continue;
            }
            if (scanned >= SEARCH_LIMITS.maxScanned) {
              truncated = true;
              break walk;
            }
            scanned += 1;
            const child = {
              absolute: join(folder.absolute, dirent.name),
              relative: folder.relative === '' ? dirent.name : `${folder.relative}/${dirent.name}`,
            };
            if (matches(dirent.name)) {
              if (found.length === wanted) {
                truncated = true; // One more than asked for: there are more.
                break walk;
              }
              found.push(child);
            }
            // `Dirent` describes the entry itself, so a link to a folder is not walked into.
            if (dirent.isDirectory()) {
              next.push(child);
            }
          }
        }
      }
      level = next;
    }

    const entries = await mapLimited(found, LISTING_CONCURRENCY, (match) =>
      this.describeChild(match.absolute, match.relative),
    );
    return new SearchResult(
      start.relative,
      query,
      entries.filter((entry): entry is FileEntry => entry !== null),
      truncated,
      scanned,
    );
  }

  /**
   * Where an entry is on this machine, for the desktop shell to open or show
   * it with the operating system's own tools. Not an HTTP route: a host path
   * is of no use to a browser and must not be handed to one.
   */
  async localPath(requestedPath: string | undefined): Promise<LocalPath> {
    const target = await this.resolver.resolveReal(requestedPath);
    const stats = await this.statOrFail(target);
    return {
      absolute: target.absolute,
      name: target.relative === '' ? basename(target.absolute) : posix.basename(target.relative),
      type: FileEntry.typeOf(stats),
      executable: stats.isFile() && (stats.mode & 0o111) !== 0,
    };
  }

  /**
   * Where entries are on the server's disk (PRD 004, §1.3.2) — what *Copy
   * Path* copies: the full host path of each, in the host's own form
   * (`/srv/files/docs/a.md`, `C:\Users\me`). Worked out from the path alone, so
   * an entry that is not there still has one; every path is proven inside
   * the root first, as any request path is. The root of a server over every
   * Windows drive is no folder, and answers `''`.
   */
  hostPaths(requestedPaths: readonly string[]): string[] {
    if (requestedPaths.length === 0 || requestedPaths.length > HOST_PATHS_MAX) {
      throw HttpError.badRequest(`Name between 1 and ${HOST_PATHS_MAX} paths`);
    }
    return requestedPaths.map((path) => this.resolver.resolve(path).absolute);
  }

  /**
   * The root-relative path of a host path, or `null` when it is outside the
   * root, reserved, or not there — the inverse of `localPath`, for paths the
   * operating system hands the desktop shell (PRD 003, §6). Proven the way a
   * request path is, links and all.
   */
  async fromLocalPath(absolute: string): Promise<string | null> {
    if (!isAbsolute(absolute)) {
      return null;
    }
    const relative = this.resolver.toRootRelative(absolute);
    if (relative === null) {
      return null;
    }
    try {
      const entry = await this.resolveEntry(relative);
      await lstat(entry.absolute);
      return entry.relative;
    } catch {
      return null;
    }
  }

  /**
   * An entry taken as itself: its path must be in the root and its *folder*
   * proven there — through links, too — but the entry is not followed, so a
   * symlink resolves to the link and not to what it leads to.
   */
  private async resolveEntry(requestedPath: string | undefined): Promise<ResolvedPath> {
    const lexical = this.resolver.resolve(requestedPath);
    if (lexical.relative === '') {
      return this.resolver.resolveReal('');
    }
    const index = lexical.relative.lastIndexOf('/');
    const folder = await this.resolver.resolveReal(index === -1 ? '' : lexical.relative.slice(0, index));
    return new ResolvedPath(join(folder.absolute, posix.basename(lexical.relative)), lexical.relative);
  }

  /** Where a new entry `name` in `parent` goes: `parent` a folder, the name safe. */
  private async newChild(parent: string | undefined, name: string): Promise<ResolvedPath> {
    const folder = await this.resolver.resolveReal(parent);
    if (!(await this.statOrFail(folder)).isDirectory()) {
      throw HttpError.badRequest(`Not a directory: ${folder.relative || '/'}`);
    }
    const safe = FilesService.safeFilename(name);
    return this.resolver.resolve(folder.relative === '' ? safe : `${folder.relative}/${safe}`);
  }

  /**
   * A name test for `query`: a glob over the whole name when it has `*` or
   * `?`, a substring otherwise; either way case-insensitive.
   */
  static matcher(query: string): (name: string) => boolean {
    const trimmed = query.trim();
    if (trimmed === '') {
      throw HttpError.badRequest('Search for something: the query is empty');
    }
    if (/[*?]/.test(trimmed)) {
      const source = trimmed
        .split('')
        .map((character) =>
          character === '*' ? '.*' : character === '?' ? '.' : character.replace(/[.+^${}()|[\]\\]/g, '\\$&'),
        )
        .join('');
      const pattern = new RegExp(`^${source}$`, 'is');
      return (name) => pattern.test(name);
    }
    const needle = trimmed.toLowerCase();
    return (name) => name.toLowerCase().includes(needle);
  }

  /**
   * Validates that a path is a downloadable regular file. A symlink is judged
   * by what it leads to — its size, and whether it is a file at all — since
   * `resolveReal` has already proven that to be inside the root.
   */
  async resolveDownload(requestedPath: string | undefined): Promise<DownloadTarget> {
    const target = await this.resolver.resolveReal(requestedPath);
    const stats = await this.statOrFail(target);

    if (stats.isDirectory()) {
      throw HttpError.badRequest(`Not a file: ${target.relative || '/'}`);
    }
    if (!stats.isFile()) {
      throw HttpError.badRequest(`Not a regular file: ${target.relative || '/'}`);
    }

    const name = posix.basename(target.relative);
    return {
      absolutePath: target.absolute,
      name,
      size: stats.size,
      mimeType: FileDetails.guessMimeType(name),
    };
  }

  /**
   * Streams one uploaded file into the target directory.
   *
   * The bytes land in a sibling temporary file and are only `rename`d onto the
   * real name once the stream has completed, so an interrupted or oversized
   * upload can never leave a truncated file behind under the final name.
   */
  async saveUpload(request: UploadRequest): Promise<FileDetails> {
    return this.storeUpload(await this.prepareUpload(request), request.content);
  }

  /**
   * The checks an upload can fail before a single byte is sent — a missing
   * directory, an unsafe name, a target that exists — so a caller that feeds
   * the bytes in over time (the desktop bridge) can refuse up front rather
   * than after the whole file has crossed.
   */
  async prepareUpload(request: Omit<UploadRequest, 'content'>): Promise<PreparedUpload> {
    const directory = await this.resolver.resolveReal(request.directoryPath);
    const directoryStats = await this.statOrFail(directory);
    if (!directoryStats.isDirectory()) {
      throw HttpError.badRequest(`Not a directory: ${directory.relative || '/'}`);
    }

    const name = FilesService.safeFilename(request.filename);
    const relative = directory.relative === '' ? name : `${directory.relative}/${name}`;
    const target = this.resolver.resolve(relative);

    await this.assertWritableTarget(target, request.overwrite);
    return { relative, target, directory, name };
  }

  /** Streams the bytes of a prepared upload to disk; see `saveUpload`. */
  async storeUpload(prepared: PreparedUpload, content: Readable): Promise<FileDetails> {
    const { directory, name, target, relative } = prepared;
    const temporary = join(directory.absolute, `.${name}.${randomBytes(8).toString('hex')}.part`);
    try {
      await this.writeLimited(content, temporary);
      await rename(temporary, target.absolute);
    } catch (error) {
      await this.discard(temporary);
      throw FilesService.toHttpError(error, target);
    }

    return this.getDetails(relative);
  }

  /** Pipes `content` into `temporary`, aborting once the byte limit is passed. */
  private async writeLimited(content: Readable, temporary: string): Promise<void> {
    const limit = this.uploadMaxBytes;
    let written = 0;

    await pipeline(
      content,
      async function* enforceLimit(source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
        for await (const chunk of source) {
          written += chunk.length;
          if (written > limit) {
            throw HttpError.payloadTooLarge(`Upload exceeds the limit of ${limit} bytes`);
          }
          yield chunk;
        }
      },
      createWriteStream(temporary, { flags: 'wx' }),
    );
  }

  /** Rejects an upload whose target already exists and may not be replaced. */
  private async assertWritableTarget(target: ResolvedPath, overwrite: boolean): Promise<void> {
    let existing: Awaited<ReturnType<typeof lstat>>;
    try {
      existing = await lstat(target.absolute);
    } catch (error) {
      if (FilePathResolver.isErrnoException(error) && error.code === 'ENOENT') {
        return;
      }
      throw FilesService.toHttpError(error, target);
    }

    if (!overwrite) {
      throw HttpError.conflict(`Target already exists: ${target.relative}`);
    }
    if (existing.isDirectory()) {
      throw HttpError.conflict(`Target exists and is a directory: ${target.relative}`);
    }
  }

  /** Best-effort removal of a temporary file; failures are logged, not raised. */
  private async discard(temporary: string): Promise<void> {
    try {
      await unlink(temporary);
    } catch (error) {
      if (FilePathResolver.isErrnoException(error) && error.code === 'ENOENT') {
        return;
      }
      this.logger.warn('failed to remove temporary upload file', {
        path: temporary,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Child count of a directory; an unreadable directory reports `null`.
   * Counted as the names stream past rather than read into one array, which
   * for a folder of millions (PRD 004, §3.1) is seconds and hundreds of
   * megabytes of this thread.
   */
  private async countEntries(target: ResolvedPath): Promise<number | null> {
    try {
      let count = 0;
      for await (const _dirent of await opendir(target.absolute, { bufferSize: 1024 })) {
        count++;
      }
      return count;
    } catch (error) {
      // Details of an unreadable directory are still useful; report no count.
      this.logger.debug('failed to count directory entries', {
        path: target.relative || '/',
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /** Symlink destination as a root-relative path, or `null` when it escapes. */
  private async readSymlinkTarget(target: ResolvedPath): Promise<string | null> {
    try {
      const raw = await readlink(target.absolute);
      const absolute = isAbsolute(raw) ? resolvePath(raw) : resolvePath(dirname(target.absolute), raw);
      return this.resolver.toRootRelative(absolute);
    } catch (error) {
      this.logger.debug('failed to read symlink target', {
        path: target.relative,
        reason: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Reduces a client-supplied multipart `filename` to a single safe path
   * segment. Anything that could reach outside the target directory — a
   * separator, `.`/`..`, a null byte — is rejected outright rather than
   * silently rewritten.
   */
  static safeFilename(filename: string): string {
    const trimmed = filename.trim();
    if (trimmed.includes('\0')) {
      throw HttpError.badRequest('File name must not contain null bytes');
    }
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes(sep)) {
      throw HttpError.badRequest('File name must not contain a path separator');
    }
    if (trimmed === '' || trimmed === '.' || trimmed === '..') {
      throw HttpError.badRequest('File name is missing or invalid');
    }
    return basename(trimmed);
  }

  private async lstatOrFail(target: ResolvedPath) {
    try {
      return await lstat(target.absolute);
    } catch (error) {
      throw FilesService.toHttpError(error, target);
    }
  }

  /** Like `lstatOrFail`, but follows a symlink to what it points at. */
  private async statOrFail(target: ResolvedPath) {
    try {
      return await stat(target.absolute);
    } catch (error) {
      throw FilesService.toHttpError(error, target);
    }
  }

  /** Stops reading a large folder the caller no longer wants (PRD 004, §3.1.2). */
  cancelListing(token: string): void {
    this.largeListings.cancel(token);
  }

  /** Where a large folder's reading has got to (PRD 004, §3.1), from the caller's cursors. */
  listProgress(token: string, namesFrom?: number, detailsFrom?: number): ListingProgressDto {
    return this.largeListings.progress(token, namesFrom, detailsFrom);
  }

  /**
   * A folder's entries, reserved names left out — or `null` once there are
   * `limit` of them, which is as far as it reads: a large folder is the
   * worker's to read, not this thread's.
   */
  private async readBelowOrFail(target: ResolvedPath, limit: number, skip: readonly string[]): Promise<Dirent[] | null> {
    const dirents: Dirent[] = [];
    try {
      const handle = await opendir(target.absolute, { bufferSize: 256 });
      for await (const dirent of handle) {
        if (skip.includes(dirent.name)) {
          continue;
        }
        dirents.push(dirent);
        if (dirents.length >= limit) {
          // Leaving the loop early closes the handle.
          return null;
        }
      }
      return dirents;
    } catch (error) {
      throw FilesService.toHttpError(error, target);
    }
  }

  private static toHttpError(error: unknown, target: ResolvedPath): HttpError {
    if (error instanceof HttpError) {
      return error;
    }
    const label = target.relative || '/';
    if (FilePathResolver.isErrnoException(error)) {
      switch (error.code) {
        case 'ENOENT':
          return HttpError.notFound(`Path not found: ${label}`);
        case 'ENOTDIR':
          return HttpError.badRequest(`Not a directory: ${label}`);
        case 'EEXIST':
          return HttpError.conflict(`Target already exists: ${label}`);
        case 'EISDIR':
          return HttpError.conflict(`Target exists and is a directory: ${label}`);
        case 'EACCES':
        case 'EPERM':
          return HttpError.forbidden(`Permission denied: ${label}`);
        case 'ELOOP':
          return HttpError.badRequest(`Too many symbolic links: ${label}`);
        default:
          break;
      }
    }
    return HttpError.internal(
      `Failed to read path: ${label}`,
      error instanceof Error ? error.message : undefined,
    );
  }
}

/**
 * `Promise.all(items.map(run))`, but with at most `limit` calls in flight.
 * Results keep the order of `items`.
 */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index] as T);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}
