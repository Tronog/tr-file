import { Service, signal } from '@angular/core';

/**
 * Where a transport reports that the backend refused a request for want of a
 * session — it expired, the server restarted, someone signed out elsewhere.
 *
 * A service of its own so the transports can report without knowing who
 * listens, and `AuthService`, which uses the transports, can listen without a
 * circular dependency.
 */
@Service()
export class SessionExpiryService {
  private readonly count = signal(0);

  /** Changes every time a request is refused; `AuthService` watches it. */
  readonly expired = this.count.asReadonly();

  report(): void {
    this.count.update((count) => count + 1);
  }
}
