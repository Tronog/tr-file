import { HealthStatus } from './health.model.js';

export class HealthService {
  constructor(
    private readonly version: string,
    private readonly nodeEnv: string,
  ) {}

  check(): HealthStatus {
    return new HealthStatus(
      Math.round(process.uptime() * 1000) / 1000,
      new Date(),
      this.version,
      this.nodeEnv,
    );
  }
}
