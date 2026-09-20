import { Router, type Request } from 'express';

import { HttpError, asyncHandler, type RouteModule } from '../../core/index.js';
import type { FilesService } from './files.service.js';

/** HTTP surface of the `files` module, mounted at `<apiPrefix>/files`. */
export class FilesRoutes implements RouteModule {
  readonly basePath = '/files';
  readonly router: Router;

  constructor(private readonly filesService: FilesService) {
    this.router = Router();
    this.register();
  }

  private register(): void {
    // GET /api/files/stat?path=... — metadata for a single entry.
    this.router.get(
      '/stat',
      asyncHandler(async (req, res) => {
        const entry = await this.filesService.statEntry(FilesRoutes.readPath(req));
        res.json({ data: entry.toJSON() });
      }),
    );

    // GET /api/files?path=... — list the entries of a directory.
    this.router.get(
      '/',
      asyncHandler(async (req, res) => {
        const listing = await this.filesService.listDirectory(FilesRoutes.readPath(req));
        res.json({ data: listing.toJSON() });
      }),
    );
  }

  private static readPath(req: Request): string | undefined {
    const value = req.query['path'];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw HttpError.badRequest('Query parameter "path" must be a single string value');
    }
    return value;
  }
}
