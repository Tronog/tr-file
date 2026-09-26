import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import type { AuthCredentials } from '../../config/index.js';
import { HttpError, type Logger } from '../../core/index.js';
import type { AuthStatusDto } from './auth.model.js';
import { hashPassword, isPasswordHash, verifyPassword } from './password-hash.js';

/** Failed sign-ins one client may make in a window before it is made to wait. */
const MAX_FAILURES_PER_CLIENT = 5;
/** Failed sign-ins from everyone together — a client can lie about who it is. */
const MAX_FAILURES_OVERALL = 50;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

interface Session {
  readonly username: string;
  expiresAt: number;
}

interface Failures {
  count: number;
  firstAt: number;
}

/**
 * Signing in (PRD 003, §2): one configured account, sessions held in memory.
 *
 * A session is a random 256-bit token the HTTP side keeps in an `HttpOnly`
 * cookie. It lives until it has not been used for `idleMs`, until sign-out,
 * or until the server restarts — this is one person's file manager, not a
 * cluster, and a restart asking to sign in again is a fair price for keeping
 * no session state on disk.
 *
 * Wrong passwords are throttled per client and overall, so guessing is slow
 * even for a client that forges where it comes from.
 */
export class AuthService {
  private readonly sessions = new Map<string, Session>();
  private readonly failures = new Map<string, Failures>();
  /** The configured password, hashed once at start-up and only ever compared hashed. */
  private readonly passwordHash: Promise<string> | null;

  constructor(
    private readonly credentials: AuthCredentials | null,
    private readonly idleMs: number,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {
    if (credentials?.passwordHash !== undefined && !isPasswordHash(credentials.passwordHash)) {
      throw new Error('AUTH_PASSWORD_HASH is not a hash this server can read; make one with `pnpm hash-password`.');
    }
    this.passwordHash =
      credentials === null
        ? null
        : credentials.passwordHash !== undefined
          ? Promise.resolve(credentials.passwordHash)
          : hashPassword(credentials.password ?? '');
  }

  /** Whether anyone has to sign in at all. */
  get required(): boolean {
    return this.credentials !== null;
  }

  /** What a caller holding `token` (or nothing) may do. */
  status(token: string | undefined): AuthStatusDto {
    if (!this.required) {
      return { required: false, authenticated: true, username: null };
    }
    const username = this.resolve(token);
    return { required: true, authenticated: username !== null, username };
  }

  /**
   * Checks a username and password and opens a session for them. `client`
   * names who is asking, for throttling. Rejects with `401` for anything
   * wrong — without saying which of the two was — and `429` for a client
   * that has been wrong too often lately.
   */
  async signIn(username: string, password: string, client: string): Promise<string> {
    const credentials = this.credentials;
    if (credentials === null || this.passwordHash === null) {
      throw HttpError.badRequest('This server does not ask anyone to sign in');
    }
    this.assertNotThrottled(client);

    const encoded = await this.passwordHash;
    // Both checks always run, so a wrong username costs what a wrong password does.
    const userMatches = AuthService.sameText(username, credentials.username);
    const passwordMatches = await verifyPassword(password, encoded);

    if (!userMatches || !passwordMatches) {
      this.recordFailure(client);
      this.logger.warn('sign-in refused', { client });
      throw HttpError.unauthorized('Wrong username or password');
    }

    this.failures.delete(client);
    this.pruneSessions();
    const token = randomBytes(32).toString('base64url');
    this.sessions.set(token, { username: credentials.username, expiresAt: this.now() + this.idleMs });
    this.logger.info('signed in', { username: credentials.username, client });
    return token;
  }

  /**
   * Who `token` belongs to, or `null` for a missing, unknown or idle one.
   * Using a session keeps it alive.
   */
  resolve(token: string | undefined): string | null {
    if (token === undefined || token === '') {
      return null;
    }
    const session = this.sessions.get(token);
    if (session === undefined) {
      return null;
    }
    if (session.expiresAt <= this.now()) {
      this.sessions.delete(token);
      return null;
    }
    session.expiresAt = this.now() + this.idleMs;
    return session.username;
  }

  /** Ends a session. Unknown tokens are ignored: signing out twice is fine. */
  signOut(token: string | undefined): void {
    if (token !== undefined) {
      this.sessions.delete(token);
    }
  }

  private assertNotThrottled(client: string): void {
    const now = this.now();
    for (const [key, limit] of [
      [client, MAX_FAILURES_PER_CLIENT],
      ['*', MAX_FAILURES_OVERALL],
    ] as const) {
      const record = this.failures.get(key);
      if (record === undefined) {
        continue;
      }
      if (now - record.firstAt >= FAILURE_WINDOW_MS) {
        this.failures.delete(key);
      } else if (record.count >= limit) {
        const retryAfter = Math.ceil((record.firstAt + FAILURE_WINDOW_MS - now) / 1000);
        throw HttpError.tooManyRequests('Too many failed sign-ins; try again later', { retryAfter });
      }
    }
  }

  private recordFailure(client: string): void {
    const now = this.now();
    for (const key of [client, '*']) {
      const record = this.failures.get(key);
      if (record === undefined || now - record.firstAt >= FAILURE_WINDOW_MS) {
        this.failures.set(key, { count: 1, firstAt: now });
      } else {
        record.count += 1;
      }
    }
  }

  private pruneSessions(): void {
    const now = this.now();
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(token);
      }
    }
  }

  /** Equal text, compared in time that does not depend on where they differ. */
  private static sameText(a: string, b: string): boolean {
    const digest = (value: string): Buffer => createHash('sha256').update(value).digest();
    return timingSafeEqual(digest(a), digest(b));
  }
}
