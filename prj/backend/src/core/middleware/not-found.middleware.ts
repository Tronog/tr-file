import type { RequestHandler } from 'express';

import { HttpError } from '../http/http-error.js';

/** Terminal middleware converting unmatched routes into a 404 HttpError. */
export class NotFoundMiddleware {
  handle(): RequestHandler {
    return (req, _res, next) => {
      next(HttpError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
    };
  }
}
