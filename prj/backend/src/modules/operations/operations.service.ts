import { createReadStream, createWriteStream, type Stats } from 'node:fs';
import { chmod, lstat, mkdir, readdir, readlink, realpath, rename, rm, stat, symlink, utimes } from 'node:fs/promises';
import { basename, extname, join, posix, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { HttpError, type Logger } from '../../core/index.js';
import type { ArchiveService } from '../archive/index.js';
import { FilesService, type FilePathResolver, type ResolvedPath } from '../files/index.js';
import { OperationJob } from './operation-job.js';
import type {
  CompressOperationRequest,
  ConflictPolicy,
  ExtractOperationRequest,
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
    /** Compress and extract (PRD 003, §6); without it, both are refused. */
    private readonly archives: ArchiveService | null = null,
  ) {}

  /** What a client needs to word its dialogs: whose trash things go to, and whether they can come back. */
  get info(): OperationsInfoDto {
    return { trash: this.trashProvider.kind, canRestore: this.canRestore };
  }

  private get canRestore(): boolean {
    return typeof this.trashProvider.restore === 'function' && typeof this.trashProvider.originOf === 'function';
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
      case 'delete':
        return this.startDelete(request.paths);
      case 'restore':
        return this.startRestore(request.ids);
      case 'compress':
        return this.startCompress(request);
      case 'extract':
        return this.startExtract(request);
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
      if (this.resolver.isRoot(source.relative)) {
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
    const what = count === 1 ? `'${posix.basename(request.sources[0] as string)}'` : `${count} items`;
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
      if (this.resolver.isRoot(target.relative)) {
        throw HttpError.badRequest('The root folder itself cannot be moved to the trash');
      }
      if (this.trashProvider.contains(target.absolute)) {
        throw HttpError.badRequest('That is already in the trash; empty the trash to delete it');
      }
      await OperationsService.statOrFail(target, lstat);
      targets.push(target);
    }
    const what = paths.length === 1 ? `'${posix.basename(paths[0] as string)}'` : `${paths.length} items`;
    const job = new OperationJob('trash', `Moving ${what} to the trash`);
    for (const target of targets) {
      job.affected.add(OperationsService.parentOf(target.relative));
    }
    job.totalItems = targets.length;
    return this.launch(job, async (running) => {
      for (const target of targets) {
        running.signal.throwIfAborted();
        running.current = target.relative;
        const id = await this.trashProvider.trash(target.absolute, target.relative);
        if (id !== null) {
          running.outcome.push({ source: target.relative, target: id });
        }
        running.doneItems += 1;
      }
    });
  }

  /**
   * Deletes entries for good (PRD 003, §5), refused up front as trashing is:
   * not the root, nothing in the trash — emptying it is how that goes — and
   * nothing that is not there. A link is removed as itself, never followed.
   */
  private async startDelete(paths: readonly string[]): Promise<OperationJobDto> {
    OperationsService.checkSources(paths);
    const targets: ResolvedPath[] = [];
    for (const path of paths) {
      const target = await this.resolveEntry(path);
      if (this.resolver.isRoot(target.relative)) {
        throw HttpError.badRequest('The root folder itself cannot be deleted');
      }
      if (this.trashProvider.contains(target.absolute)) {
        throw HttpError.badRequest('That is in the trash; empty the trash to delete it');
      }
      await OperationsService.statOrFail(target, lstat);
      targets.push(target);
    }
    const what = paths.length === 1 ? `'${posix.basename(paths[0] as string)}'` : `${paths.length} items`;
    const job = new OperationJob('delete', `Deleting ${what} permanently`);
    for (const target of targets) {
      job.affected.add(OperationsService.parentOf(target.relative));
    }
    job.totalItems = targets.length;
    return this.launch(job, async (running) => {
      for (const target of targets) {
        running.signal.throwIfAborted();
        running.current = target.relative;
        await rm(target.absolute, { recursive: true, force: false });
        running.doneItems += 1;
      }
    });
  }

  /**
   * Puts trashed entries back where they came from (PRD 003, §5), by the ids
   * a trash job's `outcome` handed out. A folder that has gone since is made
   * again; a name that is taken keeps both, as a copy's `rename` does. Only a
   * trash that can (`info.canRestore`) — a system trash is the user's own
   * file manager's to restore from.
   */
  private async startRestore(ids: readonly string[]): Promise<OperationJobDto> {
    const trash = this.trashProvider;
    if (trash.originOf === undefined || trash.restore === undefined) {
      throw HttpError.badRequest('This trash cannot put things back; restore them from the system trash');
    }
    OperationsService.checkSources(ids);
    const planned: { id: string; origin: ResolvedPath }[] = [];
    for (const id of ids) {
      const recorded = await trash.originOf(id);
      if (recorded === null) {
        throw HttpError.notFound(`Nothing in the trash with id ${id}`);
      }
      const origin = this.resolver.resolve(recorded);
      if (this.resolver.isRoot(origin.relative)) {
        throw HttpError.badRequest(`The trash record of ${id} names the root folder`);
      }
      planned.push({ id, origin });
    }

    const what = planned.length === 1 ? `'${posix.basename(planned[0]?.origin.relative ?? '')}'` : `${planned.length} items`;
    const job = new OperationJob('restore', `Restoring ${what} from the trash`);
    for (const entry of planned) {
      job.affected.add(OperationsService.parentOf(entry.origin.relative));
    }
    job.totalItems = planned.length;
    const restore = trash.restore.bind(trash);
    return this.launch(job, async (running) => {
      const taken = new Set<string>();
      for (const { id, origin } of planned) {
        running.signal.throwIfAborted();
        running.current = origin.relative;
        const folder = await this.ensureFolder(OperationsService.parentOf(origin.relative));
        let target = this.child(folder, basename(origin.absolute));
        if (taken.has(target.absolute) || (await OperationsService.exists(target.absolute))) {
          target = this.child(folder, await this.freeName(folder, basename(origin.absolute), taken));
        }
        taken.add(target.absolute);
        await restore(id, target.absolute);
        running.outcome.push({ source: id, target: target.relative });
        running.doneItems += 1;
      }
    });
  }

  /* -- archives (PRD 003, §6) ------------------------------------------------------ */

  /**
   * A zip of the sources, as `destination/name`. The sources and the name
   * are checked up front; the zip is written beside its final name and
   * renamed into place when complete (`ArchiveService.compress`).
   */
  private async startCompress(request: CompressOperationRequest): Promise<OperationJobDto> {
    const archives = this.archivesOrFail();
    OperationsService.checkSources(request.sources);
    const zip = await archives.zipSources(request.sources);
    const destination = await this.folder(request.destination);
    let name = FilesService.safeFilename(request.name);
    let target = this.child(destination, name);
    let overwrite = false;
    if (await OperationsService.exists(target.absolute)) {
      switch (request.conflict) {
        case 'fail':
          throw HttpError.conflict(`'${name}' already exists in ${destination.relative || '/'}`, { conflicts: [name] });
        case 'skip': {
          const skipped = new OperationJob('compress', `Compressing to ${name}`);
          skipped.skipped = 1;
          return this.launch(skipped, async () => undefined);
        }
        case 'overwrite':
          if ((await lstat(target.absolute)).isDirectory()) {
            throw HttpError.conflict(`'${name}' is a folder in ${destination.relative || '/'}`, { conflicts: [name] });
          }
          overwrite = true;
          break;
        case 'rename':
          name = await this.freeName(destination, name, new Set());
          target = this.child(destination, name);
          break;
      }
    }
    for (const source of zip.sources) {
      if (target.absolute === source.path.absolute || target.absolute.startsWith(source.path.absolute + sep)) {
        throw HttpError.badRequest(`'${name}' cannot be written into what it zips`);
      }
    }

    const count = zip.sources.length;
    const what = count === 1 ? `'${posix.basename(request.sources[0] as string)}'` : `${count} items`;
    const job = new OperationJob('compress', `Compressing ${what} to ${name}`);
    job.affected.add(destination.relative);
    return this.launch(job, async (running) => {
      await this.measure(
        running,
        zip.sources.map(({ path, stats }) => ({ source: path, target: path, stats, clash: 'none' as const })),
      );
      running.doneItems = 0;
      await archives.compress(zip, target, {
        overwrite,
        signal: running.signal,
        onBytes: (bytes) => {
          running.doneBytes += bytes;
        },
        onEntry: (relative) => {
          running.current = relative;
          running.doneItems += 1;
        },
      });
      running.outcome.push({ source: zip.sources[0]?.path.relative ?? '', target: target.relative });
    });
  }

  /**
   * A zip, extracted into `destination`: its one top entry straight in, or
   * all of it into a folder named after it. What it makes at the top is
   * checked against what is there up front, as a copy's names are.
   */
  private async startExtract(request: ExtractOperationRequest): Promise<OperationJobDto> {
    const archives = this.archivesOrFail();
    const plan = await archives.planExtract(request.path, request.destination);
    if (plan.tops.length === 0) {
      throw HttpError.badRequest(`'${posix.basename(plan.archive.relative)}' is empty`);
    }
    if (this.trashProvider.contains(plan.destination.absolute)) {
      throw HttpError.badRequest('Nothing can be extracted into the trash');
    }
    const top = plan.tops[0] as string;
    let name = top;
    let overwrite = false;
    if (await OperationsService.exists(this.child(plan.destination, top).absolute)) {
      switch (request.conflict) {
        case 'fail':
          throw HttpError.conflict(`'${top}' already exists in ${plan.destination.relative || '/'}`, { conflicts: [top] });
        case 'skip': {
          const skipped = new OperationJob('extract', `Extracting ${posix.basename(plan.archive.relative)}`);
          skipped.skipped = 1;
          return this.launch(skipped, async () => undefined);
        }
        case 'overwrite':
          overwrite = true;
          break;
        case 'rename':
          name = await this.freeName(plan.destination, top, new Set());
          break;
      }
    }
    const made = this.child(plan.destination, name);
    const archiveReal = await realpath(plan.archive.absolute);
    if (overwrite && (archiveReal === made.absolute || archiveReal.startsWith(made.absolute + sep))) {
      throw HttpError.badRequest(`'${name}' holds the archive itself, so it cannot be replaced`);
    }

    const job = new OperationJob(
      'extract',
      `Extracting ${posix.basename(plan.archive.relative)} to /${plan.destination.relative}`,
    );
    job.affected.add(plan.destination.relative);
    job.totalBytes = plan.totalBytes;
    job.totalItems = plan.totalItems;
    return this.launch(job, async (running) => {
      if (overwrite) {
        await rm(made.absolute, { recursive: true, force: true });
      }
      let into = plan.destination.absolute;
      if (plan.wrapper !== null) {
        await mkdir(made.absolute);
        into = made.absolute;
      }
      await archives.extract(plan, into, {
        signal: running.signal,
        onBytes: (bytes) => {
          running.doneBytes += bytes;
        },
        onItem: (relative) => {
          running.current = relative;
          running.doneItems += 1;
        },
        onSkip: () => {
          running.skipped += 1;
        },
        ...(plan.wrapper === null && name !== top ? { topName: (entry: string) => (entry === top ? name : entry) } : {}),
      });
      running.outcome.push({ source: plan.archive.relative, target: made.relative });
    });
  }

  private archivesOrFail(): ArchiveService {
    if (this.archives === null) {
      throw HttpError.badRequest('Archives are not supported here');
    }
    return this.archives;
  }

  /** A folder in the root, to put something into. */
  private async folder(path: string): Promise<ResolvedPath> {
    const folder = await this.resolver.resolveReal(path);
    if (!(await OperationsService.statOrFail(folder, stat)).isDirectory()) {
      throw HttpError.badRequest(`Not a folder: ${folder.relative || '/'}`);
    }
    if (this.trashProvider.contains(folder.absolute)) {
      throw HttpError.badRequest('Nothing can be put into the trash this way');
    }
    return folder;
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
      job.outcome.push({ source: entry.source.relative, target: entry.target.relative });
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
      job.outcome.push({ source: entry.source.relative, target: entry.target.relative });
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

  /**
   * An entry taken as itself: its folder proven inside the root, through
   * links too, but the entry not followed — deleting a link removes the link.
   */
  private async resolveEntry(path: string): Promise<ResolvedPath> {
    const lexical = this.resolver.resolve(path);
    if (lexical.relative === '') {
      return lexical;
    }
    const folder = await this.resolver.resolveReal(OperationsService.parentOf(lexical.relative));
    return this.child(folder, basename(lexical.absolute));
  }

  /**
   * The folder `relative`, made — with any folders above it — if it has gone.
   * The deepest folder that still exists is proven inside the root first, so
   * a link on the way cannot make folders somewhere else.
   */
  private async ensureFolder(relative: string): Promise<ResolvedPath> {
    let existing = relative;
    while (existing !== '' && !(await OperationsService.exists(this.resolver.resolve(existing).absolute))) {
      existing = OperationsService.parentOf(existing);
    }
    const anchor = await this.resolver.resolveReal(existing);
    if (!(await OperationsService.statOrFail(anchor, stat)).isDirectory()) {
      throw HttpError.badRequest(`Not a folder: ${anchor.relative || '/'}`);
    }
    if (existing !== relative) {
      await mkdir(this.resolver.resolve(relative).absolute, { recursive: true });
    }
    return this.resolver.resolveReal(relative);
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
