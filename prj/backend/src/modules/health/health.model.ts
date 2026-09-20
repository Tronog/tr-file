export interface HealthStatusDto {
  readonly status: 'ok';
  readonly uptimeSeconds: number;
  readonly timestamp: string;
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
    return {
      status: 'ok',
      uptimeSeconds: this.uptimeSeconds,
      timestamp: this.timestamp.toISOString(),
      version: this.version,
      nodeEnv: this.nodeEnv,
    };
  }
}
