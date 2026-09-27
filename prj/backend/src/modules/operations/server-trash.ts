import { randomBytes } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join, sep } from 'node:path';

import type { TrashItemDto, TrashProvider } from './operation.model.js';

/** The trash, inside the files root; hidden, as a dot folder is. */
export const SERVER_TRASH_DIR = '.tr-file-trash';

/**
 * The server's own trash (PRD 005, §1): a hidden folder in the files root,
 * laid out the way the freedesktop.org trash is — the entries under `files/`,
 * and next to each, under `info/`, where it came from and when — so nothing a
 * user throws away ever leaves the root, and each item can be put back: an
 * entry's id is its name under `files/`, and `restore` moves it wherever
 * `OperationsService` says, then drops its record.
 */
export class ServerTrash implements TrashProvider {
  readonly kind = 'server' as const;
  /** Hidden from every listing, so emptying it changes none. */
  readonly affected: readonly string[] = [];

  private readonly dir: string;
  private readonly files: string;
  private readonly info: string;

  constructor(root: string) {
    this.dir = join(root, SERVER_TRASH_DIR);
    this.files = join(this.dir, 'files');
    this.info = join(this.dir, 'info');
  }

  contains(absolute: string): boolean {
    return absolute === this.dir || absolute.startsWith(this.dir + sep);
  }

  async trash(absolute: string, relative: string): Promise<string> {
    await mkdir(this.files, { recursive: true });
    await mkdir(this.info, { recursive: true });
    const name = `${basename(absolute)}.${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
    const target = join(this.files, name);
    try {
      await rename(absolute, target);
    } catch (error) {
      // The root may span file systems: then it is a copy and a removal.
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw error;
      }
      await cp(absolute, target, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true });
      await rm(absolute, { recursive: true, force: true });
    }
    await writeFile(
      join(this.info, `${name}.json`),
      JSON.stringify({ path: relative, deletedAt: new Date().toISOString() }),
    );
    return name;
  }

  async originOf(id: string): Promise<string | null> {
    // An id is one name under `files/`, never a path: it comes from a client.
    if (id === '' || id === '.' || id === '..' || /[/\\\0]/.test(id) || id.includes(sep)) {
      return null;
    }
    try {
      await lstat(join(this.files, id));
      const record = JSON.parse(await readFile(join(this.info, `${id}.json`), 'utf8')) as { path?: unknown };
      return typeof record.path === 'string' && record.path !== '' ? record.path : null;
    } catch {
      return null;
    }
  }

  async restore(id: string, absolute: string): Promise<void> {
    const source = join(this.files, id);
    try {
      await rename(source, absolute);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw error;
      }
      await cp(source, absolute, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true, errorOnExist: true, force: false });
      await rm(source, { recursive: true, force: true });
    }
    await rm(join(this.info, `${id}.json`), { force: true });
  }

  /** Everything under `files/`, with where it came from and when, as its record says. */
  async list(): Promise<readonly TrashItemDto[]> {
    let names: string[];
    try {
      names = await readdir(this.files);
    } catch {
      return []; // Nothing was ever thrown away.
    }
    const items = await Promise.all(
      names.map(async (id): Promise<TrashItemDto | null> => {
        try {
          const stats = await lstat(join(this.files, id));
          const record = await readFile(join(this.info, `${id}.json`), 'utf8')
            .then((text) => JSON.parse(text) as { path?: unknown; deletedAt?: unknown })
            .catch(() => ({}) as { path?: unknown; deletedAt?: unknown });
          const location = typeof record.path === 'string' && record.path !== '' ? record.path : null;
          return {
            id,
            name: location === null ? ServerTrash.nameOf(id) : basename(location),
            location,
            deletedAt: typeof record.deletedAt === 'string' ? record.deletedAt : null,
            type: stats.isDirectory() ? 'directory' : stats.isSymbolicLink() ? 'symlink' : stats.isFile() ? 'file' : 'other',
            size: stats.isFile() ? stats.size : 0,
          };
        } catch {
          return null; // Gone while it was being listed.
        }
      }),
    );
    return items
      .filter((item): item is TrashItemDto => item !== null)
      .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
  }

  /** An id is `<name>.<stamp>`: the name, when no record says it. */
  private static nameOf(id: string): string {
    const dot = id.lastIndexOf('.');
    return dot > 0 ? id.slice(0, dot) : id;
  }

  async empty(progress: (done: number, total: number | null) => void, signal: AbortSignal): Promise<void> {
    let names: string[];
    try {
      names = await readdir(this.files);
    } catch {
      progress(0, 0);
      return; // Nothing was ever thrown away.
    }
    progress(0, names.length);
    let done = 0;
    for (const name of names) {
      signal.throwIfAborted();
      await rm(join(this.files, name), { recursive: true, force: true });
      await rm(join(this.info, `${name}.json`), { force: true });
      done += 1;
      progress(done, names.length);
    }
  }
}
