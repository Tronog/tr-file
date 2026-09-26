import type { Request, RequestHandler } from 'express';

import { HttpError } from '../http/http-error.js';

/**
 * The header every state-changing API request must carry (PRD 003, §2).
 *
 * A page on another site can make a browser send a `POST` — a form, or a
 * `fetch` in `no-cors` mode — but only a "simple" one: it cannot add a custom
 * header without a CORS preflight, and this server answers no preflight. So a
 * request that carries this header was sent by our own frontend (or by a
 * deliberate API client), never by a page a user merely visited.
 */
export const CSRF_HEADER = 'x-tr-file-request';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cross-site request forgery protection for every write under the API prefix
 * — uploads today, delete and move tomorrow — whether signing in is on or not.
 *
 * Three checks, each enough on its own in a modern browser, together because
 * no one of them covers every browser and proxy:
 *
 * 1. the custom header above must be present;
 * 2. `Sec-Fetch-Site`, when the browser sends it, must say the request came
 *    from this origin;
 * 3. `Origin`, when present, must name this host.
 *
 * Reads are left alone: another site cannot read a response it is not allowed
 * to by CORS, and the session cookie is `SameSite=Strict` besides.
 */
export class CsrfMiddleware {
  handle(): RequestHandler {
    return (req, _res, next) => {
      if (SAFE_METHODS.has(req.method)) {
        next();
        return;
      }

      const reason = CsrfMiddleware.reject(req);
      next(reason === null ? undefined : new HttpError(403, 'CSRF_REJECTED', reason));
    };
  }

  /** Why a write is refused, or `null` when it may proceed. */
  private static reject(req: Request): string | null {
    if (req.get(CSRF_HEADER) !== '1') {
      return `Write requests must carry the ${CSRF_HEADER} header`;
    }

    const site = req.get('sec-fetch-site');
    if (site !== undefined && site !== 'same-origin' && site !== 'none') {
      return 'Cross-site write requests are refused';
    }

    const origin = req.get('origin');
    if (origin !== undefined && origin !== 'null') {
      let host: string;
      try {
        host = new URL(origin).host;
      } catch {
        return 'Unreadable Origin header';
      }
      if (host !== req.get('host')) {
        return 'Cross-origin write requests are refused';
      }
    } else if (origin === 'null') {
      return 'Write requests from an opaque origin are refused';
    }

    return null;
  }
}
