import { spawn } from 'node:child_process';
import { appendFileSync, statSync, truncateSync } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/**
 * Where the distributables are published (PRD 001, §8.6): a folder on the
 * office share, one per platform. `TR_FILE_UPDATE_DIR` names another, and
 * `off` turns updating off.
 */
export const DEFAULT_UPDATE_DIRS: Readonly<Partial<Record<NodeJS.Platform, string>>> = {
  win32: 'S:\\Library\\Software\\Applications\\Tronog\\TR-File',
  linux: '/S/Library/Software/Applications/Tronog/TR-File',
};

/**
 * What a copy of the app is, which decides which file on the share updates it
 * and how:
 *
 * - `appimage` — a Linux AppImage; `path` is the `.AppImage` file itself.
 * - `portable` — the Windows single `.exe` (§8.3); `path` is that `.exe`.
 * - `installed` — installed by the Windows setup (§8.4); updated by running a
 *   newer setup, which replaces the installation in place.
 */
export type InstallationKind = 'appimage' | 'portable' | 'installed';

export interface Installation {
  readonly kind: InstallationKind;
  /** The file that *is* the app, for `appimage` and `portable`. */
  readonly path?: string;
  /** `app.getVersion()`: the one hint there is before anything was recorded. */
  readonly version: string;
}

/**
 * What says a file is a new version (§8.6): its size and modified time — not
 * its name, which may stay the same from one version to the next, and not a
 * version inside it, which would mean opening a 100 MB file on a share every
 * few minutes. The name is kept only to say what is offered.
 */
export interface UpdateFileKey {
  readonly name: string;
  readonly size: number;
  readonly mtimeMs: number;
}

/** What `update-state.json` keeps: the key installed, and the file it was installed as. */
interface InstalledRecord extends UpdateFileKey {
  /** The AppImage or `.exe` that is that version; absent for the installed kind. */
  readonly executable?: string;
}

/** A newer distributable than the running one, found on the share. */
export interface UpdateCandidate extends UpdateFileKey {
  readonly path: string;
}

/** How the new version starts once this process has gone. */
export interface Relaunch {
  readonly command: string;
  readonly args: readonly string[];
}

export interface SelfUpdateOptions {
  /** The folder the distributables are published in. */
  readonly source: string;
  readonly installation: Installation;
  /** `update-state.json` in the user-data folder: the key of what is installed. */
  readonly stateFile: string;
  /**
   * A folder of the *local* temporary folder, where a Windows distributable
   * is copied to be run — a program on the share will not run (§8.6).
   */
  readonly tempDir: string;
  /** `process.platform`, for comparing paths; a test may say another. */
  readonly platform?: NodeJS.Platform;
  /** A file changed more recently than this is taken to be still being copied. */
  readonly settleMs?: number;
  readonly now?: () => number;
}

/** Filesystem times on a share are coarse (FAT: 2 s); a key within this is the same key. */
const MTIME_TOLERANCE_MS = 2_000;

/** A file on the share must have stood still this long to be offered. */
const DEFAULT_SETTLE_MS = 30_000;

/** Beside the AppImage being replaced, so the final rename stays on one file system. */
const PART_SUFFIX = '.update-part';

/** Where in the temporary folder a newer setup is put, to be run. */
const SETUP_DIR = 'setup';

/**
 * Which kind of copy is running, from what the packaged launchers leave in the
 * environment — or `null` where there is nothing to update: a development run,
 * macOS, an unpacked build.
 */
export function detectInstallation(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  packaged: boolean,
  version: string,
): Installation | null {
  if (!packaged) {
    return null;
  }
  if (platform === 'linux' && env['APPIMAGE']) {
    return { kind: 'appimage', path: env['APPIMAGE'], version };
  }
  if (platform === 'win32') {
    // electron-builder's portable launcher names the `.exe` it was started from.
    const portable = env['PORTABLE_EXECUTABLE_FILE'];
    return portable ? { kind: 'portable', path: portable, version } : { kind: 'installed', version };
  }
  return null;
}

/** The folder to look in, or `null` when updating is off. */
export function updateSource(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string | null {
  const configured = env['TR_FILE_UPDATE_DIR']?.trim();
  if (configured === 'off') {
    return null;
  }
  return configured || DEFAULT_UPDATE_DIRS[platform] || null;
}

/** Whether `name` is a distributable for this kind of copy. */
export function isDistributableFor(kind: InstallationKind, name: string): boolean {
  if (name.startsWith('.') || name.endsWith(PART_SUFFIX)) {
    return false;
  }
  switch (kind) {
    case 'appimage':
      return /\.appimage$/i.test(name);
    // The portable `.exe` and the setup sit side by side; each updates its own kind.
    case 'portable':
      return /\.exe$/i.test(name) && !/setup/i.test(name);
    case 'installed':
      return /\.exe$/i.test(name) && /setup/i.test(name);
  }
}

/** The same version: the same size and modified time, whatever the files are called (§8.6). */
export function sameKey(a: UpdateFileKey, b: UpdateFileKey): boolean {
  return a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) <= MTIME_TOLERANCE_MS;
}

/** Whether two paths name one file — without regard to case on Windows. */
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const [x, y] = [resolve(a), resolve(b)];
  return platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/**
 * Self-updating from a folder (PRD 001, §8.6).
 *
 * The published distributables are plain files on a share, so there is no
 * feed, no signature and no version inside to read: a file is a new version
 * when its key — size and modified time; the name may stay the same — is not
 * the key of the file this copy was installed from. That key is kept in
 * `update-state.json`, written as an upgrade is applied, with the file it was
 * installed as. Where the running file is another (a copy installed by hand,
 * or an older one started from its old shortcut), the running file stands
 * in: the same size is the same file, whatever a copy did to its time — or,
 * for the installed kind, which has no file of its own, a name carrying this
 * version.
 *
 * Applying it:
 * - **AppImage** — copied beside the running one and renamed over it (a
 *   running file may be renamed), so its path — what every shortcut points
 *   at — stays.
 * - **Windows** — a program on a network share will not run, so the new file
 *   is copied into the local temporary folder first (§8.6) and run from
 *   there: the portable `.exe` is the app from then on (its old copy is left
 *   alone), the setup installs over the installation silently.
 *
 * Either way the new version starts once this process has gone.
 *
 * Nothing here imports `electron`.
 */
export class SelfUpdate {
  private readonly settleMs: number;
  private readonly now: () => number;
  private readonly platform: NodeJS.Platform;

  constructor(private readonly options: SelfUpdateOptions) {
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    this.now = options.now ?? Date.now;
    this.platform = options.platform ?? process.platform;
  }

  get installation(): Installation {
    return this.options.installation;
  }

  /**
   * The newest distributable on the share when it is not what is running;
   * `null` when it is, or when there is none. Throws when the share cannot
   * be read.
   */
  async check(): Promise<UpdateCandidate | null> {
    const latest = await this.latest();
    if (latest === null || (await this.isCurrent(latest))) {
      return null;
    }
    return latest;
  }

  /**
   * Puts `candidate` in place and says how to start it. Throws, leaving the
   * running copy as it was, when it cannot — a folder the app may not write
   * in, a file on the share that changed meanwhile.
   */
  async apply(candidate: UpdateCandidate): Promise<Relaunch> {
    const installation = this.options.installation;
    await this.assertUnchanged(candidate);

    if (installation.kind === 'installed') {
      const setup = await this.stage(candidate, SETUP_DIR);
      await this.record(candidate);
      // What electron-updater passes too: silent, as an update, and start the app when done.
      return { command: setup, args: ['--updated', '/S', '--force-run'] };
    }

    if (installation.kind === 'portable') {
      // A folder of its own per version: the one running now is locked until it exits.
      const executable = await this.stage(candidate, `${candidate.size}-${Math.round(candidate.mtimeMs)}`);
      await this.record(candidate, executable);
      return { command: executable, args: [] };
    }

    const target = installation.path;
    if (target === undefined) {
      throw new Error('The running copy does not say where it is.');
    }
    const part = join(dirname(target), `.${basename(target)}${PART_SUFFIX}`);
    try {
      await this.copyChecked(candidate, part);
      await chmod(part, 0o755);
      await rename(part, target);
    } catch (error: unknown) {
      await rm(part, { force: true });
      throw error;
    }
    await this.record(candidate, target);
    return { command: target, args: [] };
  }

  /**
   * What earlier upgrades left behind: an AppImage copy never finished, and
   * everything in the temporary folder but the folder the app runs from.
   */
  async cleanUp(): Promise<void> {
    const running = this.options.installation.path;
    if (running !== undefined) {
      await rm(join(dirname(running), `.${basename(running)}${PART_SUFFIX}`), { force: true }).catch(() => undefined);
    }
    const names = await readdir(this.options.tempDir).catch(() => [] as string[]);
    for (const name of names) {
      const folder = join(this.options.tempDir, name);
      if (running !== undefined && samePath(dirname(running), folder, this.platform)) {
        continue;
      }
      await rm(folder, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /* -- internals ---------------------------------------------------------- */

  /** The most recently modified distributable that has stood still; `null` if none. */
  private async latest(): Promise<UpdateCandidate | null> {
    let names: string[];
    try {
      names = await readdir(this.options.source);
    } catch {
      // The share is not mounted, or not reachable from here: said by a check
      // asked for (§8.6.1); a periodic one only logs it.
      throw new Error(`The update folder ${this.options.source} could not be read.`);
    }

    let latest: UpdateCandidate | null = null;
    for (const name of names) {
      if (!isDistributableFor(this.options.installation.kind, name)) {
        continue;
      }
      const path = join(this.options.source, name);
      const info = await stat(path).catch(() => null);
      if (info === null || !info.isFile() || this.now() - info.mtimeMs < this.settleMs) {
        continue;
      }
      if (latest === null || info.mtimeMs > latest.mtimeMs) {
        latest = { name, size: info.size, mtimeMs: info.mtimeMs, path };
      }
    }
    return latest;
  }

  private async isCurrent(candidate: UpdateCandidate): Promise<boolean> {
    const { path, version } = this.options.installation;
    const recorded = await this.recorded();
    if (recorded !== null && !sameKey(recorded, candidate)) {
      return false;
    }
    // Recorded as what this very file is: nothing to ask of it.
    if (recorded !== null && (path === undefined || recorded.executable === undefined || samePath(recorded.executable, path, this.platform))) {
      return true;
    }

    // Nothing recorded, or recorded for another file: the running file — or,
    // with none of its own, this version in the name — is the only hint.
    const self = path === undefined ? null : await stat(path).catch(() => null);
    const same =
      self !== null ? self.size === candidate.size : candidate.name.includes(`-${version}-`) || candidate.name.includes(`-${version}.`);
    if (same) {
      // From now on the share's own key is the one compared.
      await this.record(candidate, path).catch(() => undefined);
    }
    return same;
  }

  /** Copies `candidate` into its own folder of the local temporary folder; the copy's path. */
  private async stage(candidate: UpdateCandidate, folder: string): Promise<string> {
    const directory = join(this.options.tempDir, folder);
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    const staged = join(directory, candidate.name);
    try {
      await this.copyChecked(candidate, staged);
      if (this.platform === 'win32') {
        // Copied with the file, a "downloaded from the internet" mark would
        // have Windows stop the program to ask — behind a window no one sees.
        await rm(`${staged}:Zone.Identifier`, { force: true }).catch(() => undefined);
      }
    } catch (error: unknown) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    return staged;
  }

  private async recorded(): Promise<InstalledRecord | null> {
    try {
      const value = JSON.parse(await readFile(this.options.stateFile, 'utf8')) as { installed?: Partial<InstalledRecord> };
      const installed = value.installed;
      if (
        installed !== undefined &&
        typeof installed.name === 'string' &&
        typeof installed.size === 'number' &&
        typeof installed.mtimeMs === 'number'
      ) {
        const { name, size, mtimeMs, executable } = installed;
        return { name, size, mtimeMs, ...(typeof executable === 'string' ? { executable } : {}) };
      }
    } catch {
      // Missing or broken: nothing recorded.
    }
    return null;
  }

  private async record(key: UpdateFileKey, executable?: string): Promise<void> {
    const file = this.options.stateFile;
    await mkdir(dirname(file), { recursive: true });
    const installed: InstalledRecord = { name: key.name, size: key.size, mtimeMs: key.mtimeMs, ...(executable ? { executable } : {}) };
    const temporary = `${file}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ installed }, null, 2)}\n`);
    await rename(temporary, file);
  }

  /** The share's file is still the one that was offered. */
  private async assertUnchanged(candidate: UpdateCandidate): Promise<void> {
    const info = await stat(candidate.path).catch(() => null);
    if (info === null) {
      throw new Error(`${candidate.name} is no longer in ${this.options.source}.`);
    }
    if (!sameKey({ name: candidate.name, size: info.size, mtimeMs: info.mtimeMs }, candidate)) {
      throw new Error(`${candidate.name} changed since it was offered; it may still be being copied.`);
    }
  }

  /** Copies, then checks that all of it arrived and that the source held still. */
  private async copyChecked(candidate: UpdateCandidate, to: string): Promise<void> {
    await copyFile(candidate.path, to);
    const copied = await stat(to);
    if (copied.size !== candidate.size) {
      throw new Error(`${candidate.name} was not copied whole.`);
    }
    await this.assertUnchanged(candidate);
  }
}

/**
 * Starts the new version — the local copy of an AppImage or portable `.exe`,
 * or a setup — as a process of its own that outlives this one, and resolves
 * once it is running; rejects when it cannot start, so the app stays open
 * rather than quitting into nothing.
 *
 * Started directly, with nothing in between: both are windowed programs, so
 * nothing flashes up, and nothing needs waiting for — the new app waits for
 * this one's single-instance lock itself (`--tr-file-upgraded`), and the
 * portable launcher unpacks into a folder of its own each run.
 */
export async function startDetached(relaunch: Relaunch): Promise<void> {
  const env = { ...process.env };
  // The running launcher's variables would point the new one at our copy.
  for (const name of ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD', 'PORTABLE_EXECUTABLE_DIR', 'PORTABLE_EXECUTABLE_FILE', 'PORTABLE_EXECUTABLE_APP_FILENAME']) {
    delete env[name];
  }
  const child = spawn(relaunch.command, [...relaunch.args], {
    // Its own folder: never the one the running app was unpacked into, which goes as it exits.
    cwd: dirname(relaunch.command),
    detached: true,
    stdio: 'ignore',
    env,
  });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', (error) => reject(new Error(`The new version could not be started: ${error.message}`)));
  });
  child.unref();
}

/** What the title bar is told (§8.6): a newer version, and whether it is being put in place. */
export interface UpdateStatus {
  /** The file on the share that would be installed, by name; `null` when up to date. */
  readonly available: string | null;
  readonly upgrading: boolean;
}

/** How often the share is looked at again. */
export const UPDATE_CHECK_INTERVAL_MS = 15 * 60_000;

export interface UpdateMonitorHooks {
  /** The status changed; every window is told. */
  readonly changed: (status: UpdateStatus) => void;
  /**
   * The update is in place: start it after this process, then quit. Rejects
   * when it cannot be started — the app then stays open and says why.
   */
  readonly restart: (relaunch: Relaunch) => Promise<void>;
  readonly log: (message: string, fields?: Record<string, unknown>) => void;
}

/**
 * Keeps looking for a newer version — at start and every quarter of an hour —
 * and applies it when asked. One check or upgrade at a time.
 */
export class UpdateMonitor {
  private candidate: UpdateCandidate | null = null;
  private upgrading = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private checking: Promise<string | null> | null = null;
  /** Why the last check failed, so a share that stays away is logged once. */
  private lastError: string | null = null;

  constructor(
    private readonly updater: SelfUpdate,
    private readonly hooks: UpdateMonitorHooks,
    private readonly intervalMs = UPDATE_CHECK_INTERVAL_MS,
  ) {}

  get status(): UpdateStatus {
    return { available: this.candidate?.name ?? null, upgrading: this.upgrading };
  }

  /** Clears what an earlier upgrade left, then checks now and on the interval. */
  async start(): Promise<void> {
    await this.updater.cleanUp();
    this.timer = setInterval(() => void this.check(), this.intervalMs);
    this.timer.unref?.();
    await this.check();
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Looks at the share once; joins a check already running. Resolves with why
   * the share could not be read, or `null` — the status says what was found.
   */
  check(): Promise<string | null> {
    this.checking ??= this.checkOnce().finally(() => (this.checking = null));
    return this.checking;
  }

  /**
   * Puts the offered version in place and restarts into it. Resolves with why
   * it could not, or `null` once the restart is under way.
   */
  async upgrade(): Promise<string | null> {
    if (this.upgrading) {
      return null;
    }
    await this.check();
    const candidate = this.candidate;
    if (candidate === null) {
      return 'There is no newer version to upgrade to.';
    }

    this.upgrading = true;
    this.hooks.changed(this.status);
    try {
      const relaunch = await this.updater.apply(candidate);
      this.hooks.log('upgrading', { from: this.updater.installation.version, to: candidate.name, source: candidate.path, run: relaunch.command, args: relaunch.args });
      await this.hooks.restart(relaunch);
      return null;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      this.hooks.log('upgrade failed', { to: candidate.name, reason });
      this.upgrading = false;
      this.hooks.changed(this.status);
      return reason;
    }
  }

  private async checkOnce(): Promise<string | null> {
    if (this.upgrading) {
      return null;
    }
    const before = this.candidate?.name ?? null;
    try {
      this.candidate = await this.updater.check();
      this.lastError = null;
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      if (reason !== this.lastError) {
        this.hooks.log('update check failed', { reason });
      }
      this.lastError = reason;
      return reason;
    }
    if ((this.candidate?.name ?? null) !== before) {
      if (this.candidate !== null) {
        this.hooks.log('update available', { name: this.candidate.name });
      }
      this.hooks.changed(this.status);
    }
    return null;
  }
}

/** `update.log` is kept small: past this it starts again. */
const UPDATE_LOG_LIMIT = 256 * 1024;

/** One line of `update.log`: when, what, and the fields as JSON. Never throws. */
export function appendUpdateLog(file: string, message: string, fields?: Record<string, unknown>): void {
  try {
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) > UPDATE_LOG_LIMIT) {
      truncateSync(file, 0);
    }
    appendFileSync(file, `${new Date().toISOString()} ${message}${fields ? ` ${JSON.stringify(fields)}` : ''}\n`);
  } catch {
    // Nowhere to write it: the console has it too.
  }
}
