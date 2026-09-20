import { resolve } from 'node:path';

export type NodeEnv = 'development' | 'production' | 'test';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

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
  /** Hard ceiling, in bytes, for the body of a single uploaded file. */
  readonly uploadMaxBytes: number;

  private constructor(env: NodeJS.ProcessEnv) {
    this.nodeEnv = AppConfig.readEnum<NodeEnv>(
      env['NODE_ENV'],
      ['development', 'production', 'test'],
      'development',
    );
    this.host = env['HOST']?.trim() || '0.0.0.0';
    this.port = AppConfig.readPort(env['PORT'], 3000);
    this.apiPrefix = env['API_PREFIX']?.trim() || '/api';
    this.logLevel = AppConfig.readEnum<LogLevel>(
      env['LOG_LEVEL'],
      ['debug', 'info', 'warn', 'error'],
      this.nodeEnv === 'production' ? 'info' : 'debug',
    );
    this.filesRoot = resolve(env['FILES_ROOT']?.trim() || process.cwd());
    this.uploadMaxBytes = AppConfig.readByteSize(env['UPLOAD_MAX_BYTES'], 512 * 1024 * 1024);
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
    return new AppConfig(env);
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
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
