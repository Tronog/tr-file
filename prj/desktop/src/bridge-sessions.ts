import type { WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';

import {
  FileSystemBridge,
  type FsBridgeResponse,
  type FsBridgeSession,
  type FsSaveCopyOptions,
} from '@tr-file/backend/bridge';
import type { Logger } from '@tr-file/backend/core';

import { localFileName, looksLikeProgram, openTempRoot, type DesktopShell } from './desktop-shell.js';
import { RemoteBackend, type RemoteEndpoint } from './remote-backend.js';
import type { ClipboardFiles } from './system-clipboard.js';

/** The system clipboard's files (`SystemClipboard`); stubbed in tests. */
export interface FileClipboard {
  readFiles(): Promise<ClipboardFiles>;
  writeFiles(files: readonly string[], cut: boolean): Promise<void>;
}

/** What a window is known by: its id, and the event that ends it. */
export type WindowRef = Pick<WebContents, 'id' | 'once'>;

/** Where `BridgeSessions` keeps what it needs besides the backends; the defaults are the real machine. */
export interface BridgeSessionsOptions {
  /** Where remote files are copied to be opened here; see `openTempRoot`. */
  readonly tempRoot?: string;
  /** Which programs need asking about (`looksLikeProgram`). */
  readonly platform?: NodeJS.Platform;
  /** The system clipboard (PRD 003, §6); without one, the clipboard commands find no files. */
  readonly clipboard?: FileClipboard;
}

const failure = (code: string, status: number, message: string): FsBridgeResponse => ({ error: { code, message, status } });

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
 *
 * It also answers the two commands only a desktop has (PRD 003, §5):
 * `shell-open` hands an entry to the operating system's default app, and
 * `shell-reveal` shows it in the system file manager — through the injected
 * `DesktopShell`. A file that would *run* is asked about first, in a native
 * dialog, here in the main process where a page cannot answer for the user.
 * A remote file is copied to a temp folder on this computer first, and only a
 * file: a folder over there is nothing an app here can open.
 */
export class BridgeSessions {
  private readonly sessions = new Map<number, FsBridgeSession>();
  private readonly remotes = new Map<number, RemoteBackend>();
  private readonly tempRoot: string;
  private readonly platform: NodeJS.Platform;
  private readonly clipboard: FileClipboard | null;

  constructor(
    private readonly bridge: FileSystemBridge,
    private readonly logger: Logger,
    private readonly shell: DesktopShell | null = null,
    options: BridgeSessionsOptions = {},
  ) {
    this.tempRoot = options.tempRoot ?? openTempRoot();
    this.platform = options.platform ?? process.platform;
    this.clipboard = options.clipboard ?? null;
  }

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
   * `connect`, `disconnect`, `connection-status` — and the shell's —
   * `shell-open`, `shell-reveal` — are answered here; every other goes to
   * whichever backend the window is on. Never throws.
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
      case 'shell-open':
      case 'shell-reveal': {
        const path = (request as { path?: unknown }).path;
        if (typeof path !== 'string') {
          return failure('BAD_REQUEST', 400, 'Bridge request field "path" must be a string');
        }
        if (this.shell === null) {
          return failure('NOT_SUPPORTED', 400, 'There is no desktop shell to hand this to.');
        }
        try {
          return command === 'shell-open'
            ? await this.openWithApp(sender, path, this.shell)
            : await this.reveal(sender, path, this.shell);
        } catch (error) {
          this.logger.warn('shell command failed', {
            command,
            reason: error instanceof Error ? error.message : String(error),
          });
          return failure('OPEN_FAILED', 500, error instanceof Error ? error.message : String(error));
        }
      }
      case 'clipboard-read':
        return this.readClipboard(sender);
      case 'clipboard-write':
        return this.writeClipboard(sender, request as Record<string, unknown>);
      case 'local-paths': {
        const absolute = (request as { absolute?: unknown }).absolute;
        if (!Array.isArray(absolute) || !absolute.every((path): path is string => typeof path === 'string') || absolute.length > 10_000) {
          return failure('BAD_REQUEST', 400, 'Bridge request field "absolute" must be an array of paths');
        }
        if (this.remoteFor(sender) !== null) {
          return { data: absolute.map(() => null) }; // Nothing on this computer is on the server.
        }
        return this.bridge.fromLocalPaths(absolute, this.for(sender));
      }
      default: {
        const remote = this.remoteFor(sender);
        return remote === null ? this.bridge.dispatch(request, this.for(sender)) : remote.dispatch(request);
      }
    }
  }

  /**
   * The host paths of entries a window drags out to another app (PRD 003,
   * §6) — on this computer only; a remote file has no path here until it is
   * copied, and a drag cannot wait for that. Entries that are not there are
   * left out.
   */
  async dragFiles(sender: WindowRef, paths: unknown): Promise<string[]> {
    if (this.remoteFor(sender) !== null || !Array.isArray(paths) || paths.length > 10_000) {
      return [];
    }
    const located = await Promise.all(
      paths.filter((path): path is string => typeof path === 'string').map((path) => this.bridge.localPath(path, this.for(sender))),
    );
    return located.flatMap((answer) => ('data' in answer ? [answer.data.absolute] : []));
  }

  /**
   * `clipboard-read`: files on the system clipboard, as the root-relative
   * paths this window can paste (PRD 003, §6). `outside` counts those it
   * cannot reach: outside the root, or — for a window on a remote server —
   * all of them, since they are on this computer and not on the server.
   */
  private async readClipboard(sender: WindowRef): Promise<FsBridgeResponse> {
    const { files, cut } = (await this.clipboard?.readFiles()) ?? { files: [], cut: false };
    if (files.length === 0 || this.remoteFor(sender) !== null) {
      return { data: { paths: [], cut, outside: files.length } };
    }
    const located = await this.bridge.fromLocalPaths(files, this.for(sender));
    if ('error' in located) {
      return located;
    }
    const paths = located.data.filter((path): path is string => path !== null);
    return { data: { paths, cut, outside: files.length - paths.length } };
  }

  /**
   * `clipboard-write`: puts entries on the system clipboard, for the
   * system's file manager to paste — entries on this computer only.
   */
  private async writeClipboard(sender: WindowRef, request: Record<string, unknown>): Promise<FsBridgeResponse> {
    const { paths, cut } = request;
    if (!Array.isArray(paths) || !paths.every((path): path is string => typeof path === 'string')) {
      return failure('BAD_REQUEST', 400, 'Bridge request field "paths" must be an array of strings');
    }
    if (this.clipboard === null || this.remoteFor(sender) !== null) {
      return { data: { written: false } };
    }
    const files = await this.dragFiles(sender, paths);
    await this.clipboard.writeFiles(files, cut === true);
    return { data: { written: files.length > 0 } };
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

  /** Streams a zip of entries from the window's backend to a path the user chose (PRD 003, §6). */
  saveZip(
    sender: WindowRef,
    paths: readonly string[],
    destination: string,
    options: FsSaveCopyOptions,
  ): Promise<FsBridgeResponse<{ readonly bytes: number }>> {
    const remote = this.remoteFor(sender);
    return remote === null
      ? this.bridge.saveZip(paths, destination, options, this.for(sender))
      : remote.saveZip(paths, destination, options);
  }

  /** Removes the copies of remote files made to be opened here; best effort, on quit. */
  async cleanUp(): Promise<void> {
    await rm(this.tempRoot, { recursive: true, force: true }).catch(() => undefined);
  }

  /**
   * `shell-open`: the entry, with the system's default app. On this computer
   * that is the entry itself; on a remote server, a copy of the file streamed
   * to a temp folder here. A program is asked about first, and not opened if
   * the answer is anything but Run.
   */
  private async openWithApp(sender: WindowRef, path: string, shell: DesktopShell): Promise<FsBridgeResponse> {
    const remote = this.remoteFor(sender);
    let absolute: string;

    if (remote === null) {
      const located = await this.bridge.localPath(path, this.for(sender));
      if ('error' in located) {
        return located;
      }
      const { name, type, executable } = located.data;
      if (type !== 'file' && type !== 'directory') {
        return failure('BAD_REQUEST', 400, `'${name}' is neither a file nor a folder, so no app can open it.`);
      }
      // A folder opens in the file manager — unless it is a macOS app bundle, which runs.
      const program =
        type === 'file'
          ? looksLikeProgram(name, executable, this.platform)
          : this.platform !== 'win32' && extname(name).toLowerCase() === '.app';
      if (program && !(await shell.confirmRun(name))) {
        return { data: { opened: false } };
      }
      absolute = located.data.absolute;
    } else {
      const details = await remote.dispatch({ command: 'details', path });
      if ('error' in details) {
        return details;
      }
      const entry = details.data as { type?: unknown; targetType?: unknown };
      if (entry.type === 'directory' || (entry.type === 'symlink' && entry.targetType === 'directory')) {
        return failure('NOT_SUPPORTED', 400, 'Only files on a remote server can be opened with an app on this computer.');
      }
      const name = localFileName(path);
      if (looksLikeProgram(name, false, this.platform) && !(await shell.confirmRun(name))) {
        return { data: { opened: false } };
      }
      const folder = join(this.tempRoot, randomUUID());
      await mkdir(folder, { recursive: true });
      absolute = join(folder, name);
      const saved = await remote.saveCopy(path, absolute);
      if ('error' in saved) {
        await rm(folder, { recursive: true, force: true });
        return saved;
      }
    }

    const reason = await shell.openPath(absolute);
    if (reason !== '') {
      return failure('OPEN_FAILED', 500, reason);
    }
    return { data: { opened: true } };
  }

  /** `shell-reveal`: the entry, selected in the system file manager — this computer only. */
  private async reveal(sender: WindowRef, path: string, shell: DesktopShell): Promise<FsBridgeResponse> {
    if (this.remoteFor(sender) !== null) {
      return failure('NOT_SUPPORTED', 400, 'Show in Folder works for files on this computer only.');
    }
    const located = await this.bridge.localPath(path, this.for(sender));
    if ('error' in located) {
      return located;
    }
    shell.showItemInFolder(located.data.absolute);
    return { data: { revealed: true } };
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
