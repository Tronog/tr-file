import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';

import type { Logger } from '../logger.js';
import { HttpError } from '../http/http-error.js';

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/** Centralised error handler: the single place that turns errors into responses. */
export class ErrorMiddleware {
  constructor(
    private readonly logger: Logger,
    private readonly exposeStack: boolean,
  ) {}

  handle(): ErrorRequestHandler {
    return (err: unknown, req: Request, res: Response, next: NextFunction): void => {
      if (res.headersSent) {
        next(err);
        return;
      }

      const httpError = ErrorMiddleware.normalize(err);
      const context = {
        method: req.method,
        url: req.originalUrl,
        status: httpError.status,
        code: httpError.code,
        ...(this.exposeStack ? { stack: httpError.stack } : {}),
      };

      if (httpError.status >= 500) {
        this.logger.error(httpError.message, context);
      } else {
        this.logger.warn(httpError.message, context);
      }

      const body: ErrorResponseBody = {
        error: {
          code: httpError.code,
          message:
            httpError.status >= 500 && !this.exposeStack
              ? 'Internal Server Error'
              : httpError.message,
          ...(httpError.details === undefined ? {} : { details: httpError.details }),
        },
      };

      res.status(httpError.status).json(body);
    };
  }

  private static normalize(err: unknown): HttpError {
    if (err instanceof HttpError) {
      return err;
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return HttpError.badRequest('Malformed JSON payload');
    }
    if (err instanceof Error) {
      const wrapped = HttpError.internal(err.message);
      if (err.stack !== undefined) {
        wrapped.stack = err.stack;
      }
      return wrapped;
    }
    return HttpError.internal();
  }
}
