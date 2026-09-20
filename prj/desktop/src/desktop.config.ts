import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/** What the desktop shell needs to know before it can boot anything. */
export interface DesktopPaths {
  /** Directory the built Angular bundle lives in (`index.html` and friends). */
  readonly staticRoot: string;
  /** Absolute path the file-system API is confined to. */
  readonly filesRoot: string;
}

/** Everything `DesktopConfig.resolve` needs; all of it comes from `main.ts`. */
export interface DesktopEnvironment {
  readonly env: NodeJS.ProcessEnv;
  /** `app.getPath('home')` — the default the user browses when nothing says otherwise. */
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

  /** Opens the dev tools and turns the server's logging up. */
  readonly development: boolean;

  private constructor(environment: DesktopEnvironment, paths: DesktopPaths) {
    this.port = DesktopConfig.readPort(environment.env['TR_FILE_PORT']);
    // An unpackaged app is by definition someone working on it; `TR_FILE_DEV`
    // overrides that in both directions, so a packaged build can be debugged
    // and a checkout can be run as a user would see it.
    this.development = DesktopConfig.readFlag(environment.env['TR_FILE_DEV'], !environment.packaged);
    this.staticRoot = paths.staticRoot;
    this.filesRoot = paths.filesRoot;
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
    };
  }

  /** Whether the Angular build this configuration points at actually exists. */
  get hasStaticRoot(): boolean {
    return existsSync(join(this.staticRoot, 'index.html'));
  }

  /**
   * The folder the user browses. `FILES_ROOT` wins so a shortcut or a script
   * can pin the app to one tree; otherwise it is the home directory, which is
   * the only default a file manager can pick without surprising anyone.
   */
  private static findFilesRoot(environment: DesktopEnvironment): string {
    const configured = environment.env['FILES_ROOT']?.trim();
    return resolve(configured && configured !== '' ? configured : environment.homeDir);
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
