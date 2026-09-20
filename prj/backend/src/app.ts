import express, { type Express } from 'express';

import { AppConfig } from './config/index.js';
import {
  ErrorMiddleware,
  Logger,
  NotFoundMiddleware,
  RequestLoggerMiddleware,
  type RouteModule,
} from './core/index.js';
import { FilePathResolver, FilesRoutes, FilesService } from './modules/files/index.js';
import { HealthRoutes, HealthService } from './modules/health/index.js';

/**
 * Composition root: owns the Express instance and wires configuration,
 * middleware and feature modules together in a deterministic order.
 */
export class App {
  readonly instance: Express;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly version: string,
  ) {
    this.instance = express();
    this.configure();
    this.mountModules(this.createModules());
    this.mountErrorHandling();
  }

  private configure(): void {
    this.instance.disable('x-powered-by');
    // Behind nginx in production; trust the proxy for protocol and client IP.
    this.instance.set('trust proxy', true);
    this.instance.use(express.json({ limit: '1mb' }));
    this.instance.use(express.urlencoded({ extended: true }));
    this.instance.use(new RequestLoggerMiddleware(this.logger).handle());
  }

  private createModules(): readonly RouteModule[] {
    const filesService = new FilesService(
      new FilePathResolver(this.config.filesRoot),
      this.logger.child({ module: 'files' }),
    );
    const healthService = new HealthService(this.version, this.config.nodeEnv);

    return [new HealthRoutes(healthService), new FilesRoutes(filesService)];
  }

  private mountModules(modules: readonly RouteModule[]): void {
    for (const module of modules) {
      const mountPath = `${this.config.apiPrefix}${module.basePath}`;
      this.instance.use(mountPath, module.router);
      this.logger.debug('module mounted', { mountPath });
    }
  }

  private mountErrorHandling(): void {
    this.instance.use(new NotFoundMiddleware().handle());
    this.instance.use(new ErrorMiddleware(this.logger, !this.config.isProduction).handle());
  }
}
