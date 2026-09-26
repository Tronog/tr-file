import { Router, type Request } from 'express';

import { HttpError, asyncHandler, type RouteModule } from '../../core/index.js';
import type { AuthService } from './auth.service.js';

/** The session cookie. `HttpOnly` and `SameSite=Strict`: no script reads it, no other site sends it. */
export const SESSION_COOKIE = 'tr_file_session';

/** The session token a request carries, if any. */
export function sessionTokenOf(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (header === undefined) {
    return undefined;
  }
  for (const part of header.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === SESSION_COOKIE) {
      return decodeURIComponent(value.join('='));
    }
  }
  return undefined;
}

/**
 * HTTP surface of the `auth` module, mounted at `<apiPrefix>/auth`.
 *
 * `GET /session` is always answered — it is how the frontend learns whether to
 * show the sign-in screen. The two writes are `POST`s, so the CSRF check
 * covers them like every other write: nobody can sign a visitor in or out from
 * another site.
 */
export class AuthRoutes implements RouteModule {
  readonly basePath = '/auth';
  readonly router: Router;

  constructor(private readonly auth: AuthService) {
    this.router = Router();
    this.register();
  }

  private register(): void {
    this.router.get('/session', (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: this.auth.status(sessionTokenOf(req)) });
    });

    this.router.post(
      '/login',
      asyncHandler(async (req, res) => {
        const { username, password } = AuthRoutes.readCredentials(req);
        const token = await this.auth.signIn(username, password, req.ip ?? 'unknown');
        res.setHeader('Set-Cookie', AuthRoutes.cookie(req, token));
        res.setHeader('Cache-Control', 'no-store');
        res.json({ data: this.auth.status(token) });
      }),
    );

    this.router.post('/logout', (req, res) => {
      this.auth.signOut(sessionTokenOf(req));
      res.setHeader('Set-Cookie', AuthRoutes.cookie(req, '', 0));
      res.json({ data: this.auth.status(undefined) });
    });
  }

  /**
   * A browser-session cookie — gone when the browser closes — unless it is
   * being cleared. `Secure` whenever the request came over HTTPS, which behind
   * a proxy is what `X-Forwarded-Proto` says.
   */
  private static cookie(req: Request, token: string, maxAge?: number): string {
    return [
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      ...(req.secure ? ['Secure'] : []),
      ...(maxAge === undefined ? [] : [`Max-Age=${maxAge}`]),
    ].join('; ');
  }

  private static readCredentials(req: Request): { username: string; password: string } {
    const body = req.body as { username?: unknown; password?: unknown } | undefined;
    if (typeof body?.username !== 'string' || typeof body.password !== 'string') {
      throw HttpError.badRequest('Sign-in needs a username and a password');
    }
    return { username: body.username, password: body.password };
  }
}
