import { Router, type Request } from 'express';

import { asyncHandler, type RouteModule } from '../../core/index.js';
import { parseDecision, parseOperationRequest } from './operation-request.js';
import type { OperationKind } from './operation.model.js';
import type { OperationsService } from './operations.service.js';

/**
 * HTTP surface of the `operations` module, at `<apiPrefix>/ops`.
 *
 * Starting an operation answers `202` with the job at once; the client then
 * asks `GET /jobs/:id` for its progress — once a second is what the frontend
 * does — and may `POST /jobs/:id/cancel`. A job started with `errors: 'ask'`
 * that is `waiting` on an entry it could not do is answered with
 * `POST /jobs/:id/resolve` (PRD 001, Fix 3).
 */
export class OperationsRoutes implements RouteModule {
  readonly basePath = '/ops';
  readonly router: Router;

  constructor(private readonly operations: OperationsService) {
    this.router = Router();
    this.register();
  }

  private register(): void {
    // GET /api/ops/info — what kind of trash this server keeps, and whether it can restore.
    this.router.get('/info', (_req, res) => {
      res.json({ data: this.operations.info });
    });

    // GET /api/ops/trash-items — what is in the trash (PRD 001, §14.1).
    this.router.get(
      '/trash-items',
      asyncHandler(async (_req, res) => {
        res.json({ data: await this.operations.trashListing() });
      }),
    );

    // POST /api/ops/copy | move | trash | empty-trash | delete | restore | compress | extract — start a job.
    for (const kind of [
      'copy',
      'move',
      'trash',
      'empty-trash',
      'delete',
      'restore',
      'compress',
      'extract',
    ] as const satisfies readonly OperationKind[]) {
      this.router.post(
        `/${kind}`,
        asyncHandler(async (req, res) => {
          const job = await this.operations.start(parseOperationRequest(kind, req.body));
          res.status(202).json({ data: job });
        }),
      );
    }

    // GET /api/ops/jobs/:id — how far a job has got.
    this.router.get('/jobs/:id', (req, res) => {
      res.json({ data: this.operations.status(OperationsRoutes.id(req)) });
    });

    // POST /api/ops/jobs/:id/resolve { decision: skip | skip-all | retry | abort } — answer a waiting job.
    this.router.post('/jobs/:id/resolve', (req, res) => {
      res.json({ data: this.operations.resolve(OperationsRoutes.id(req), parseDecision(req.body)) });
    });

    // POST /api/ops/jobs/:id/cancel — stop a job.
    this.router.post('/jobs/:id/cancel', (req, res) => {
      res.json({ data: this.operations.cancel(OperationsRoutes.id(req)) });
    });
  }

  private static id(req: Request): string {
    return String(req.params['id']);
  }
}
