import type { WebContents } from 'electron';

import {
  FileSystemBridge,
  type FsBridgeResponse,
  type FsBridgeSession,
  type FsSaveCopyOptions,
} from '@tr-file/backend/bridge';
import type { Logger } from '@tr-file/backend/core';

import { RemoteBackend, type RemoteEndpoint } from './remote-backend.js';

/** What a window is known by: its id, and the event that ends it. */
export type WindowRef = Pick<WebContents, 'id' | 'once'>;

/**
 * Each window's way to the file system: who is signed in (PRD 003, §2), and
 * which backend its commands go to (PRD 006, §1).
 *
 * A window talks to the local backend — the `FileSystemBridge` this process
 * runs — until it connects to a remote tr-file server; from then on its
 * commands go to that server's REST API through a `RemoteBackend`, until it
 * disconnects. A reload keeps the connection, which is how a window starts
 * over against the server it just connected to; a window that closes takes
 * its session and its connection with it.
 *
 * Both IPC channels that reach the file system — commands and saves — go
 * through here, so signing in once is signing in for both, and neither can
 * reach the wrong backend. Nothing here imports `electron` at run time, so all
 * of it is tested without a desktop session.
 */
export class BridgeSessions {
  private readonly sessions = new Map<number, FsBridgeSession>();
  private readonly remotes = new Map<number, RemoteBackend>();

  constructor(
    private readonly bridge: FileSystemBridge,
    private readonly logger: Logger,
  ) {}

  /** The local session of `sender`'s window; a new window starts signed out. */
  for(sender: WindowRef): FsBridgeSession {
    let session = this.sessions.get(sender.id);
    if (session === undefined) {
      session = FileSystemBridge.openSession();
      this.sessions.set(sender.id, session);
      const id = sender.id;
      sender.once('destroyed', () => {
        this.sessions.delete(id);
        this.remotes.get(id)?.dispose();
        this.remotes.delete(id);
      });
    }
    return session;
  }

  /** The remote server `sender`'s window is connected to, or `null` for the local backend. */
  remoteFor(sender: WindowRef): RemoteBackend | null {
    return this.remotes.get(sender.id) ?? null;
  }

  /**
   * Runs one command for `sender`'s window. The connection commands —
   * `connect`, `disconnect`, `connection-status` — are answered here; every
   * other goes to whichever backend the window is on. Never throws.
   */
  async dispatch(sender: WindowRef, request: unknown): Promise<FsBridgeResponse> {
    const command = typeof request === 'object' && request !== null ? (request as { command?: unknown }).command : undefined;
    switch (command) {
      case 'connection-status': {
        const remote = this.remoteFor(sender);
        return { data: remote === null ? { connected: false } : remote.info };
      }
      case 'disconnect':
        this.setRemote(sender, null);
        return { data: { connected: false } };
      case 'connect':
        return this.connect(sender, request as Record<string, unknown>);
      default: {
        const remote = this.remoteFor(sender);
        return remote === null ? this.bridge.dispatch(request, this.for(sender)) : remote.dispatch(request);
      }
    }
  }

  /** Whether `sender`'s window may use the file system right now, on whichever backend it is on. */
  async authenticated(sender: WindowRef): Promise<boolean> {
    const status = await this.dispatch(sender, { command: 'auth-status' });
    return 'data' in status && (status.data as { authenticated: boolean }).authenticated;
  }

  /** Streams a file from the window's backend to a path the user chose. */
  saveCopy(
    sender: WindowRef,
    path: string,
    destination: string,
    options: FsSaveCopyOptions,
  ): Promise<FsBridgeResponse<{ readonly bytes: number }>> {
    const remote = this.remoteFor(sender);
    return remote === null
      ? this.bridge.saveCopy(path, destination, options, this.for(sender))
      : remote.saveCopy(path, destination, options);
  }

  /**
   * Connects the window to a remote server. The password signs in once and is
   * not kept here either; a failure leaves the window where it was.
   */
  private async connect(sender: WindowRef, request: Record<string, unknown>): Promise<FsBridgeResponse> {
    const endpoint = BridgeSessions.endpoint(request);
    if (endpoint === null) {
      return {
        error: {
          code: 'BAD_REQUEST',
          message: 'A connection needs a host, a port from 1 to 65535, and http or https',
          status: 400,
        },
      };
    }
    const remote = await RemoteBackend.connect(endpoint, this.logger);
    if (!(remote instanceof RemoteBackend)) {
      return remote;
    }
    this.setRemote(sender, remote);
    return { data: remote.info };
  }

  private setRemote(sender: WindowRef, remote: RemoteBackend | null): void {
    this.remotes.get(sender.id)?.dispose();
    if (remote === null) {
      this.remotes.delete(sender.id);
      return;
    }
    this.remotes.set(sender.id, remote);
    this.for(sender);
  }

  /** A remote server's address, checked as the untrusted input it is, or `null`. */
  private static endpoint(value: Record<string, unknown>): RemoteEndpoint | null {
    const { scheme, host, port, user, password } = value;
    const hostOk =
      typeof host === 'string' &&
      host !== '' &&
      // Nothing that could change where the URL goes: no path, query, fragment or credentials.
      !/[\s/?#@\\]/.test(host);
    if (
      (scheme !== 'http' && scheme !== 'https') ||
      !hostOk ||
      typeof port !== 'number' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535 ||
      (user !== null && user !== undefined && typeof user !== 'string') ||
      (password !== null && password !== undefined && typeof password !== 'string')
    ) {
      return null;
    }
    return {
      scheme,
      host: host.replace(/^\[(.*)\]$/, '$1'),
      port,
      user: typeof user === 'string' && user !== '' ? user : null,
      password: typeof password === 'string' ? password : null,
    };
  }
}
