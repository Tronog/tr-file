import { serverTime } from './server-time.js';

export interface HealthStatusDto {
  readonly status: 'ok';
  readonly uptimeSeconds: number;
  readonly timestamp: string;
  /** The machine's time zone and its offset now (PRD 001, §13.1); see `ServerTimeDto`. */
  readonly timeZone: string;
  readonly utcOffsetMinutes: number;
  readonly version: string;
  readonly nodeEnv: string;
}

/** Snapshot of the process' liveness information. */
export class HealthStatus {
  constructor(
    readonly uptimeSeconds: number,
    readonly timestamp: Date,
    readonly version: string,
    readonly nodeEnv: string,
  ) {}

  toJSON(): HealthStatusDto {
    const { timeZone, utcOffsetMinutes } = serverTime(this.timestamp);
    return {
      status: 'ok',
      uptimeSeconds: this.uptimeSeconds,
      timestamp: this.timestamp.toISOString(),
      timeZone,
      utcOffsetMinutes,
      version: this.version,
      nodeEnv: this.nodeEnv,
    };
  }
}
