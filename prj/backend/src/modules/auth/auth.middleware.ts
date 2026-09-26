import type { RequestHandler } from 'express';

import { HttpError } from '../../core/index.js';
import { sessionTokenOf } from './auth.routes.js';
import type { AuthService } from './auth.service.js';

/** Routes under the API prefix anyone may reach: signing in, and liveness. */
const PUBLIC_PREFIXES = ['/auth/', '/health'];

/**
 * Turns away every API request without a live session (PRD 003, §2), unless
 * signing in is switched off. Mounted on the API prefix ahead of every module,
 * so a module added later is protected without having to remember to be.
 */
export class SessionMiddleware {
  constructor(private readonly auth: AuthService) {}

  handle(): RequestHandler {
    return (req, _res, next) => {
      if (!this.auth.required || PUBLIC_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
        next();
        return;
      }
      if (this.auth.resolve(sessionTokenOf(req)) === null) {
        next(HttpError.unauthorized('Sign in to continue'));
        return;
      }
      next();
    };
  }
}
