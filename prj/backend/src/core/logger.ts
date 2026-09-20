import type { LogLevel } from '../config/index.js';

const LEVEL_WEIGHT: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogContext = Record<string, unknown>;

/**
 * Minimal dependency-free structured logger emitting one JSON object per line.
 * Child loggers inherit the parent's level and bindings.
 */
export class Logger {
  private constructor(
    private readonly level: LogLevel,
    private readonly bindings: LogContext,
  ) {}

  static create(level: LogLevel, bindings: LogContext = {}): Logger {
    return new Logger(level, bindings);
  }

  child(bindings: LogContext): Logger {
    return new Logger(this.level, { ...this.bindings, ...bindings });
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) {
      return;
    }
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      ...this.bindings,
      ...context,
    };
    const line = JSON.stringify(entry);
    if (level === 'error') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
  }
}
