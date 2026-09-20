import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

import type { Logger } from '../logger.js';

/** Assigns a request id and logs completion with duration and status. */
export class RequestLoggerMiddleware {
  constructor(private readonly logger: Logger) {}

  handle(): RequestHandler {
    return (req, res, next) => {
      const requestId = req.get('x-request-id') ?? randomUUID();
      req.id = requestId;
      res.setHeader('x-request-id', requestId);

      const startedAt = process.hrtime.bigint();
      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        this.logger.info('request', {
          requestId,
          method: req.method,
          url: req.originalUrl,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 1000) / 1000,
        });
      });

      next();
    };
  }
}
