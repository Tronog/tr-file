import { randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, type Stats } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readlink, realpath, rename, rm, stat, symlink, utimes } from 'node:fs/promises';
import { basename, dirname, join, posix, relative as relativePath, resolve as resolvePath, sep } from 'node:path';
import type { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { HttpError, type Logger } from '../../core/index.js';
import type { FilePathResolver, ResolvedPath } from '../files/index.js';
import type { ArchiveEntryDto, ArchiveListingDto } from './archive.model.js';
import { ZipError, ZipReader, ZipWriter, type ZipEntry } from './zip/index.js';

/** More sources than this in one zip is a mistake, not a selection. */
const MAX_SOURCES = 10_000;

/** How far a zip being written has got; the job or the download reports it. */
export interface ZipProgress {
  readonly signal?: AbortSignal;
  /** Called with each chunk of file content read, in bytes. */
  readonly onBytes?: (bytes: number) => void;
  /** Called as each entry is started, with its root-relative path. */
  readonly onEntry?: (relative: string) => void;
}

/** The sources of a zip, checked: each inside the root and there. */
export interface ZipSources {
  readonly sources: readonly { readonly path: ResolvedPath; readonly stats: Stats }[];
  /** A name for the zip: the one source's, or the folder they share. */
  readonly suggestedName: string;
}

/** What an extraction will make, decided before anything is written. */
export interface ExtractPlan {
  readonly archive: ResolvedPath;
  readonly destination: ResolvedPath;
  /**
   * The folder everything goes into, when the archive has more than one
   * thing at its top — named after the archive — or `null` when its one top
   * entry goes straight into `destination`.
   */
  readonly wrapper: string | null;
  /** Total uncompressed bytes. */
  readonly totalBytes: number;
  readonly totalItems: number;
  /** Top-level names in `destination` the extraction creates. */
  readonly tops: readonly string[];
}

/**
 * Zip archives (PRD 003, §6): what is in one, one folder at a time; a zip of
 * any selection, streamed — a folder download, or *Compress*; and extracting
 * one. The last two run as `/api/ops` jobs; this does the work.
 *
 * Everything goes through the resolver like any file access, and an
 * archive's own names are never trusted: an entry that would land outside
 * the extraction folder is not extracted, and no file is ever written
 * through a link the archive made — links are made last, and only when they
 * lead somewhere inside what was extracted.
 */
export class ArchiveService {
  constructor(
    private readonly resolver: FilePathResolver,
    private readonly logger: Logger,
  ) {}

  /* -- browsing ------------------------------------------------------------------ */

  /** One folder of a zip, as a listing is: folders first, natural order. */
  async list(path: string | undefined, inner: string | undefined): Promise<ArchiveListingDto> {
    const archive = await this.archiveFile(path);
    const folder = (inner ?? '').replace(/^\/+|\/+$/g, '');
    const reader = await ArchiveService.open(archive);
    try {
      const items = reader.list(folder);
      if (items === null) {
        throw HttpError.notFound(`No folder '${folder}' in ${posix.basename(archive.relative)}`);
      }
      const entries: ArchiveEntryDto[] = items.map((item) => ({
        name: item.name,
        path: item.path,
        type: item.isDirectory ? 'directory' : item.isSymlink ? 'symlink' : 'file',
        size: item.isDirectory ? 0 : item.size,
        modifiedAt: item.mtime?.toISOString() ?? null,
      }));
      entries.sort(
        (a, b) =>
          Number(b.type === 'directory') - Number(a.type === 'directory') ||
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
      );
      return {
        path: archive.relative,
        inner: folder,
        entries,
        unsafe: reader.entries.filter((entry) => entry.unsafe).length,
      };
    } finally {
      await reader.close();
    }
  }

  /* -- writing a zip ------------------------------------------------------------- */

  /** Checks what a zip is to hold, before a byte of it is written. */
  async zipSources(paths: readonly string[]): Promise<ZipSources> {
    if (paths.length === 0 || paths.length > MAX_SOURCES) {
      throw HttpError.badRequest(`Choose between 1 and ${MAX_SOURCES} entries to zip`);
    }
    const sources: { path: ResolvedPath; stats: Stats }[] = [];
    const names = new Set<string>();
    for (const requested of paths) {
      const path = await this.resolver.resolveReal(requested);
      if (this.resolver.isRoot(path.relative)) {
        throw HttpError.badRequest('The root folder itself cannot be zipped; choose what is in it');
      }
      const name = posix.basename(path.relative);
      if (names.has(name)) {
        throw HttpError.badRequest(`Two entries are called '${name}'; a zip holds one of each name`);
      }
      names.add(name);
      sources.push({ path, stats: await ArchiveService.statOrFail(path, lstat) });
    }
    const first = sources[0] as (typeof sources)[number];
    const parent = posix.dirname(first.path.relative);
    const suggested =
      sources.length === 1
        ? posix.basename(first.path.relative)
        : parent === '.' || parent === ''
          ? 'Archive'
          : posix.basename(parent);
    return { sources, suggestedName: `${suggested.replace(/\.zip$/i, '')}.zip` };
  }

  /**
   * Writes a zip of `sources` to `output`, streaming — a folder of any size
   * costs one chunk of memory. Folders go in with everything in them, links
   * as links; sockets and devices are left out. `output` is ended when the
   * zip is complete; on a failure or an abort it is left for the caller to
   * destroy, since only the caller knows what else to clean up.
   */
  async writeZip(zip: ZipSources, output: Writable, progress: ZipProgress = {}): Promise<{ readonly bytes: number }> {
    const writer = new ZipWriter(output);
    let bytes = 0;
    const walk = async (absolute: string, relative: string, name: string, stats: Stats): Promise<void> => {
      progress.signal?.throwIfAborted();
      progress.onEntry?.(relative);
      if (stats.isDirectory()) {
        await writer.addDirectory(name, stats.mtime, stats.mode & 0o7777);
        let children: string[];
        try {
          children = await readdir(absolute);
        } catch (error) {
          throw ArchiveService.toHttpError(error, relative);
        }
        children.sort();
        for (const child of children) {
          const childAbsolute = join(absolute, child);
          const childStats = await lstat(childAbsolute).catch((error: unknown) => {
            // Gone since the folder was read, or unreadable: the rest of the zip still stands.
            this.logger.debug('left out of a zip', {
              path: `${relative}/${child}`,
              reason: error instanceof Error ? error.message : String(error),
            });
            return null;
          });
          if (childStats !== null) {
            await walk(childAbsolute, `${relative}/${child}`, `${name}/${child}`, childStats);
          }
        }
      } else if (stats.isSymbolicLink()) {
        await writer.addSymlink(name, await readlink(absolute), stats.mtime);
      } else if (stats.isFile()) {
        await writer.addFile(name, createReadStream(absolute), {
          mtime: stats.mtime,
          mode: stats.mode & 0o7777,
          size: stats.size,
          ...(progress.signal === undefined ? {} : { signal: progress.signal }),
          onBytes: (count) => {
            bytes += count;
            progress.onBytes?.(count);
          },
        });
      }
    };
    for (const { path, stats } of zip.sources) {
      await walk(path.absolute, path.relative, posix.basename(path.relative), stats);
    }
    await writer.finish();
    return { bytes };
  }

  /**
   * *Compress*: a zip of `paths` as `destination/name`, written to a hidden
   * temporary file and renamed into place once complete, so a cancelled or
   * failed compress leaves nothing behind under the real name.
   */
  async compress(zip: ZipSources, target: ResolvedPath, progress: ZipProgress & { readonly overwrite: boolean }): Promise<void> {
    const temporary = join(dirname(target.absolute), `.${basename(target.absolute)}.${randomBytes(6).toString('hex')}.part`);
    const output = createWriteStream(temporary, { flags: 'wx' });
    try {
      await this.writeZip(zip, output, progress);
      if (!progress.overwrite && (await ArchiveService.exists(target.absolute))) {
        throw HttpError.conflict(`'${posix.basename(target.relative)}' was made while this was compressing`);
      }
      await rename(temporary, target.absolute);
    } catch (error) {
      output.destroy();
      await rm(temporary, { force: true });
      throw error;
    }
  }

  /* -- extracting ---------------------------------------------------------------- */

  /**
   * Plans an extraction: the archive a zip, the destination a folder, and
   * where its content goes — straight in, when the archive holds one thing
   * at its top, or into a folder named after the archive otherwise, so an
   * archive of loose files never scatters them over a folder.
   */
  async planExtract(path: string, destination: string): Promise<ExtractPlan> {
    const archive = await this.archiveFile(path);
    const folder = await this.resolver.resolveReal(destination);
    if (!(await ArchiveService.statOrFail(folder, stat)).isDirectory()) {
      throw HttpError.badRequest(`Not a folder: ${folder.relative || '/'}`);
    }
    const reader = await ArchiveService.open(archive);
    try {
      const entries = reader.entries.filter((entry) => !entry.unsafe);
      const encrypted = entries.find((entry) => entry.encrypted);
      if (encrypted !== undefined) {
        throw HttpError.badRequest(`'${posix.basename(archive.relative)}' is encrypted, which is not supported`);
      }
      const tops = [...new Set(entries.map((entry) => entry.name.split('/', 1)[0] as string))].filter((top) => top !== '');
      const wrapper = tops.length === 1 ? null : posix.basename(archive.relative).replace(/\.zip$/i, '') || 'Archive';
      return {
        archive,
        destination: folder,
        wrapper,
        totalBytes: entries.reduce((sum, entry) => sum + (entry.isDirectory ? 0 : entry.size), 0),
        totalItems: entries.length,
        tops: wrapper === null ? tops : [wrapper],
      };
    } finally {
      await reader.close();
    }
  }

  /**
   * Extracts `plan.archive` into `into` — the destination, or the wrapper
   * folder in it — which the caller has made (or chosen a free name for).
   * Each file is written new (`wx`), so nothing is written through a link or
   * over anything: a clash inside the archive is an entry skipped. Links are
   * made after everything else, and only when they stay inside `into`.
   */
  async extract(
    plan: ExtractPlan,
    into: string,
    progress: {
      readonly signal: AbortSignal;
      readonly onBytes: (bytes: number) => void;
      readonly onItem: (relative: string) => void;
      readonly onSkip: () => void;
      /** Top-level entry `name` (in the archive) is to be written as `rename`. */
      readonly topName?: (name: string) => string;
    },
  ): Promise<void> {
    const reader = await ArchiveService.open(plan.archive);
    const root = resolvePath(into);
    const inside = (absolute: string): boolean => absolute === root || absolute.startsWith(root + sep);
    const links: { entry: ZipEntry; absolute: string }[] = [];
    const folders: { entry: ZipEntry; absolute: string }[] = [];
    try {
      for (const entry of reader.entries) {
        progress.signal.throwIfAborted();
        if (entry.unsafe) {
          progress.onSkip();
          continue;
        }
        const [top, ...rest] = entry.name.split('/');
        const name = [progress.topName?.(top as string) ?? top, ...rest].join('/');
        const absolute = resolvePath(root, ...name.split('/'));
        if (!inside(absolute) || absolute === root) {
          progress.onSkip();
          continue;
        }
        progress.onItem(name);
        if (entry.isDirectory) {
          await mkdir(absolute, { recursive: true });
          folders.push({ entry, absolute });
          continue;
        }
        await mkdir(dirname(absolute), { recursive: true });
        // The folder it lands in must still be inside: an archive can't have
        // made a link on the way, since links come last — but the disk may.
        if (!inside(await realpath(dirname(absolute)))) {
          progress.onSkip();
          continue;
        }
        if (entry.isSymlink) {
          links.push({ entry, absolute });
          continue;
        }
        try {
          await pipeline(await reader.openReadStream(entry), ArchiveService.counter(progress.onBytes), createWriteStream(absolute, { flags: 'wx' }), {
            signal: progress.signal,
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            progress.onSkip(); // Twice in one archive: the first one stays.
            continue;
          }
          await rm(absolute, { force: true });
          throw ArchiveService.toHttpError(error, name);
        }
        await chmod(absolute, (entry.mode ?? 0o644) & 0o777).catch(() => undefined);
        await utimes(absolute, entry.mtime, entry.mtime).catch(() => undefined);
      }

      for (const { entry, absolute } of links) {
        progress.signal.throwIfAborted();
        const stream = await reader.openReadStream(entry);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) {
          chunks.push(chunk as Buffer);
        }
        const target = Buffer.concat(chunks).toString('utf8');
        // Only a relative link that stays inside what was extracted.
        if (target === '' || posix.isAbsolute(target) || !inside(resolvePath(dirname(absolute), target))) {
          progress.onSkip();
          continue;
        }
        await symlink(target, absolute).catch(() => progress.onSkip());
      }

      // Dates last: writing into a folder changes its own.
      for (const { entry, absolute } of folders.reverse()) {
        await utimes(absolute, entry.mtime, entry.mtime).catch(() => undefined);
      }
    } finally {
      await reader.close();
    }
  }

  /* -- helpers ------------------------------------------------------------------- */

  /** A regular file in the root, to be read as a zip. */
  private async archiveFile(path: string | undefined): Promise<ResolvedPath> {
    const archive = await this.resolver.resolveReal(path);
    if (!(await ArchiveService.statOrFail(archive, stat)).isFile()) {
      throw HttpError.badRequest(`Not an archive: ${archive.relative || '/'}`);
    }
    return archive;
  }

  private static async open(archive: ResolvedPath): Promise<ZipReader> {
    try {
      return await ZipReader.open(archive.absolute);
    } catch (error) {
      throw ArchiveService.toHttpError(error, archive.relative);
    }
  }

  private static counter(onBytes: (bytes: number) => void) {
    return async function* count(source: AsyncIterable<Buffer>): AsyncGenerator<Buffer> {
      for await (const chunk of source) {
        onBytes(chunk.length);
        yield chunk;
      }
    };
  }

  static async exists(absolute: string): Promise<boolean> {
    return lstat(absolute).then(
      () => true,
      () => false,
    );
  }

  private static async statOrFail(target: ResolvedPath, how: typeof stat): Promise<Stats> {
    try {
      return await how(target.absolute);
    } catch (error) {
      throw ArchiveService.toHttpError(error, target.relative);
    }
  }

  /** What went wrong, in the API's words. */
  static toHttpError(error: unknown, relative: string): unknown {
    if (error instanceof HttpError || (error instanceof Error && error.name === 'AbortError')) {
      return error;
    }
    const label = relative || '/';
    if (error instanceof ZipError) {
      switch (error.code) {
        case 'NOT_A_ZIP':
          return HttpError.badRequest(`'${posix.basename(label)}' is not a zip archive`);
        case 'UNSUPPORTED':
        case 'ENCRYPTED':
          return HttpError.badRequest(`'${posix.basename(label)}': ${error.message}`);
        default:
          return HttpError.badRequest(`'${posix.basename(label)}' is damaged: ${error.message}`);
      }
    }
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    switch (code) {
      case 'ENOENT':
        return HttpError.notFound(`Path not found: ${label}`);
      case 'EACCES':
      case 'EPERM':
        return HttpError.forbidden(`Permission denied: ${label}`);
      case 'ENOSPC':
        return HttpError.internal('The disk is full');
      default:
        return error;
    }
  }

  /** The parent of a root-relative path; `''` for the root's children. */
  static parentOf(relative: string): string {
    const index = relative.lastIndexOf('/');
    return index === -1 ? '' : relative.slice(0, index);
  }

  /** Root-relative form of a host path known to be inside `base`. */
  static relativeTo(base: ResolvedPath, absolute: string): string {
    const rest = relativePath(base.absolute, absolute).split(sep).join('/');
    return base.relative === '' ? rest : `${base.relative}/${rest}`;
  }
}
