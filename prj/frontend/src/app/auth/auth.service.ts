import { Service, computed, effect, inject, signal, untracked } from '@angular/core';
import { FileSystemService } from '../file-system/file-system.service';
import { FsError } from '../file-system/fs-error';
import { SessionExpiryService } from './session-expiry.service';

/**
 * What the app shows: nothing yet, the sign-in screen, or the workbench.
 *
 * - `checking` — asking the backend whether it wants a sign-in.
 * - `signed-out` — it does, and there is no session.
 * - `signed-in` — there is one.
 * - `open` — it asks nobody to sign in (the desktop's default).
 * - `unreachable` — the backend could not be asked at all.
 */
export type AuthView = 'checking' | 'signed-out' | 'signed-in' | 'open' | 'unreachable';

/**
 * Signing in (PRD 003, §2), for whichever transport this session uses.
 *
 * The workbench is only built once this says so, so nothing asks for a
 * listing before there is a session; and when a request is refused later for
 * want of one, the app goes back to the sign-in screen rather than showing
 * the refusal in every panel.
 */
@Service()
export class AuthService {
  private readonly fileSystem = inject(FileSystemService);
  private readonly expiry = inject(SessionExpiryService);

  private readonly state = signal<AuthView>('checking');
  private readonly user = signal<string | null>(null);
  private readonly failure = signal<string | null>(null);
  private readonly pending = signal(false);

  readonly view = this.state.asReadonly();
  readonly username = this.user.asReadonly();
  /** Why the last sign-in failed, or why the session ended. */
  readonly error = this.failure.asReadonly();
  /** A sign-in is in flight. */
  readonly busy = this.pending.asReadonly();

  /** Whether a session can be ended — there is one, and the backend wants one. */
  readonly canSignOut = computed(() => this.state() === 'signed-in');

  constructor() {
    effect(() => {
      if (this.expiry.expired() === 0) {
        return;
      }
      untracked(() => {
        if (this.state() === 'signed-in') {
          this.failure.set('Your session has ended. Sign in again to continue.');
          this.state.set('signed-out');
          this.user.set(null);
        }
      });
    });
  }

  /** Asks the backend where this session stands. Called once, on start. */
  async start(): Promise<void> {
    this.state.set('checking');
    try {
      const status = await this.fileSystem.transport.authStatus();
      this.user.set(status.username);
      this.state.set(!status.required ? 'open' : status.authenticated ? 'signed-in' : 'signed-out');
    } catch (error) {
      this.failure.set(FsError.from(error).message);
      this.state.set('unreachable');
    }
  }

  /** Resolves `true` when signed in; otherwise `error` says why not. */
  async signIn(username: string, password: string): Promise<boolean> {
    this.pending.set(true);
    this.failure.set(null);
    try {
      const status = await this.fileSystem.transport.login(username, password);
      this.user.set(status.username);
      this.state.set('signed-in');
      return true;
    } catch (error) {
      const failure = FsError.from(error);
      this.failure.set(
        failure.code === 'UNAUTHORIZED'
          ? 'Wrong username or password.'
          : failure.code === 'TOO_MANY_REQUESTS'
            ? 'Too many failed attempts. Wait a few minutes and try again.'
            : failure.message,
      );
      return false;
    } finally {
      this.pending.set(false);
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.fileSystem.transport.logout();
    } finally {
      this.failure.set(null);
      this.user.set(null);
      this.state.set('signed-out');
    }
  }
}
