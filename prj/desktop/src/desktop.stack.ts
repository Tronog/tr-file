import { createServer, type Server as HttpServer } from 'node:http';
import { join } from 'node:path';

import { App } from '@tr-file/backend/app';
import type { FileSystemBridge } from '@tr-file/backend/bridge';
import { AppConfig } from '@tr-file/backend/config';
import { Logger } from '@tr-file/backend/core';
import type { PlacesProvider } from '@tr-file/backend/files';
import type { TrashProvider } from '@tr-file/backend/operations';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import type { DesktopConfig } from './desktop.config.js';

/** Reported by the health endpoint and the window title. */
const VERSION = process.env['npm_package_version'] ?? '0.1.1';

/**
 * The whole stack, in one process (PRD 001, Section 8).
 *
 * In Docker the two halves are separate containers with nginx in front
 * (`prj/docker/nginx/default.conf`); on the desktop there is no room for a
 * third process, so this class stands in for that nginx: one loopback HTTP
 * server that serves the Angular bundle and falls back to `index.html` for the
 * router's deep links. The backend is not spawned — it is constructed, which
 * is why a crash in it is a rejected promise here rather than a dead child
 * nobody notices.
 *
 * It serves **no API** (PRD 003, §2). The window reaches the backend over the
 * IPC bridge (`bridge`), so the HTTP API would only have been a way in for
 * everyone else: any local program, or a web page that found the port, could
 * have read and written the user's files. `/api` answers 404, and a request
 * whose `Host` is not this server's own loopback address — a DNS-rebinding
 * page — is refused before anything is served.
 *
 * Two things follow from running on loopback with an OS-assigned port: no
 * other machine can reach it, and no two copies of the app can collide over a
 * port. Neither is an accident.
 */
export class DesktopStack {
  private server: HttpServer | null = null;
  private url: URL | null = null;
  private api: App | null = null;

  private readonly logger: Logger;

  /**
   * @param trash The system trash for a files root (PRD 005, §1). `main.ts`
   *   passes the shell's; without one — in tests — the backend keeps its own.
   * @param places The home folder, the user's folders and the mounts
   *   (PRD 003, §6); without them the root is the only place.
   */
  constructor(
    private readonly config: DesktopConfig,
    logger?: Logger,
    private readonly trash?: (filesRoot: string) => TrashProvider,
    private readonly places?: PlacesProvider,
  ) {
    this.logger =
      logger ??
      Logger.create(config.development ? 'debug' : 'info', { service: 'tr-file-desktop' });
  }

  /** The logger the shell and everything it wires up should report through. */
  get log(): Logger {
    return this.logger;
  }

  /**
   * The backend, reachable without HTTP (PRD 001, §8.1).
   *
   * The desktop's renderer uses this instead of HTTP — same `FilesService`,
   * one structured clone instead of a round trip through the loopback stack,
   * and no socket anyone else could connect to. The static half of the server
   * stays: the bundle still has to be loaded from somewhere.
   */
  get bridge(): FileSystemBridge {
    if (this.api === null) {
      throw new Error('The desktop stack has not been started.');
    }
    return this.api.bridge;
  }

  /** The address the window should load. Only valid once `start` has resolved. */
  get address(): URL {
    if (this.url === null) {
      throw new Error('The desktop stack has not been started.');
    }
    return this.url;
  }

  /**
   * Boots the stack and resolves with the URL it is listening on.
   *
   * Rejects rather than exiting: whether a failure to bind is worth a dialog
   * or a retry is the caller's decision, not this class's.
   */
  async start(): Promise<URL> {
    if (this.server !== null) {
      return this.address;
    }

    // With a dev server configured the bundle is somebody else's job, and the
    // shell decides between the two once it knows whether that server is up.
    if (!this.config.hasStaticRoot && this.config.devServerUrl === null) {
      throw new Error(
        `No Angular build at ${this.config.staticRoot}. Run \`pnpm --filter frontend build\` first.`,
      );
    }

    const appConfig = AppConfig.fromEnv(this.config.serverEnv());
    const api = new App(appConfig, this.logger.child({ service: 'tr-file-backend' }), VERSION, {
      ...(this.trash === undefined ? {} : { trash: this.trash(appConfig.filesRoot) }),
      ...(this.places === undefined ? {} : { places: this.places }),
    });
    let port = 0;
    const server = createServer(this.compose(appConfig.apiPrefix, () => port));

    port = await this.listen(server);
    this.server = server;
    this.api = api;
    this.url = new URL(`http://${this.config.host}:${port}/`);

    this.logger.info('desktop stack listening', {
      url: this.url.href,
      filesRoot: appConfig.filesRoot,
      staticRoot: this.config.staticRoot,
    });

    return this.url;
  }

  /** Closes the server; safe to call when it was never started. */
  async stop(): Promise<void> {
    const server = this.server;
    if (server === null) {
      return;
    }

    this.api?.close();
    this.server = null;
    this.url = null;
    this.api = null;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });

    this.logger.info('desktop stack stopped');
  }

  /**
   * The request pipeline: the `Host` check, fingerprinted assets, the closed
   * API prefix, then the SPA.
   *
   * The order is the whole design. The `Host` check comes first so a page on
   * another name that resolves here gets nothing at all; static comes next so
   * a real file always wins; the API prefix is answered with a JSON 404 so a
   * stale bundle that tries HTTP fails plainly instead of parsing a page; and
   * the fallback is last and deliberately only answers reads, so a stray
   * `POST /nowhere` still fails instead of quietly receiving a page.
   */
  private compose(apiPrefix: string, port: () => number): Express {
    const shell = express();
    const indexHtml = join(this.config.staticRoot, 'index.html');

    shell.disable('x-powered-by');
    shell.use((request: Request, response: Response, next: NextFunction) => {
      const allowed = [`${this.config.host}:${port()}`, `localhost:${port()}`];
      if (!allowed.includes(request.headers.host ?? '')) {
        response.status(421).type('text/plain').send('Misdirected request');
        return;
      }
      next();
    });
    shell.use(
      express.static(this.config.staticRoot, {
        index: false,
        // The bundle is fingerprinted, but `index.html` names the
        // fingerprints, so it is the one file that must never be cached.
        setHeaders: (response, path) => {
          response.setHeader(
            'Cache-Control',
            path === indexHtml ? 'no-store' : 'public, max-age=31536000, immutable',
          );
        },
      }),
    );

    shell.use((request: Request, response: Response, next: NextFunction) => {
      if (request.path === apiPrefix || request.path.startsWith(`${apiPrefix}/`)) {
        response.status(404).json({
          error: { code: 'NOT_FOUND', message: 'The desktop app serves no HTTP API; its window uses the bridge.' },
        });
        return;
      }
      next();
    });

    shell.use((request: Request, response: Response, next: NextFunction) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        next();
        return;
      }
      response.setHeader('Cache-Control', 'no-store');
      // Relative to `root`, or `send` refuses the whole path when any folder
      // above it starts with a dot — an AppImage mounts at `/tmp/.mount_…`.
      response.sendFile('index.html', { root: this.config.staticRoot }, (error: unknown) => {
        if (error) {
          next(error);
        }
      });
    });

    return shell;
  }

  /** Listens on loopback and reports the port the OS actually handed out. */
  private listen(server: HttpServer): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      server.once('error', onError);
      server.listen(this.config.port, this.config.host, () => {
        server.off('error', onError);
        const address = server.address();
        if (address === null || typeof address === 'string') {
          reject(new Error('The desktop stack bound to a non-TCP address.'));
          return;
        }
        resolve(address.port);
      });
    });
  }
}
