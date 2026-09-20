import { Router } from 'express';

import type { RouteModule } from '../../core/index.js';
import type { HealthService } from './health.service.js';

/** HTTP surface of the `health` module, mounted at `<apiPrefix>/health`. */
export class HealthRoutes implements RouteModule {
  readonly basePath = '/health';
  readonly router: Router;

  constructor(private readonly healthService: HealthService) {
    this.router = Router();
    this.register();
  }

  private register(): void {
    this.router.get('/', (_req, res) => {
      res.json({ data: this.healthService.check().toJSON() });
    });
  }
}
