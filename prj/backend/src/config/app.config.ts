import { resolve } from 'node:path';

export type NodeEnv = 'development' | 'production' | 'test';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Who may sign in (PRD 003, §2). One account: a file manager for one person
 * or one household, not a user directory.
 */
export interface AuthCredentials {
  readonly username: string;
  /** Set when `AUTH_PASSWORD` was given; hashed at start-up, never compared as is. */
  readonly password?: string;
  /** Set when `AUTH_PASSWORD_HASH` was given — see `pnpm --filter backend hash-password`. */
  readonly passwordHash?: string;
}

/**
 * Immutable, validated view over `process.env`.
 *
 * Every environment lookup in the application goes through this class so that
 * defaults, coercion and validation live in exactly one place.
 */
export class AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly host: string;
  readonly port: number;
  readonly apiPrefix: string;
  readonly logLevel: LogLevel;
  /** Absolute path all file-system operations are confined to. */
  readonly filesRoot: string;
  /**
   * Every drive is reachable (PRD 003, §6): `FILES_ROOT` is `/` on Windows,
   * which has no one root — so the root is the list of drives, and
   * `filesRoot` means nothing. Always `false` elsewhere, where `/` is a folder.
   */
  readonly allDrives: boolean;
  /** Hard ceiling, in bytes, for the body of a single uploaded file. */
  readonly uploadMaxBytes: number;
  /**
   * The one account allowed in, or `null` when signing in is switched off.
   *
   * On unless configured otherwise: a server with credentials requires them,
   * and a *production* server without any refuses to start rather than serve
   * the files to anyone. Only `AUTH_ENABLED=false` — the desktop shell's
   * default — or a development server with no credentials runs open.
   */
  readonly auth: AuthCredentials | null;
  /** A session nobody uses for this long is signed out. */
  readonly sessionIdleMs: number;

  private constructor(env: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
    this.nodeEnv = AppConfig.readEnum<NodeEnv>(
      env['NODE_ENV'],
      ['development', 'production', 'test'],
      'development',
    );
    this.host = env['HOST']?.trim() || '0.0.0.0';
    this.port = AppConfig.readPort(env['PORT'], 4310);
    this.apiPrefix = env['API_PREFIX']?.trim() || '/api';
    this.logLevel = AppConfig.readEnum<LogLevel>(
      env['LOG_LEVEL'],
      ['debug', 'info', 'warn', 'error'],
      this.nodeEnv === 'production' ? 'info' : 'debug',
    );
    const filesRoot = env['FILES_ROOT']?.trim() || process.cwd();
    this.allDrives = platform === 'win32' && (filesRoot === '/' || filesRoot === '\\');
    this.filesRoot = resolve(filesRoot);
    this.uploadMaxBytes = AppConfig.readByteSize(env['UPLOAD_MAX_BYTES'], 512 * 1024 * 1024);
    this.auth = AppConfig.readAuth(env, this.nodeEnv);
    this.sessionIdleMs = AppConfig.readHours(env['AUTH_SESSION_IDLE_HOURS'], 12) * 60 * 60 * 1000;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): AppConfig {
    return new AppConfig(env, platform);
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  /**
   * `AUTH_ENABLED` decides when it is set; otherwise credentials do, and a
   * production server without them is a configuration error, not an open door.
   */
  private static readAuth(env: NodeJS.ProcessEnv, nodeEnv: NodeEnv): AuthCredentials | null {
    const flag = env['AUTH_ENABLED']?.trim().toLowerCase();
    if (flag !== undefined && flag !== '' && !['true', 'false', '1', '0'].includes(flag)) {
      throw new Error(`Invalid AUTH_ENABLED value: "${env['AUTH_ENABLED']}"; expected true or false`);
    }
    const enabled = flag === 'true' || flag === '1' ? true : flag === 'false' || flag === '0' ? false : null;
    if (enabled === false) {
      return null;
    }

    const username = env['AUTH_USERNAME']?.trim() ?? '';
    const password = env['AUTH_PASSWORD'] ?? '';
    const passwordHash = env['AUTH_PASSWORD_HASH']?.trim() ?? '';
    const configured = username !== '' && (password !== '' || passwordHash !== '');

    if (configured) {
      return {
        username,
        ...(passwordHash !== '' ? { passwordHash } : { password }),
      };
    }
    if (enabled === true || nodeEnv === 'production') {
      throw new Error(
        'Signing in is required but no account is configured: set AUTH_USERNAME and AUTH_PASSWORD ' +
          '(or AUTH_PASSWORD_HASH), or set AUTH_ENABLED=false to run without a login.',
      );
    }
    return null;
  }

  private static readHours(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw.trim() === '') {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`Invalid AUTH_SESSION_IDLE_HOURS value: "${raw}"`);
    }
    return parsed;
  }

  private static readPort(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw.trim() === '') {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
      throw new Error(`Invalid PORT value: "${raw}"`);
    }
    return parsed;
  }

  private static readByteSize(raw: string | undefined, fallback: number): number {
    if (raw === undefined || raw.trim() === '') {
      return fallback;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`Invalid UPLOAD_MAX_BYTES value: "${raw}"`);
    }
    return parsed;
  }

  private static readEnum<T extends string>(
    raw: string | undefined,
    allowed: readonly T[],
    fallback: T,
  ): T {
    if (raw === undefined || raw.trim() === '') {
      return fallback;
    }
    const value = raw.trim() as T;
    if (!allowed.includes(value)) {
      throw new Error(`Invalid value "${raw}"; expected one of ${allowed.join(', ')}`);
    }
    return value;
  }
}
