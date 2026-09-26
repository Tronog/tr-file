import { randomBytes } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, readdir, readlink, realpath, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve as resolvePath, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { HttpError, type Logger } from '../../core/index.js';
import { FilePathResolver, type ResolvedPath } from './file-path.resolver.js';
import { DirectoryListing, FileDetails, FileEntry, type FileEntryTargetType } from './models/index.js';

/**
 * How many entries of one directory are `lstat`ed at once. Enough to keep a
 * network mount busy, few enough never to exhaust file descriptors.
 */
const LISTING_CONCURRENCY = 64;

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
   */
  async listDirectory(requestedPath: string | undefined): Promise<DirectoryListing> {
    const target = await this.resolver.resolveReal(requestedPath);
    const stats = await this.statOrFail(target);

    if (!stats.isDirectory()) {
      throw HttpError.badRequest(`Not a directory: ${target.relative || '/'}`);
    }

    const dirents = (await this.readdirOrFail(target)).filter(
      (dirent) => target.relative !== '' || !this.resolver.isReserved(dirent.name),
    );
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

  /** Returns metadata for a single entry (file or directory). */
  async statEntry(requestedPath: string | undefined): Promise<FileEntry> {
    const target = await this.resolver.resolveReal(requestedPath);
    return FileEntry.fromStats(target.relative, await this.lstatOrFail(target));
  }

  /** Full detail view of one entry, as served by `GET /fs/details`. */
  async getDetails(requestedPath: string | undefined): Promise<FileDetails> {
    const target = await this.resolver.resolveReal(requestedPath);
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

    const name = basename(target.relative);
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

  /** Child count of a directory; an unreadable directory reports `null`. */
  private async countEntries(target: ResolvedPath): Promise<number | null> {
    try {
      return (await readdir(target.absolute)).length;
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

  private async readdirOrFail(target: ResolvedPath) {
    try {
      return await readdir(target.absolute, { withFileTypes: true });
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
