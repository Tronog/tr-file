import { Router, type Request } from 'express';

import { asyncHandler, HttpError, type RouteModule } from '../../core/index.js';
import type { DiskUsageReportRequest } from './disk-usage.model.js';
import type { DiskUsageService } from './disk-usage.service.js';

/**
 * HTTP surface of the `disk-usage` module (PRD 013, §1), at `<apiPrefix>/disk-usage`.
 *
 * `POST /scans { path, depth? }` starts a scan and answers `202` with it at
 * once; `GET /scans/:id?path=&depth=` is how far it has got, with the tree
 * under `path` to `depth` levels; `POST /scans/:id/cancel` stops it.
 */
export class DiskUsageRoutes implements RouteModule {
  readonly basePath = '/disk-usage';
  readonly router: Router;

  constructor(private readonly diskUsage: DiskUsageService) {
    this.router = Router();
    this.register();
  }

  private register(): void {
    this.router.post(
      '/scans',
      asyncHandler(async (req, res) => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        if (typeof body['path'] !== 'string') {
          throw HttpError.badRequest('path must be a string');
        }
        res.status(202).json({ data: await this.diskUsage.start(body['path'], DiskUsageRoutes.report(body)) });
      }),
    );

    this.router.get('/scans/:id', (req, res) => {
      res.json({ data: this.diskUsage.status(DiskUsageRoutes.id(req), DiskUsageRoutes.report(req.query)) });
    });

    this.router.post('/scans/:id/cancel', (req, res) => {
      res.json({ data: this.diskUsage.cancel(DiskUsageRoutes.id(req)) });
    });
  }

  private static id(req: Request): string {
    return String(req.params['id']);
  }

  /** `path` and `depth` from a body or a query; a depth given as text is a number. */
  static report(value: Readonly<Record<string, unknown>>): DiskUsageReportRequest {
    const path = value['path'];
    const raw = value['depth'];
    const depth = typeof raw === 'number' ? raw : typeof raw === 'string' && raw !== '' ? Number(raw) : undefined;
    if (depth !== undefined && !Number.isFinite(depth)) {
      throw HttpError.badRequest('depth must be a number');
    }
    return { ...(typeof path === 'string' ? { path } : {}), ...(depth === undefined ? {} : { depth }) };
  }
}
