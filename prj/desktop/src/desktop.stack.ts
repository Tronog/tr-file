import { createServer, type Server as HttpServer } from 'node:http';
import { join } from 'node:path';

import { App } from '@tr-file/backend/app';
import { AppConfig } from '@tr-file/backend/config';
import { Logger } from '@tr-file/backend/core';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';

import type { DesktopConfig } from './desktop.config.js';

/** Reported by the health endpoint and the window title. */
const VERSION = process.env['npm_package_version'] ?? '0.1.0';

/**
 * The whole stack, in one process (PRD 001, Section 8).
 *
 * In Docker the two halves are separate containers with nginx in front
 * (`prj/docker/nginx/default.conf`); on the desktop there is no room for a
 * third process, so this class *is* that nginx: one loopback HTTP server that
 * serves the Angular bundle, hands `/api` to the backend's own Express app and
 * falls back to `index.html` for the router's deep links. The backend is not
 * spawned — it is constructed, which is why a crash in it is a rejected
 * promise here rather than a dead child nobody notices.
 *
 * Two things follow from running on loopback with an OS-assigned port: no
 * other machine can reach the file system this exposes, and no two copies of
 * the app can collide over a port. Neither is an accident.
 */
export class DesktopStack {
  private server: HttpServer | null = null;
  private url: URL | null = null;

  private readonly logger: Logger;

  constructor(
    private readonly config: DesktopConfig,
    logger?: Logger,
  ) {
    this.logger =
      logger ??
      Logger.create(config.development ? 'debug' : 'info', { service: 'tr-file-desktop' });
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

    if (!this.config.hasStaticRoot) {
      throw new Error(
        `No Angular build at ${this.config.staticRoot}. Run \`pnpm --filter frontend build\` first.`,
      );
    }

    const appConfig = AppConfig.fromEnv(this.config.serverEnv());
    const api = new App(appConfig, this.logger.child({ service: 'tr-file-backend' }), VERSION);
    const server = createServer(this.compose(api, appConfig.apiPrefix));

    const port = await this.listen(server);
    this.server = server;
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

    this.server = null;
    this.url = null;

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });

    this.logger.info('desktop stack stopped');
  }

  /**
   * The request pipeline: fingerprinted assets, then the API, then the SPA.
   *
   * The order is the whole design. Static comes first so a real file always
   * wins; the API gate comes next because the backend answers its own 404s
   * (in JSON, which is what the frontend client expects) and must therefore
   * never see a request that was meant for the router; the fallback is last
   * and deliberately only answers reads, so a stray `POST /nowhere` still
   * fails instead of quietly receiving a page.
   */
  private compose(api: App, apiPrefix: string): Express {
    const shell = express();
    const indexHtml = join(this.config.staticRoot, 'index.html');

    shell.disable('x-powered-by');
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
        api.instance(request, response, next);
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
      response.sendFile(indexHtml, (error: unknown) => {
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
