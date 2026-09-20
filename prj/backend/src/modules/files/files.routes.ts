import busboy from 'busboy';
import { Router, type Request, type Response } from 'express';
import type { Readable } from 'node:stream';

import { HttpError, asyncHandler, type Logger, type RouteModule } from '../../core/index.js';
import type { FilesService } from './files.service.js';
import type { FileDetails } from './models/index.js';

/** Name of the single multipart part carrying the uploaded file. */
const UPLOAD_FIELD = 'file';

/** Listener for events that must be observed but carry no useful action. */
const ignore = (): void => {};

/**
 * HTTP surface of the `files` module.
 *
 * Mounted at `<apiPrefix>/fs` rather than `/files`: PRD 001 §7 specifies the
 * file-system API as `/api/fs`. The module keeps its `files` name because it is
 * still about files; only the public route changes.
 */
export class FilesRoutes implements RouteModule {
  readonly basePath = '/fs';
  readonly router: Router;

  constructor(
    private readonly filesService: FilesService,
    private readonly logger: Logger,
  ) {
    this.router = Router();
    this.register();
  }

  private register(): void {
    // GET /api/fs/list?path=... — list the entries of a directory.
    this.router.get(
      '/list',
      asyncHandler(async (req, res) => {
        const listing = await this.filesService.listDirectory(FilesRoutes.readPath(req));
        res.json({ data: listing.toJSON() });
      }),
    );

    // GET /api/fs/details?path=... — full metadata for a single entry.
    this.router.get(
      '/details',
      asyncHandler(async (req, res) => {
        const details = await this.filesService.getDetails(FilesRoutes.readPath(req));
        res.json({ data: details.toJSON() });
      }),
    );

    // GET /api/fs/download?path=... — stream one file back as an attachment.
    this.router.get(
      '/download',
      asyncHandler(async (req, res) => {
        await this.sendDownload(req, res);
      }),
    );

    // POST /api/fs/upload?path=<dir>&overwrite=<bool> — store one file.
    this.router.post(
      '/upload',
      asyncHandler(async (req, res) => {
        const details = await this.receiveUpload(req);
        res.status(201).json({ data: details.toJSON() });
      }),
    );
  }

  private async sendDownload(req: Request, res: Response): Promise<void> {
    const target = await this.filesService.resolveDownload(FilesRoutes.readPath(req));

    res.setHeader('Content-Type', target.mimeType ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', FilesRoutes.contentDisposition(target.name));

    await new Promise<void>((resolve, reject) => {
      // `dotfiles: 'allow'` because hidden files are ordinary content here.
      res.sendFile(target.absolutePath, { dotfiles: 'allow', acceptRanges: true }, (error) => {
        if (error === undefined || error === null) {
          resolve();
          return;
        }
        if (res.headersSent) {
          // The client aborted or the socket broke mid-stream: nothing can be
          // reported any more, so log and settle instead of crashing.
          this.logger.debug('download interrupted', {
            path: target.name,
            reason: error instanceof Error ? error.message : String(error),
          });
          resolve();
          return;
        }
        reject(error);
      });
    });
  }

  /**
   * Parses the `multipart/form-data` body with busboy and hands the single
   * `file` part to the service as a stream, so nothing is ever buffered whole.
   */
  private async receiveUpload(req: Request): Promise<FileDetails> {
    const contentType = req.headers['content-type'];
    if (contentType === undefined || !contentType.toLowerCase().startsWith('multipart/form-data')) {
      throw HttpError.badRequest('Upload requires a multipart/form-data body');
    }

    const directoryPath = FilesRoutes.readPath(req);
    const overwrite = FilesRoutes.readOverwrite(req);
    // `express.json()` ignores non-JSON content types, so the raw request body
    // is still unread at this point and busboy receives every byte.
    const parser = busboy({ headers: req.headers });

    return new Promise<FileDetails>((resolve, reject) => {
      let settled = false;
      let accepted = false;

      const succeed = (details: FileDetails): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve(details);
      };
      const fail = (error: unknown): void => {
        if (settled) {
          return;
        }
        settled = true;
        // Stop feeding the parser, but leave it intact: destroying busboy
        // mid-part makes it emit on its in-flight file stream, which would
        // surface as an unhandled 'error' event.
        req.unpipe(parser);
        parser.removeAllListeners('file');
        parser.removeAllListeners('close');
        parser.removeAllListeners('error');
        parser.on('error', ignore);
        // Let the response flush before tearing down a connection that may
        // still be carrying an unwanted upload body.
        req.pause();
        req.res?.once('finish', () => req.destroy());
        reject(error);
      };

      parser.on('file', (fieldName, stream, info) => {
        if (accepted || settled) {
          FilesRoutes.discardPart(stream);
          fail(HttpError.badRequest('Only a single file part is supported'));
          return;
        }
        if (fieldName !== UPLOAD_FIELD) {
          FilesRoutes.discardPart(stream);
          fail(HttpError.badRequest(`Expected a file part named "${UPLOAD_FIELD}"`));
          return;
        }
        accepted = true;
        this.filesService
          .saveUpload({
            directoryPath,
            filename: info.filename ?? '',
            content: stream,
            overwrite,
          })
          .then(succeed, fail);
      });

      parser.on('error', fail);
      parser.on('close', () => {
        if (!accepted) {
          fail(HttpError.badRequest(`Missing file part "${UPLOAD_FIELD}"`));
        }
      });

      req.pipe(parser);
    });
  }

  /** Drains a part that is not going to be stored, swallowing its errors. */
  private static discardPart(stream: Readable): void {
    stream.on('error', ignore);
    stream.resume();
  }

  /**
   * `attachment` with both a sanitised ASCII fallback and the RFC 5987 form,
   * so non-ASCII names survive in modern clients without breaking old ones.
   */
  private static contentDisposition(name: string): string {
    const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
    const encoded = encodeURIComponent(name).replace(
      /['()*!]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
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

  /** Only the exact string `'true'` enables overwriting; see the API contract. */
  private static readOverwrite(req: Request): boolean {
    const value = req.query['overwrite'];
    if (value !== undefined && typeof value !== 'string') {
      throw HttpError.badRequest('Query parameter "overwrite" must be a single string value');
    }
    return value === 'true';
  }
}
