import { Service, computed, inject, signal } from '@angular/core';
import { FsBridgeService, type RemoteConnectionStatus, type RemoteServerAddress } from './fs-bridge.service';
import { FsError } from './fs-error';

/**
 * Which backend this window talks to (PRD 006, §1): its own — the desktop's
 * built-in one, or the server that served the page — or a remote tr-file
 * server, reached over its REST API.
 *
 * Only the desktop app can connect to a remote server: the connection lives
 * in its main process, which can speak to another origin where a page cannot
 * (CORS, the `SameSite=Strict` session cookie, the CSRF check). A window that
 * connects or disconnects starts over — `reload` — so every listing, preview
 * and panel is read afresh from the backend it now has; the main process keeps
 * the connection across the reload.
 */
@Service()
export class RemoteConnectionService {
  private readonly bridge = inject(FsBridgeService);
  private readonly state = signal<RemoteConnectionStatus>({ connected: false });

  readonly status = this.state.asReadonly();

  /** Whether this window can connect to a remote server at all — the desktop app. */
  get available(): boolean {
    return this.bridge.isAvailable;
  }

  readonly connected = computed(() => this.state().connected);

  /** `user@host:port` of the remote server, or `null` when on the local backend. */
  readonly label = computed(() => {
    const status = this.state();
    if (!status.connected) {
      return null;
    }
    const scheme = status.scheme === 'https' && status.port !== 443 ? 'https://' : '';
    return `${scheme}${status.user === null ? '' : `${status.user}@`}${status.host}:${status.port}`;
  });

  /** Asks the main process where this window is connected. Called once, on start. */
  async load(): Promise<void> {
    if (!this.available) {
      return;
    }
    try {
      this.state.set(await this.bridge.connectionStatus());
    } catch {
      this.state.set({ connected: false });
    }
  }

  /**
   * Connects this window's commands to a remote server. Resolves with why
   * not, if it could not; the caller then starts the window over with
   * `reload`, once it has done what it wants to first (keep the server).
   */
  async connect(target: RemoteServerAddress): Promise<string | null> {
    if (!this.available) {
      return 'Connecting to a remote server needs the tr-file desktop app.';
    }
    try {
      this.state.set(await this.bridge.connect(target));
    } catch (error) {
      const failure = FsError.from(error);
      switch (failure.code) {
        case 'UNAUTHORIZED':
          return `Wrong username or password for ${target.host}:${target.port}.`;
        case 'NETWORK_ERROR':
        case 'NOT_A_SERVER':
          return failure.message;
        default:
          return `${target.host}:${target.port} refused the connection: ${failure.message}`;
      }
    }
    return null;
  }

  /** Back to this computer's backend, then starts the window over. */
  async disconnect(): Promise<void> {
    if (!this.available || !this.state().connected) {
      return;
    }
    this.state.set(await this.bridge.disconnect());
    this.reload();
  }

  /** Starts the window over; a seam, so tests can watch it instead. */
  reload(): void {
    globalThis.location?.reload();
  }
}
