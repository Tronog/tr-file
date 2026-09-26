import { computed, signal } from '@angular/core';
import type { RemoteTarget } from '../command-palette/remote-target';

/** Where the list lives in `localStorage`; the suffix is its format's version. */
export const SAVED_SERVERS_KEY = 'tr-file.remote-servers.v1';

/**
 * A remote server the user has connected to, or added (PRD 009, §1). Never
 * its password: `localStorage` is plain text any script on the page can read,
 * so a password is asked for when connecting — as VS Code does for SSH hosts.
 */
export interface SavedServer {
  readonly id: string;
  /** Absent in lists saved before it existed, which were all plain HTTP (or HTTPS on 443). */
  readonly scheme?: 'http' | 'https';
  readonly user: string | null;
  readonly host: string;
  readonly port: number;
  /** Epoch milliseconds. */
  readonly addedAt: number;
  readonly lastUsedAt: number | null;
}

/**
 * The remote servers kept on this machine (PRD 009, §1): the list *Connect to
 * Remote Server* offers, with adding, editing and removing.
 *
 * Kept in `localStorage`, read once and written on every change. Storage that
 * is missing, full or refused — a private window, a policy — only means
 * nothing is remembered; the list still works for the session.
 */
export class SavedServersFeature {
  private readonly list = signal<readonly SavedServer[]>(SavedServersFeature.load());

  /** Most recently used first, then most recently added. */
  readonly servers = computed(() =>
    [...this.list()].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || b.addedAt - a.addedAt),
  );

  constructor(private readonly now: () => number = () => Date.now()) {}

  find(id: string): SavedServer | undefined {
    return this.list().find((server) => server.id === id);
  }

  /**
   * Keeps `target` — or, when the same user, host and port are kept already,
   * returns that entry — and marks it used. The password is dropped.
   */
  use(target: RemoteTarget): SavedServer {
    const existing = this.list().find((server) => SavedServersFeature.same(server, target));
    if (existing !== undefined) {
      return this.touch(existing.id) ?? existing;
    }
    const time = this.now();
    const server: SavedServer = {
      id: `server-${time.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      scheme: target.scheme,
      user: target.user,
      host: target.host,
      port: target.port,
      addedAt: time,
      lastUsedAt: time,
    };
    this.save([...this.list(), server]);
    return server;
  }

  /** Marks a server used now, which moves it to the top. */
  touch(id: string): SavedServer | undefined {
    let touched: SavedServer | undefined;
    this.save(
      this.list().map((server) => (server.id === id ? (touched = { ...server, lastUsedAt: this.now() }) : server)),
    );
    return touched;
  }

  /**
   * Replaces a server's address. Editing it into one that is kept already
   * merges the two, rather than keeping the same server twice.
   */
  update(id: string, target: RemoteTarget): void {
    const duplicate = this.list().find((server) => server.id !== id && SavedServersFeature.same(server, target));
    const list = duplicate === undefined ? this.list() : this.list().filter((server) => server.id !== duplicate.id);
    this.save(
      list.map((server) =>
        server.id === id ? { ...server, scheme: target.scheme, user: target.user, host: target.host, port: target.port } : server,
      ),
    );
  }

  remove(id: string): void {
    this.save(this.list().filter((server) => server.id !== id));
  }

  private save(list: readonly SavedServer[]): void {
    this.list.set(list);
    try {
      localStorage.setItem(SAVED_SERVERS_KEY, JSON.stringify(list));
    } catch {
      // Not remembered past this session; nothing else is lost.
    }
  }

  private static same(server: SavedServer, target: RemoteTarget): boolean {
    return (
      (server.scheme ?? (server.port === 443 ? 'https' : 'http')) === target.scheme &&
      server.user === target.user &&
      server.host.toLowerCase() === target.host.toLowerCase() &&
      server.port === target.port
    );
  }

  /** What storage holds, keeping only entries that are still well formed. */
  private static load(): readonly SavedServer[] {
    let raw: string | null;
    try {
      raw = localStorage.getItem(SAVED_SERVERS_KEY);
    } catch {
      return [];
    }
    if (raw === null) {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(SavedServersFeature.isServer) : [];
    } catch {
      return [];
    }
  }

  private static isServer(value: unknown): value is SavedServer {
    if (typeof value !== 'object' || value === null) {
      return false;
    }
    const server = value as Record<string, unknown>;
    return (
      typeof server['id'] === 'string' &&
      (server['scheme'] === undefined || server['scheme'] === 'http' || server['scheme'] === 'https') &&
      (server['user'] === null || typeof server['user'] === 'string') &&
      typeof server['host'] === 'string' &&
      Number.isInteger(server['port']) &&
      typeof server['addedAt'] === 'number' &&
      (server['lastUsedAt'] === null || typeof server['lastUsedAt'] === 'number')
    );
  }
}
