import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { HttpError, type Logger } from '../../core/index.js';
import { FilePathResolver, type ResolvedPath } from './file-path.resolver.js';
import { DirectoryListing, FileEntry } from './models/index.js';

/** Read-only browsing of the file tree beneath the configured root. */
export class FilesService {
  constructor(
    private readonly resolver: FilePathResolver,
    private readonly logger: Logger,
  ) {}

  get root(): string {
    return this.resolver.rootPath;
  }

  /** Lists the direct children of a directory. */
  async listDirectory(requestedPath: string | undefined): Promise<DirectoryListing> {
    const target = await this.resolver.resolveReal(requestedPath);
    const stats = await this.lstatOrFail(target);

    if (!stats.isDirectory()) {
      throw HttpError.badRequest(`Not a directory: ${target.relative || '/'}`);
    }

    const dirents = await this.readdirOrFail(target);
    const entries: FileEntry[] = [];

    for (const dirent of dirents) {
      const childAbsolute = join(target.absolute, dirent.name);
      const childRelative = target.relative === '' ? dirent.name : `${target.relative}/${dirent.name}`;
      try {
        entries.push(FileEntry.fromStats(childRelative, await lstat(childAbsolute)));
      } catch (error) {
        // A racing unlink or an unreadable entry must not fail the whole listing.
        this.logger.debug('skipped unreadable entry', {
          path: childRelative,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return new DirectoryListing(target.relative, entries).sorted();
  }

  /** Returns metadata for a single entry (file or directory). */
  async statEntry(requestedPath: string | undefined): Promise<FileEntry> {
    const target = await this.resolver.resolveReal(requestedPath);
    return FileEntry.fromStats(target.relative, await this.lstatOrFail(target));
  }

  private async lstatOrFail(target: ResolvedPath) {
    try {
      return await lstat(target.absolute);
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
