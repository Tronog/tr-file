import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, createWriteStream, statSync, truncateSync } from 'node:fs';
import { chmod, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

/**
 * Where updates come from (PRD 017, §2): the latest release of this GitHub
 * repository. `TR_FILE_UPDATE_REPO` names another, `TR_FILE_UPDATE_DIR` a
 * folder to look in instead (as the office share was, PRD 001, §8.6), and
 * `off` in either turns updating off.
 */
export const DEFAULT_UPDATE_REPO = 'Tronog/tr-file';

/**
 * What a copy of the app is, which decides which distributable updates it
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
  /** `app.getVersion()`: what a release's version is compared with. */
  readonly version: string;
}

/**
 * What says a file is a new build (§8.6): its size and modified time — not
 * its name, which may stay the same from one version to the next. A GitHub
 * release's asset is dated when it was uploaded, so a version published again
 * with its files replaced is a new key too. The name is kept only to say what
 * is offered.
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

/** A distributable newer than the running one. */
export interface UpdateCandidate extends UpdateFileKey {
  /** Where it is: a path in the update folder, or the release asset's download URL. */
  readonly source: string;
  /** The release's version (its tag, `v` dropped), where the feed has one. */
  readonly version?: string;
  /** `sha256:<hex>`, where the feed gives one: checked once it is downloaded. */
  readonly digest?: string;
}

/**
 * Where distributables are found, and how one is brought here. Both throw
 * with a sentence to show — *Check for Updates…* says it (§8.6.1).
 */
export interface UpdateFeed {
  /** Where it looks, for the log. */
  readonly location: string;
  /** The newest distributable for this kind of copy; `null` if there is none. */
  latest(kind: InstallationKind): Promise<UpdateCandidate | null>;
  /**
   * Writes the whole of `candidate` to `to`, or throws — when it cannot be
   * had, or is no longer what was offered. What it leaves at `to` on a throw
   * is the caller's to remove.
   */
  fetch(candidate: UpdateCandidate, to: string): Promise<void>;
}

/** How the new version starts once this process has gone. */
export interface Relaunch {
  readonly command: string;
  readonly args: readonly string[];
}

export interface SelfUpdateOptions {
  readonly feed: UpdateFeed;
  readonly installation: Installation;
  /** `update-state.json` in the user-data folder: the key of what is installed. */
  readonly stateFile: string;
  /**
   * A folder of the *local* temporary folder, where a Windows distributable
   * is put to be run — never from a share, where a program will not run (§8.6).
   */
  readonly tempDir: string;
  /** `process.platform`, for comparing paths; a test may say another. */
  readonly platform?: NodeJS.Platform;
}

/** Filesystem times on a share are coarse (FAT: 2 s); a key within this is the same key. */
const MTIME_TOLERANCE_MS = 2_000;

/** A file in the update folder must have stood still this long to be offered. */
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

/** Where updates are looked for (PRD 017, §2). */
export type UpdateSource = { readonly kind: 'github'; readonly repo: string } | { readonly kind: 'folder'; readonly path: string };

/** Where to look, or `null` when updating is off. */
export function updateSource(env: NodeJS.ProcessEnv): UpdateSource | null {
  const folder = env['TR_FILE_UPDATE_DIR']?.trim();
  const repo = env['TR_FILE_UPDATE_REPO']?.trim();
  if (folder === 'off' || repo === 'off') {
    return null;
  }
  if (folder) {
    return { kind: 'folder', path: folder };
  }
  return { kind: 'github', repo: repo || DEFAULT_UPDATE_REPO };
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

/** The same build: the same size and modified time, whatever the files are called (§8.6). */
export function sameKey(a: UpdateFileKey, b: UpdateFileKey): boolean {
  return a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) <= MTIME_TOLERANCE_MS;
}

/**
 * Orders two versions (`1.2.10` after `1.2.9`; a pre-release before its
 * release); `null` when either is not a version — a tag like `latest`.
 */
export function compareVersions(a: string, b: string): number | null {
  const parse = (version: string): { parts: number[]; pre: boolean } | null => {
    const match = /^v?(\d+(?:\.\d+)*)(-[0-9A-Za-z.-]+)?(?:\+.*)?$/.exec(version.trim());
    return match ? { parts: match[1]!.split('.').map(Number), pre: match[2] !== undefined } : null;
  };
  const x = parse(a);
  const y = parse(b);
  if (x === null || y === null) {
    return null;
  }
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const difference = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  return x.pre === y.pre ? 0 : x.pre ? -1 : 1;
}

/** Whether two paths name one file — without regard to case on Windows. */
function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const [x, y] = [resolve(a), resolve(b)];
  return platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A folder of distributables (PRD 001, §8.6) — the office share as it was,
 * now only where `TR_FILE_UPDATE_DIR` names one. Plain files: there is no
 * version to read, so the newest file that has stood still is the latest.
 */
export class FolderUpdateFeed implements UpdateFeed {
  private readonly settleMs: number;
  private readonly now: () => number;

  constructor(
    readonly location: string,
    options: { readonly settleMs?: number; readonly now?: () => number } = {},
  ) {
    this.settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
    this.now = options.now ?? Date.now;
  }

  /** The most recently modified distributable that has stood still; `null` if none. */
  async latest(kind: InstallationKind): Promise<UpdateCandidate | null> {
    let names: string[];
    try {
      names = await readdir(this.location);
    } catch {
      // The share is not mounted, or not reachable from here: said by a check
      // asked for (§8.6.1); a periodic one only logs it.
      throw new Error(`The update folder ${this.location} could not be read.`);
    }

    let latest: UpdateCandidate | null = null;
    for (const name of names) {
      if (!isDistributableFor(kind, name)) {
        continue;
      }
      const path = join(this.location, name);
      const info = await stat(path).catch(() => null);
      if (info === null || !info.isFile() || this.now() - info.mtimeMs < this.settleMs) {
        continue;
      }
      if (latest === null || info.mtimeMs > latest.mtimeMs) {
        latest = { name, size: info.size, mtimeMs: info.mtimeMs, source: path };
      }
    }
    return latest;
  }

  /** Copies, checking before and after that the file still is the one offered. */
  async fetch(candidate: UpdateCandidate, to: string): Promise<void> {
    await this.assertUnchanged(candidate);
    await copyFile(candidate.source, to);
    const copied = await stat(to);
    if (copied.size !== candidate.size) {
      throw new Error(`${candidate.name} was not copied whole.`);
    }
    await this.assertUnchanged(candidate);
  }

  private async assertUnchanged(candidate: UpdateCandidate): Promise<void> {
    const info = await stat(candidate.source).catch(() => null);
    if (info === null) {
      throw new Error(`${candidate.name} is no longer in ${this.location}.`);
    }
    if (!sameKey({ name: candidate.name, size: info.size, mtimeMs: info.mtimeMs }, candidate)) {
      throw new Error(`${candidate.name} changed since it was offered; it may still be being copied.`);
    }
  }
}

/** `fetch`, or Electron's `net.fetch` — which goes through the system's proxy. */
export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>;

/** What GitHub's API says of a release, as far as it is read here. */
interface GitHubRelease {
  readonly tag_name: string;
  readonly assets: readonly {
    readonly name: string;
    readonly size: number;
    readonly state: string;
    readonly updated_at: string;
    readonly browser_download_url: string;
    readonly digest?: string | null;
  }[];
}

/** An API answer takes no longer than this. */
const API_TIMEOUT_MS = 20_000;

/** A download that receives nothing for this long has stalled. */
const DOWNLOAD_IDLE_MS = 60_000;

/**
 * The latest release of a GitHub repository (PRD 017, §2) — what
 * `pnpm desktop:release:github` publishes (§1). Its tag is the version; its
 * assets are matched to the running kind as the folder's files were.
 *
 * Asked with the last answer's `ETag`: GitHub lets an anonymous address make
 * 60 requests an hour, and an unchanged answer (`304`) does not count — an
 * office of copies looking every quarter hour stays well under.
 */
export class GitHubReleaseFeed implements UpdateFeed {
  private etag: string | null = null;
  private release: GitHubRelease | null = null;

  constructor(
    readonly repo: string,
    private readonly http: HttpFetch = fetch,
    private readonly api = 'https://api.github.com',
  ) {}

  get location(): string {
    return `https://github.com/${this.repo}/releases/latest`;
  }

  async latest(kind: InstallationKind): Promise<UpdateCandidate | null> {
    const release = await this.latestRelease();
    if (release === null) {
      return null;
    }
    const version = release.tag_name.replace(/^v/i, '');
    let latest: UpdateCandidate | null = null;
    for (const asset of release.assets) {
      // One still uploading (`starter`) is not offered yet.
      if (asset.state !== 'uploaded' || !isDistributableFor(kind, asset.name)) {
        continue;
      }
      const mtimeMs = Date.parse(asset.updated_at);
      if (latest === null || mtimeMs > latest.mtimeMs) {
        latest = {
          name: asset.name,
          size: asset.size,
          mtimeMs,
          source: asset.browser_download_url,
          version,
          ...(asset.digest ? { digest: asset.digest } : {}),
        };
      }
    }
    return latest;
  }

  /** Downloads, then checks it arrived whole and — where GitHub has its digest — unaltered. */
  async fetch(candidate: UpdateCandidate, to: string): Promise<void> {
    const controller = new AbortController();
    let idle = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_MS);
    const hash = createHash('sha256');
    let size = 0;
    try {
      const response = await this.http(candidate.source, { signal: controller.signal });
      if (!response.ok || response.body === null) {
        throw new Error(`${candidate.name} could not be downloaded (HTTP ${response.status}).`);
      }
      await pipeline(
        Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
        async function* (chunks: AsyncIterable<Buffer>) {
          for await (const chunk of chunks) {
            clearTimeout(idle);
            idle = setTimeout(() => controller.abort(), DOWNLOAD_IDLE_MS);
            hash.update(chunk);
            size += chunk.length;
            yield chunk;
          }
        },
        createWriteStream(to),
      );
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        throw new Error(`The download of ${candidate.name} stalled.`);
      }
      throw error instanceof Error && error.message.startsWith(candidate.name)
        ? error
        : new Error(`${candidate.name} could not be downloaded: ${reasonOf(error)}`);
    } finally {
      clearTimeout(idle);
    }
    if (size !== candidate.size) {
      throw new Error(`${candidate.name} was not downloaded whole.`);
    }
    const [algorithm, expected] = candidate.digest?.split(':') ?? [];
    if (algorithm === 'sha256' && expected && hash.digest('hex') !== expected.toLowerCase()) {
      throw new Error(`${candidate.name} did not download as published; it may have been replaced meanwhile.`);
    }
  }

  /** `releases/latest`: the newest release that is neither a draft nor a pre-release; `null` if none. */
  private async latestRelease(): Promise<GitHubRelease | null> {
    let response: Response;
    try {
      response = await this.http(`${this.api}/repos/${this.repo}/releases/latest`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(this.etag !== null ? { 'If-None-Match': this.etag } : {}),
        },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
      });
    } catch (error: unknown) {
      throw new Error(`GitHub could not be reached: ${reasonOf(error)}`);
    }
    if (response.status === 304 && this.release !== null) {
      return this.release;
    }
    if (response.status === 404) {
      // No release yet (or no such repository): nothing to offer.
      this.etag = null;
      this.release = null;
      return null;
    }
    if ((response.status === 403 || response.status === 429) && response.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const when = Number.isFinite(reset) && reset > 0 ? ` until ${new Date(reset * 1000).toLocaleTimeString()}` : ' for now';
      throw new Error(`GitHub allows no more update checks from this address${when}.`);
    }
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status} for the latest release of ${this.repo}.`);
    }
    const release = (await response.json()) as GitHubRelease;
    if (typeof release?.tag_name !== 'string' || !Array.isArray(release.assets)) {
      throw new Error(`GitHub's answer for the latest release of ${this.repo} could not be read.`);
    }
    this.etag = response.headers.get('etag');
    this.release = release;
    return release;
  }
}

/** The feed `source` names. */
export function updateFeedFor(source: UpdateSource, http?: HttpFetch): UpdateFeed {
  return source.kind === 'folder' ? new FolderUpdateFeed(source.path) : new GitHubReleaseFeed(source.repo, http);
}

/**
 * Self-updating (PRD 001, §8.6; from GitHub, PRD 017, §2).
 *
 * A release says its version: a newer one is offered, an older one never is.
 * The same version — a release published again with its files replaced — or a
 * folder, which says none, is told by the file's key — size and modified time;
 * the name may stay the same — against the key of the file this copy was
 * installed from. That key is kept in `update-state.json`, written as an
 * upgrade is applied, with the file it was installed as. Where the running
 * file is another (a copy installed by hand, or an older one started from its
 * old shortcut), the running file stands in: the same size is the same file,
 * whatever a copy did to its time — or, for the installed kind, which has no
 * file of its own, a name carrying this version.
 *
 * Applying it:
 * - **AppImage** — fetched beside the running one and renamed over it (a
 *   running file may be renamed), so its path — what every shortcut points
 *   at — stays.
 * - **Windows** — fetched into the local temporary folder (§8.6) and run from
 *   there: the portable `.exe` is the app from then on (its old copy is left
 *   alone), the setup installs over the installation silently.
 *
 * Either way the new version starts once this process has gone.
 *
 * Nothing here imports `electron`.
 */
export class SelfUpdate {
  private readonly platform: NodeJS.Platform;

  constructor(private readonly options: SelfUpdateOptions) {
    this.platform = options.platform ?? process.platform;
  }

  get installation(): Installation {
    return this.options.installation;
  }

  /**
   * The newest distributable when it is not what is running; `null` when it
   * is, when it is older, or when there is none. Throws when the feed cannot
   * be read.
   */
  async check(): Promise<UpdateCandidate | null> {
    const latest = await this.options.feed.latest(this.options.installation.kind);
    if (latest === null) {
      return null;
    }
    const order = latest.version === undefined ? null : compareVersions(latest.version, this.options.installation.version);
    if (order !== null && order !== 0) {
      return order > 0 ? latest : null;
    }
    return (await this.isCurrent(latest)) ? null : latest;
  }

  /**
   * Puts `candidate` in place and says how to start it. Throws, leaving the
   * running copy as it was, when it cannot — a folder the app may not write
   * in, a file that changed since it was offered.
   */
  async apply(candidate: UpdateCandidate): Promise<Relaunch> {
    const installation = this.options.installation;

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
      await this.options.feed.fetch(candidate, part);
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
      // From now on the feed's own key is the one compared.
      await this.record(candidate, path).catch(() => undefined);
    }
    return same;
  }

  /** Fetches `candidate` into its own folder of the local temporary folder; the copy's path. */
  private async stage(candidate: UpdateCandidate, folder: string): Promise<string> {
    const directory = join(this.options.tempDir, folder);
    await rm(directory, { recursive: true, force: true });
    await mkdir(directory, { recursive: true });
    const staged = join(directory, candidate.name);
    try {
      await this.options.feed.fetch(candidate, staged);
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
  /** The distributable that would be installed, by name; `null` when up to date. */
  readonly available: string | null;
  readonly upgrading: boolean;
}

/** How often the feed is looked at again. */
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
  /** Why the last check failed, so a feed that stays away is logged once. */
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
   * Looks at the feed once; joins a check already running. Resolves with why
   * it could not be read, or `null` — the status says what was found.
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
      this.hooks.log('upgrading', { from: this.updater.installation.version, to: candidate.name, source: candidate.source, run: relaunch.command, args: relaunch.args });
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
