import { createServer, type Server as HttpServer } from 'node:http';

import type { App } from './app.js';
import type { AppConfig } from './config/index.js';
import type { Logger } from './core/index.js';

/** Owns the HTTP server lifecycle, including graceful shutdown. */
export class Server {
  private readonly httpServer: HttpServer;
  private shuttingDown = false;

  constructor(
    private readonly app: App,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {
    this.httpServer = createServer(app.instance);
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => reject(error);
      this.httpServer.once('error', onError);
      this.httpServer.listen(this.config.port, this.config.host, () => {
        this.httpServer.off('error', onError);
        resolve();
      });
    });

    this.logger.info('server listening', {
      host: this.config.host,
      port: this.config.port,
      apiPrefix: this.config.apiPrefix,
      filesRoot: this.config.filesRoot,
      nodeEnv: this.config.nodeEnv,
    });
  }

  async stop(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    await new Promise<void>((resolve) => {
      this.httpServer.close(() => resolve());
      this.httpServer.closeIdleConnections();
    });
    this.app.close();
    this.logger.info('server stopped');
  }

  /** Wires SIGINT/SIGTERM and last-resort process error handlers. */
  registerShutdownHandlers(): void {
    const shutdown = (signal: NodeJS.Signals): void => {
      this.logger.info('shutdown signal received', { signal });
      void this.stop()
        .then(() => process.exit(0))
        .catch((error: unknown) => {
          this.logger.error('graceful shutdown failed', { error: String(error) });
          process.exit(1);
        });
    };

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);

    process.on('unhandledRejection', (reason) => {
      this.logger.error('unhandled rejection', { reason: String(reason) });
    });
    process.on('uncaughtException', (error: Error) => {
      this.logger.error('uncaught exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });
  }
}
