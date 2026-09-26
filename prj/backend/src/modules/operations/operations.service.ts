import { createReadStream, createWriteStream, type Stats } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readlink, realpath, rename, rm, stat, symlink, utimes } from 'node:fs/promises';
import { basename, extname, join, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { HttpError, type Logger } from '../../core/index.js';
import type { FilePathResolver, ResolvedPath } from '../files/index.js';
import { OperationJob } from './operation-job.js';
import type {
  ConflictPolicy,
  OperationJobDto,
  OperationRequest,
  OperationsInfoDto,
  TransferOperationRequest,
  TrashProvider,
} from './operation.model.js';

/** Finished jobs are kept this long, so a client that polls late still learns how it ended. */
const KEEP_FINISHED_MS = 10 * 60 * 1000;

/** More sources than this in one request is a mistake, not a selection. */
const MAX_SOURCES = 10_000;

/** One source of a copy or move, checked and paired with where it goes. */
interface PlannedEntry {
  readonly source: ResolvedPath;
  readonly target: ResolvedPath;
  readonly stats: Stats;
  /** What to do about what is already at `target`. */
  readonly clash: 'none' | 'overwrite' | 'skip';
}

/**
 * File operations (PRD 005, §1), as background jobs.
 *
 * `start` checks everything that can be checked before touching a file —
 * every path inside the root, the destination a folder, no folder into
 * itself, and, unless told what to do, no name that is taken (`409`, naming
 * each) — then answers at once with the job, which runs on. A client asks
 * for the job again to see how far it has got (`status`), and `cancel` stops
 * it between two chunks of a file: what was fully copied stays, the file
 * being copied is removed.
 *
 * Copies are made entry by entry, a stream per file, so progress is in bytes;
 * symlinks are copied as links, never followed. A move is a `rename` when it
 * can be and a copy-then-delete across file systems. Trash goes wherever the
 * `TrashProvider` puts it.
 */
export class OperationsService {
  private readonly jobs = new Map<string, OperationJob>();

  constructor(
    private readonly resolver: FilePathResolver,
    private readonly trashProvider: TrashProvider,
    private readonly logger: Logger,
  ) {}

  /** What a client needs to word its dialogs: whose trash things go to. */
  get info(): OperationsInfoDto {
    return { trash: this.trashProvider.kind };
  }

  /** Checks a request and starts its job. Throws `HttpError` for anything refused up front. */
  async start(request: OperationRequest): Promise<OperationJobDto> {
    this.prune();
    switch (request.kind) {
      case 'copy':
      case 'move':
        return this.startTransfer(request);
      case 'trash':
        return this.startTrash(request.paths);
      case 'empty-trash':
        return this.launch(new OperationJob('empty-trash', 'Emptying the trash'), (job) => this.emptyTrash(job));
    }
  }

  status(id: string): OperationJobDto {
    return this.job(id).toJSON();
  }

  /** Stops a job; a job that has already finished is left as it ended. */
  cancel(id: string): OperationJobDto {
    const job = this.job(id);
    job.controller.abort();
    return job.toJSON();
  }

  /* -- starting -------------------------------------------------------------- */

  private async startTransfer(request: TransferOperationRequest): Promise<OperationJobDto> {
    OperationsService.checkSources(request.sources);
    const destination = await this.resolver.resolveReal(request.destination);
    const destinationStats = await OperationsService.statOrFail(destination, stat);
    if (!destinationStats.isDirectory()) {
      throw HttpError.badRequest(`Not a folder: ${destination.relative || '/'}`);
    }
    if (this.trashProvider.contains(destination.absolute)) {
      throw HttpError.badRequest('Nothing can be copied or moved into the trash; move it to the trash instead');
    }
    const destinationReal = await realpath(destination.absolute);

    const plan: PlannedEntry[] = [];
    const conflicts: string[] = [];
    const taken = new Set<string>();
    for (const path of request.sources) {
      const source = await this.resolver.resolveReal(path);
      if (source.relative === '') {
        throw HttpError.badRequest('The root folder itself cannot be copied or moved');
      }
      if (this.trashProvider.contains(source.absolute)) {
        throw HttpError.badRequest('The trash cannot be copied or moved');
      }
      const stats = await OperationsService.statOrFail(source, lstat);
      if (stats.isDirectory()) {
        const sourceReal = await realpath(source.absolute);
        if (destinationReal === sourceReal || destinationReal.startsWith(sourceReal + sep)) {
          throw HttpError.badRequest(`A folder cannot go into itself: ${source.relative}`);
        }
      }

      let name = basename(source.absolute);
      let target = this.child(destination, name);
      const same = target.absolute === source.absolute;
      const exists = same || (await OperationsService.exists(target.absolute)) || taken.has(target.absolute);
      let clash: PlannedEntry['clash'] = 'none';

      if (same && request.kind === 'move') {
        continue; // Moved to where it already is: nothing to do.
      }
      if (exists) {
        const policy: ConflictPolicy = same && request.conflict !== 'skip' ? 'rename' : request.conflict;
        switch (policy) {
          case 'fail':
            conflicts.push(name);
            break;
          case 'skip':
            clash = 'skip';
            break;
          case 'overwrite':
            clash = 'overwrite';
            break;
          case 'rename':
            name = await this.freeName(destination, name, taken);
            target = this.child(destination, name);
            break;
        }
      }
      taken.add(target.absolute);
      plan.push({ source, target, stats, clash });
    }

    if (conflicts.length > 0) {
      throw HttpError.conflict(
        conflicts.length === 1
          ? `'${conflicts[0]}' already exists in ${destination.relative || '/'}`
          : `${conflicts.length} items already exist in ${destination.relative || '/'}`,
        { conflicts },
      );
    }

    const count = request.sources.length;
    const what = count === 1 ? `'${basename(request.sources[0] as string)}'` : `${count} items`;
    const job = new OperationJob(
      request.kind,
      `${request.kind === 'copy' ? 'Copying' : 'Moving'} ${what} to /${destination.relative}`,
    );
    job.affected.add(destination.relative);
    if (request.kind === 'move') {
      for (const entry of plan) {
        job.affected.add(OperationsService.parentOf(entry.source.relative));
      }
    }
    return this.launch(job, (running) =>
      request.kind === 'copy' ? this.copyAll(running, plan) : this.moveAll(running, plan),
    );
  }

  private async startTrash(paths: readonly string[]): Promise<OperationJobDto> {
    OperationsService.checkSources(paths);
    const targets: ResolvedPath[] = [];
    for (const path of paths) {
      const target = await this.resolver.resolveReal(path);
      if (target.relative === '') {
        throw HttpError.badRequest('The root folder itself cannot be moved to the trash');
      }
      if (this.trashProvider.contains(target.absolute)) {
        throw HttpError.badRequest('That is already in the trash; empty the trash to delete it');
      }
      await OperationsService.statOrFail(target, lstat);
      targets.push(target);
    }
    const what = paths.length === 1 ? `'${basename(paths[0] as string)}'` : `${paths.length} items`;
    const job = new OperationJob('trash', `Moving ${what} to the trash`);
    for (const target of targets) {
      job.affected.add(OperationsService.parentOf(target.relative));
    }
    job.totalItems = targets.length;
    return this.launch(job, async (running) => {
      for (const target of targets) {
        running.signal.throwIfAborted();
        running.current = target.relative;
        await this.trashProvider.trash(target.absolute, target.relative);
        running.doneItems += 1;
      }
    });
  }

  /** Registers a job, runs it without waiting, and answers with its first snapshot. */
  private launch(job: OperationJob, run: (job: OperationJob) => Promise<void>): OperationJobDto {
    this.jobs.set(job.id, job);
    void run(job).then(
      () => job.finish(job.signal.aborted ? 'cancelled' : 'done'),
      (error: unknown) => {
        if (job.signal.aborted) {
          job.finish('cancelled');
          return;
        }
        const failure = OperationsService.describe(error);
        this.logger.warn('operation failed', { kind: job.kind, job: job.id, ...failure });
        job.finish('failed', failure);
      },
    );
    return job.toJSON();
  }

  /* -- copying and moving ---------------------------------------------------------- */

  private async copyAll(job: OperationJob, plan: readonly PlannedEntry[]): Promise<void> {
    await this.measure(job, plan);
    for (const entry of plan) {
      if (entry.clash === 'skip') {
        job.skipped += 1;
        continue;
      }
      if (entry.clash === 'overwrite') {
        await rm(entry.target.absolute, { recursive: true, force: true });
      }
      await this.copyEntry(job, entry.source.absolute, entry.target.absolute, entry.source.relative);
    }
  }

  private async moveAll(job: OperationJob, plan: readonly PlannedEntry[]): Promise<void> {
    job.totalItems = plan.length;
    for (const entry of plan) {
      job.signal.throwIfAborted();
      job.current = entry.source.relative;
      if (entry.clash === 'skip') {
        job.skipped += 1;
        job.doneItems += 1;
        continue;
      }
      if (entry.clash === 'overwrite') {
        await rm(entry.target.absolute, { recursive: true, force: true });
      }
      try {
        await rename(entry.source.absolute, entry.target.absolute);
        job.doneItems += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
          throw error;
        }
        // Another file system: copy it, byte-counted, then take the original away.
        job.totalItems = null;
        await this.measure(job, [entry]);
        await this.copyEntry(job, entry.source.absolute, entry.target.absolute, entry.source.relative);
        await rm(entry.source.absolute, { recursive: true, force: true });
      }
    }
  }

  /** Counts what a copy will write, so its progress can be a fraction. */
  private async measure(job: OperationJob, plan: readonly PlannedEntry[]): Promise<void> {
    let bytes = job.totalBytes ?? 0;
    let items = job.totalItems ?? 0;
    const walk = async (absolute: string, stats: Stats): Promise<void> => {
      job.signal.throwIfAborted();
      items += 1;
      if (stats.isFile()) {
        bytes += stats.size;
      } else if (stats.isDirectory()) {
        for (const name of await readdir(absolute)) {
          const child = join(absolute, name);
          await walk(child, await lstat(child));
        }
      }
    };
    for (const entry of plan) {
      if (entry.clash !== 'skip') {
        await walk(entry.source.absolute, entry.stats);
      }
    }
    job.totalBytes = bytes;
    job.totalItems = items;
  }

  /** Copies one entry — a file, a folder and everything in it, or a link as a link. */
  private async copyEntry(job: OperationJob, source: string, target: string, relative: string): Promise<void> {
    job.signal.throwIfAborted();
    job.current = relative;
    const stats = await lstat(source);

    if (stats.isDirectory()) {
      await mkdir(target);
      for (const name of await readdir(source)) {
        await this.copyEntry(job, join(source, name), join(target, name), `${relative}/${name}`);
      }
    } else if (stats.isSymbolicLink()) {
      await symlink(await readlink(source), target);
    } else if (stats.isFile()) {
      await this.copyFile(job, source, target);
    } else {
      job.skipped += 1; // A socket, a device: nothing a copy should reproduce.
    }

    job.doneItems += 1;
    if (!stats.isSymbolicLink()) {
      // Best effort: the copy is what matters, its dates and mode are courtesy.
      await chmod(target, stats.mode & 0o7777).catch(() => undefined);
      await utimes(target, stats.atime, stats.mtime).catch(() => undefined);
    }
  }

  private async copyFile(job: OperationJob, source: string, target: string): Promise<void> {
    const count = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        job.doneBytes += chunk.length;
        done(null, chunk);
      },
    });
    try {
      await pipeline(createReadStream(source), count, createWriteStream(target, { flags: 'wx' }), {
        signal: job.signal,
      });
    } catch (error) {
      await rm(target, { force: true }); // Never a half-written copy.
      throw error;
    }
  }

  private async emptyTrash(job: OperationJob): Promise<void> {
    for (const path of this.trashProvider.affected) {
      job.affected.add(path);
    }
    await this.trashProvider.empty((done, total) => {
      job.doneItems = done;
      job.totalItems = total;
    }, job.signal);
  }

  /* -- helpers ------------------------------------------------------------------------ */

  private job(id: string): OperationJob {
    const job = this.jobs.get(id);
    if (job === undefined) {
      throw HttpError.notFound(`No operation with id ${id}`);
    }
    return job;
  }

  private child(parent: ResolvedPath, name: string): ResolvedPath {
    return this.resolver.resolve(parent.relative === '' ? name : `${parent.relative}/${name}`);
  }

  /** `name copy.ext`, then `name copy 2.ext`, … — the first that is free. */
  private async freeName(parent: ResolvedPath, name: string, taken: ReadonlySet<string>): Promise<string> {
    const extension = name.startsWith('.') && name.indexOf('.', 1) === -1 ? '' : extname(name);
    const stem = extension === '' ? name : name.slice(0, -extension.length);
    for (let attempt = 1; ; attempt += 1) {
      const candidate = `${stem} copy${attempt === 1 ? '' : ` ${attempt}`}${extension}`;
      const absolute = this.child(parent, candidate).absolute;
      if (!taken.has(absolute) && !(await OperationsService.exists(absolute))) {
        return candidate;
      }
    }
  }

  private prune(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.finishedAt !== null && now - job.finishedAt.getTime() > KEEP_FINISHED_MS) {
        this.jobs.delete(id);
      }
    }
  }

  private static checkSources(paths: readonly string[]): void {
    if (paths.length === 0) {
      throw HttpError.badRequest('Nothing to do: no paths were given');
    }
    if (paths.length > MAX_SOURCES) {
      throw HttpError.badRequest(`At most ${MAX_SOURCES} paths at once`);
    }
  }

  private static parentOf(relative: string): string {
    return relative.includes('/') ? relative.slice(0, relative.lastIndexOf('/')) : '';
  }

  private static async exists(absolute: string): Promise<boolean> {
    try {
      await lstat(absolute);
      return true;
    } catch {
      return false;
    }
  }

  private static async statOrFail(target: ResolvedPath, read: typeof stat): Promise<Stats> {
    try {
      return await read(target.absolute);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        throw HttpError.notFound(`Path not found: ${target.relative || '/'}`);
      }
      if (code === 'EACCES' || code === 'EPERM') {
        throw HttpError.forbidden(`Permission denied: ${target.relative || '/'}`);
      }
      throw error;
    }
  }

  /** A failure, as a job reports it. */
  private static describe(error: unknown): { code: string; message: string } {
    if (error instanceof HttpError) {
      return { code: error.code, message: error.message };
    }
    const errno = error as NodeJS.ErrnoException;
    switch (errno.code) {
      case 'EACCES':
      case 'EPERM':
        return { code: 'FORBIDDEN', message: `Permission denied${errno.path ? `: ${basename(errno.path)}` : ''}` };
      case 'ENOSPC':
        return { code: 'NO_SPACE', message: 'The disk is full' };
      case 'EEXIST':
        return { code: 'CONFLICT', message: `Already exists${errno.path ? `: ${basename(errno.path)}` : ''}` };
      case 'ENOENT':
        return { code: 'NOT_FOUND', message: 'An entry disappeared while it was being worked on' };
      default:
        return { code: 'INTERNAL_ERROR', message: error instanceof Error ? error.message : String(error) };
    }
  }
}
