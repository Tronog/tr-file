import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/** What the desktop shell needs to know before it can boot anything. */
export interface DesktopPaths {
  /** Directory the built Angular bundle lives in (`index.html` and friends). */
  readonly staticRoot: string;
  /**
   * Absolute path the file-system API is confined to — `/` unless
   * `FILES_ROOT` says otherwise, which on Windows means every drive.
   */
  readonly filesRoot: string;
}

/** Everything `DesktopConfig.resolve` needs; all of it comes from `main.ts`. */
export interface DesktopEnvironment {
  readonly env: NodeJS.ProcessEnv;
  /** `app.getPath('home')` — where the user starts, and the first of the places. */
  readonly homeDir: string;
  /** `app.getAppPath()`: the unpacked source root, or `app.asar` when packaged. */
  readonly appPath: string;
  /** `process.resourcesPath`; only meaningful in a packaged app. */
  readonly resourcesPath: string;
  /** `app.isPackaged`. */
  readonly packaged: boolean;
}

/** Where a development checkout keeps the Angular build, relative to `appPath`. */
const WORKSPACE_STATIC = join('..', 'frontend', 'dist', 'frontend', 'browser');

/** Where the packaged app keeps it, relative to `resourcesPath`. */
const PACKAGED_STATIC = join('app', 'browser');

/**
 * Immutable, validated configuration of the desktop shell.
 *
 * The shape mirrors the backend's `AppConfig` on purpose — one class that owns
 * every environment lookup — but the two answer different questions. This one
 * decides *what to run and where to find it*; `AppConfig` decides how the
 * server behaves, and is handed the answers through `serverEnv`.
 *
 * Nothing here imports `electron`. Everything Electron knows arrives as a
 * `DesktopEnvironment`, which is what lets the stack be started and tested
 * outside a desktop session.
 */
export class DesktopConfig {
  /** Loopback only: the stack must never be reachable from the network. */
  readonly host = '127.0.0.1';

  /** `0` asks the OS for a free port, which is the normal case. */
  readonly port: number;

  readonly staticRoot: string;
  readonly filesRoot: string;

  /** Turns the server's logging up. Does *not* open the dev tools. */
  readonly development: boolean;

  /**
   * Whether to open the dev tools with the window.
   *
   * Off unless `TR_FILE_DEVTOOLS=1` asks for it, including in a development
   * checkout: an inspector opening over the app every time it starts is a
   * nuisance, and the standard shortcut is always there for the times it is
   * wanted.
   */
  readonly devTools: boolean;

  /**
   * The Angular dev server to load instead of the built bundle, or `null`.
   *
   * `pnpm dev` at the workspace root runs `ng serve` beside this shell, and a
   * window showing a bundle from the last `ng build` is worse than useless
   * while someone is editing the frontend. `TR_FILE_DEV_SERVER` names that
   * server; the shell waits for it and falls back to the built bundle if it
   * never answers, so the window opens either way.
   *
   * Only honoured in development: a packaged app must never be talked into
   * loading its UI from somewhere else by an environment variable.
   */
  readonly devServerUrl: URL | null;

  /** The shell's own environment, kept for the settings passed on to the server. */
  private readonly environmentEnv: NodeJS.ProcessEnv;

  private constructor(environment: DesktopEnvironment, paths: DesktopPaths) {
    this.environmentEnv = environment.env;
    this.port = DesktopConfig.readPort(environment.env['TR_FILE_PORT']);
    // An unpackaged app is by definition someone working on it; `TR_FILE_DEV`
    // overrides that in both directions, so a packaged build can be debugged
    // and a checkout can be run as a user would see it.
    this.development = DesktopConfig.readFlag(environment.env['TR_FILE_DEV'], !environment.packaged);
    this.devTools = DesktopConfig.readFlag(environment.env['TR_FILE_DEVTOOLS'], false);
    this.staticRoot = paths.staticRoot;
    this.filesRoot = paths.filesRoot;
    this.devServerUrl = this.development
      ? DesktopConfig.readDevServer(environment.env['TR_FILE_DEV_SERVER'])
      : null;
  }

  static resolve(environment: DesktopEnvironment): DesktopConfig {
    return new DesktopConfig(environment, {
      staticRoot: DesktopConfig.findStaticRoot(environment),
      filesRoot: DesktopConfig.findFilesRoot(environment),
    });
  }

  /**
   * The environment the backend's own `AppConfig` is built from.
   *
   * Synthesised rather than exported into `process.env`: the server runs
   * inside the Electron main process, and a stray `PORT` in the user's shell
   * must not be able to move it off loopback.
   */
  serverEnv(): NodeJS.ProcessEnv {
    return {
      NODE_ENV: this.development ? 'development' : 'production',
      HOST: this.host,
      PORT: String(this.port),
      FILES_ROOT: this.filesRoot,
      LOG_LEVEL: this.development ? 'debug' : 'info',
      // The user's own computer and repositories (PRD 011, §1): git is theirs to run.
      GIT_ENABLED: 'true',
      // Task Manager (PRD 014, §1): the user's own computer's processes, theirs to see and to end.
      PROCESSES_ENABLED: 'true',
      PROCESSES_KILL_ENABLED: 'true',
      ...this.authEnv(),
    };
  }

  /**
   * Signing in, which the desktop leaves off by default (PRD 003, §2): the
   * app runs as the user, over files the user can already open. Setting
   * `TR_FILE_AUTH_USERNAME` with `TR_FILE_AUTH_PASSWORD` (or
   * `TR_FILE_AUTH_PASSWORD_HASH`) turns it on — the window then asks for them
   * before the bridge answers anything.
   */
  private authEnv(): NodeJS.ProcessEnv {
    const env = this.environmentEnv;
    const username = env['TR_FILE_AUTH_USERNAME']?.trim() ?? '';
    if (username === '') {
      return { AUTH_ENABLED: 'false' };
    }
    return {
      AUTH_ENABLED: 'true',
      AUTH_USERNAME: username,
      ...(env['TR_FILE_AUTH_PASSWORD'] === undefined ? {} : { AUTH_PASSWORD: env['TR_FILE_AUTH_PASSWORD'] }),
      ...(env['TR_FILE_AUTH_PASSWORD_HASH'] === undefined
        ? {}
        : { AUTH_PASSWORD_HASH: env['TR_FILE_AUTH_PASSWORD_HASH'] }),
    };
  }

  /** Whether the Angular build this configuration points at actually exists. */
  get hasStaticRoot(): boolean {
    return existsSync(join(this.staticRoot, 'index.html'));
  }

  /**
   * The folder the user may browse. `FILES_ROOT` wins so a shortcut or a
   * script can pin the app to one tree; otherwise it is the whole file system
   * (PRD 003, §6) — other drives, USB sticks and network mounts are what a
   * file manager is for, and the window still *starts* in the home folder,
   * which the places say. `/` is passed on as it is, not resolved: on
   * Windows that is how `AppConfig` knows to offer every drive rather than
   * the one the process happens to run from.
   */
  private static findFilesRoot(environment: DesktopEnvironment): string {
    const configured = environment.env['FILES_ROOT']?.trim();
    return configured && configured !== '' ? resolve(configured) : '/';
  }

  /**
   * The Angular bundle: whatever `TR_FILE_STATIC_ROOT` names, else the copy
   * shipped beside a packaged app, else the workspace's own `ng build` output
   * so a checkout runs without a packaging step.
   */
  private static findStaticRoot(environment: DesktopEnvironment): string {
    const configured = environment.env['TR_FILE_STATIC_ROOT']?.trim();
    if (configured && configured !== '') {
      return isAbsolute(configured) ? configured : resolve(configured);
    }

    const packaged = join(environment.resourcesPath, PACKAGED_STATIC);
    if (environment.packaged && existsSync(packaged)) {
      return packaged;
    }

    return resolve(environment.appPath, WORKSPACE_STATIC);
  }

  /**
   * `TR_FILE_DEV_SERVER` as a URL. Empty means "no dev server"; anything that
   * is not an `http(s)` address is a mistake worth failing on, the same way an
   * impossible `TR_FILE_PORT` is.
   */
  private static readDevServer(raw: string | undefined): URL | null {
    const value = raw?.trim();
    if (value === undefined || value === '') {
      return null;
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid TR_FILE_DEV_SERVER value: "${raw}"`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Invalid TR_FILE_DEV_SERVER value: "${raw}"`);
    }
    return url;
  }

  private static readFlag(raw: string | undefined, fallback: boolean): boolean {
    const value = raw?.trim();
    return value === undefined || value === '' ? fallback : value === '1';
  }

  private static readPort(raw: string | undefined): number {
    if (raw === undefined || raw.trim() === '') {
      return 0;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      throw new Error(`Invalid TR_FILE_PORT value: "${raw}"`);
    }
    return parsed;
  }
}
