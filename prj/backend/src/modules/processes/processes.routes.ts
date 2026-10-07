import { Router } from 'express';

import { asyncHandler, HttpError, type RouteModule } from '../../core/index.js';
import type { ProcessEndRequest } from './processes.model.js';
import type { ProcessesService } from './processes.service.js';

/**
 * HTTP surface of the `processes` module (PRD 014, §1), at `<apiPrefix>/processes`.
 *
 * `GET /` is the latest sample; `GET /history?keys=a,b` the last ten minutes
 * of the machine and of the processes named; `POST /end { key, tree? }` ends
 * one — and with `tree`, all it started.
 */
export class ProcessesRoutes implements RouteModule {
  readonly basePath = '/processes';
  readonly router: Router;

  constructor(private readonly processes: ProcessesService) {
    this.router = Router();
    this.register();
  }

  private register(): void {
    this.router.get('/', (_req, res) => {
      res.json({ data: this.processes.snapshot() });
    });

    this.router.get('/history', (req, res) => {
      const raw = req.query['keys'];
      const keys = typeof raw === 'string' && raw !== '' ? raw.split(',') : [];
      res.json({ data: this.processes.historyOf(keys) });
    });

    this.router.post(
      '/end',
      asyncHandler(async (req, res) => {
        res.json({ data: await this.processes.end(ProcessesRoutes.endRequest(req.body)) });
      }),
    );
  }

  /** `{ key, tree? }`, checked: the key is a pid and a start, never anything else. */
  static endRequest(value: unknown): ProcessEndRequest {
    const body = (value ?? {}) as Record<string, unknown>;
    const key = body['key'];
    if (typeof key !== 'string' || !/^\d+:\d+$/.test(key)) {
      throw HttpError.badRequest('key must name a process');
    }
    const tree = body['tree'];
    if (tree !== undefined && typeof tree !== 'boolean') {
      throw HttpError.badRequest('tree must be true or false');
    }
    return { key, ...(tree === true ? { tree } : {}) };
  }
}
