import { execFile } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

import type { TrashProvider } from '@tr-file/backend/operations';

const run = promisify(execFile);

/** What `ShellTrash` needs from its surroundings; the defaults are the real machine. */
export interface ShellTrashOptions {
  /** Electron's `shell.trashItem` — injected, so nothing here imports `electron`. */
  readonly trashItem: (absolute: string) => Promise<void>;
  readonly platform?: NodeJS.Platform;
  readonly home?: string;
  /** Runs a system command; for macOS's Finder and Windows' Recycle Bin. */
  readonly exec?: (file: string, args: readonly string[], signal: AbortSignal) => Promise<void>;
}

/**
 * The system trash (PRD 005, §1), for the desktop on its own machine: what
 * the user throws away lands where their file manager's trash shows it, and
 * can be put back from there.
 *
 * Trashing is Electron's `shell.trashItem` on every platform. It says nothing
 * about where the entry went, so there is no id to restore it by: `trash`
 * answers `null` and this provider has no `restore` (`canRestore` is false) —
 * putting things back is the system file manager's job. Emptying has no
 * Electron call, so it is the platform's own way: on Linux the freedesktop.org
 * home trash is cleared entry by entry, which can be counted; on macOS Finder
 * empties it, and on Windows `Clear-RecycleBin` does — neither says how far
 * it has got, so the job reports no total there.
 */
export class ShellTrash implements TrashProvider {
  readonly kind = 'system' as const;
  readonly affected: readonly string[];

  private readonly platform: NodeJS.Platform;
  private readonly trashDir: string | null;
  private readonly exec: NonNullable<ShellTrashOptions['exec']>;

  constructor(
    root: string,
    private readonly options: ShellTrashOptions,
  ) {
    this.platform = options.platform ?? process.platform;
    const home = options.home ?? homedir();
    this.trashDir =
      this.platform === 'linux'
        ? join(process.env['XDG_DATA_HOME'] || join(home, '.local', 'share'), 'Trash')
        : this.platform === 'darwin'
          ? join(home, '.Trash')
          : null;
    this.exec =
      options.exec ??
      (async (file, args, signal) => {
        await run(file, [...args], { signal, windowsHide: true });
      });

    // A root that holds the trash — a home folder, say — lists it: emptying changes that listing.
    const inside = this.trashDir === null ? null : relative(root, this.trashDir);
    this.affected =
      inside !== null && inside !== '' && !inside.startsWith('..') && !inside.startsWith(sep)
        ? [inside.split(sep).join('/')]
        : [];
  }

  contains(absolute: string): boolean {
    return this.trashDir !== null && (absolute === this.trashDir || absolute.startsWith(this.trashDir + sep));
  }

  async trash(absolute: string): Promise<null> {
    await this.options.trashItem(absolute);
    return null;
  }

  async empty(progress: (done: number, total: number | null) => void, signal: AbortSignal): Promise<void> {
    switch (this.platform) {
      case 'linux':
        return this.emptyFreedesktop(progress, signal);
      case 'darwin':
        progress(0, null);
        await this.exec('osascript', ['-e', 'tell application "Finder" to empty trash'], signal);
        return;
      case 'win32':
        progress(0, null);
        await this.exec(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', 'Clear-RecycleBin -Force -ErrorAction Stop'],
          signal,
        );
        return;
      default:
        throw new Error(`Emptying the trash is not supported on ${this.platform}`);
    }
  }

  /** `files/` holds the entries, `info/` a `.trashinfo` for each; both go. */
  private async emptyFreedesktop(
    progress: (done: number, total: number | null) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const dir = this.trashDir as string;
    const files = join(dir, 'files');
    const info = join(dir, 'info');
    const names = await readdir(files).catch(() => [] as string[]);
    progress(0, names.length);
    let done = 0;
    for (const name of names) {
      signal.throwIfAborted();
      await rm(join(files, name), { recursive: true, force: true });
      await rm(join(info, `${name}.trashinfo`), { force: true });
      done += 1;
      progress(done, names.length);
    }
    // Stray records whose entry is already gone, and the size cache, which is now wrong.
    for (const name of await readdir(info).catch(() => [] as string[])) {
      await rm(join(info, name), { force: true });
    }
    await rm(join(dir, 'directorysizes'), { force: true });
  }
}
