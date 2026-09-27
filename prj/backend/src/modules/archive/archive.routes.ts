import { Router, type Request } from 'express';

import { HttpError, asyncHandler, type Logger, type RouteModule } from '../../core/index.js';
import { FilesRoutes } from '../files/index.js';
import type { ArchiveService } from './archive.service.js';

/**
 * HTTP surface of the `archive` module (PRD 003, §6), at `<apiPrefix>/archive`.
 * Compress and extract are jobs, and live with the others at `/api/ops`.
 */
export class ArchiveRoutes implements RouteModule {
  readonly basePath = '/archive';
  readonly router: Router;

  constructor(
    private readonly archives: ArchiveService,
    private readonly logger: Logger,
  ) {
    this.router = Router();
    this.register();
  }

  private register(): void {
    // GET /api/archive/list?path=&inner= — one folder of a zip.
    this.router.get(
      '/list',
      asyncHandler(async (req, res) => {
        res.json({ data: await this.archives.list(ArchiveRoutes.readString(req, 'path'), ArchiveRoutes.readString(req, 'inner')) });
      }),
    );

    // GET /api/archive/zip?path=a&path=b[&name=] — the entries, as one zip, streamed:
    // how a folder, or a selection, is downloaded.
    this.router.get(
      '/zip',
      asyncHandler(async (req, res) => {
        const zip = await this.archives.zipSources(ArchiveRoutes.readPaths(req));
        const name = ArchiveRoutes.readString(req, 'name') ?? zip.suggestedName;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', FilesRoutes.contentDisposition(name, 'attachment'));
        // Nothing is known of the size until it is written: chunked, and no range.
        const aborted = new AbortController();
        res.once('close', () => {
          if (!res.writableFinished) {
            aborted.abort();
          }
        });
        try {
          await this.archives.writeZip(zip, res, { signal: aborted.signal });
        } catch (error) {
          if (!res.headersSent) {
            throw error;
          }
          // Half a zip has gone out: all that can be said now is that it broke.
          this.logger.debug('zip download interrupted', { reason: error instanceof Error ? error.message : String(error) });
          res.destroy();
        }
      }),
    );
  }

  private static readString(req: Request, name: string): string | undefined {
    const value = req.query[name];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string') {
      throw HttpError.badRequest(`Query parameter "${name}" must be a single string value`);
    }
    return value;
  }

  private static readPaths(req: Request): string[] {
    const value = req.query['path'];
    const paths = typeof value === 'string' ? [value] : value;
    if (!Array.isArray(paths) || !paths.every((path): path is string => typeof path === 'string')) {
      throw HttpError.badRequest('Name at least one "path" to zip');
    }
    return paths;
  }
}
