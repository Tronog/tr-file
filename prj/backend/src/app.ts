import express, { type Express } from 'express';

import { AppConfig } from './config/index.js';
import {
  CsrfMiddleware,
  ErrorMiddleware,
  Logger,
  NotFoundMiddleware,
  RequestLoggerMiddleware,
  type RouteModule,
} from './core/index.js';
import { ArchiveRoutes, ArchiveService } from './modules/archive/index.js';
import { AuthRoutes, AuthService, SessionMiddleware } from './modules/auth/index.js';
import { FileSystemBridge } from './modules/bridge/index.js';
import {
  FilePathResolver,
  FilesRoutes,
  FilesService,
  NO_PLACES,
  PlacesService,
  WatchService,
  type PlacesProvider,
} from './modules/files/index.js';
import { HealthRoutes, HealthService } from './modules/health/index.js';
import {
  OperationsRoutes,
  OperationsService,
  SERVER_TRASH_DIR,
  ServerTrash,
  type TrashProvider,
} from './modules/operations/index.js';

/** What a host can plug in that a plain server has no use for. */
export interface AppOptions {
  /**
   * Where trashed entries go (PRD 005, §1). A server keeps its own trash in
   * the files root; the desktop, on the user's own machine, hands in the
   * system's.
   */
  readonly trash?: TrashProvider;
  /**
   * The home folder, the user's folders, drives and mounts (PRD 003, §6).
   * A server has none and lists only its root; the desktop, whose root is
   * the whole file system, hands in the system's.
   */
  readonly places?: PlacesProvider;
}

/**
 * Composition root: owns the Express instance and wires configuration,
 * middleware and feature modules together in a deterministic order.
 */
export class App {
  readonly instance: Express;

  /**
   * The same file-system API, reachable without HTTP (PRD 001, §8.1).
   *
   * Built here rather than by the caller so it can only ever sit on the
   * `FilesService` the routes use: one root, one resolver, one upload ceiling.
   * A server deployment simply never touches it; the desktop shell hands it to
   * its IPC channel instead of talking to itself over a socket.
   */
  readonly bridge: FileSystemBridge;

  /**
   * Who may use the API (PRD 003, §2). Shared by the HTTP routes and the
   * bridge, so both ask for the same account and neither is a way around it.
   */
  readonly auth: AuthService;

  /** Copy, move, trash and empty trash, as background jobs (PRD 005, §1); shared like `auth`. */
  readonly operations: OperationsService;

  /**
   * Auto-refresh (PRD 003, §5): which folders on a client's screen changed.
   * Shared by the route and the bridge, like `auth`; holds `fs.watch`
   * watchers, so `close` stops it.
   */
  readonly watches: WatchService;

  private readonly filesService: FilesService;
  private readonly places: PlacesService;
  private readonly archives: ArchiveService;
  private readonly filesLogger: Logger;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    private readonly version: string,
    options: AppOptions = {},
  ) {
    this.filesLogger = this.logger.child({ module: 'files' });
    const trash = options.trash ?? new ServerTrash(this.config.filesRoot);
    // One resolver for every module: the server's own trash is out of reach of all of them.
    const reserved = trash.kind === 'server' ? [SERVER_TRASH_DIR] : [];
    const resolver = this.config.allDrives
      ? FilePathResolver.drives(reserved)
      : new FilePathResolver(this.config.filesRoot, reserved);
    this.filesService = new FilesService(resolver, this.filesLogger, this.config.uploadMaxBytes);
    this.watches = new WatchService(resolver, this.filesLogger);
    this.places = new PlacesService(resolver, options.places ?? NO_PLACES, this.filesLogger);
    this.archives = new ArchiveService(resolver, this.filesLogger);
    this.operations = new OperationsService(resolver, trash, this.logger.child({ module: 'operations' }), this.archives);
    this.auth = new AuthService(
      this.config.auth,
      this.config.sessionIdleMs,
      this.logger.child({ module: 'auth' }),
    );
    if (!this.auth.required) {
      this.logger.warn('signing in is switched off: anyone who can reach this server can use it');
    }
    this.bridge = new FileSystemBridge(this.filesService, this.filesLogger, this.auth, this.operations, this.watches, this.places, this.archives);

    this.instance = express();
    this.configure();
    this.mountModules(this.createModules());
    this.mountErrorHandling();
  }

  /**
   * Releases what outlives a request: the folder watchers. None of it keeps
   * the process alive, but a host that stops serving should let go of it.
   */
  close(): void {
    this.watches.close();
  }

  private configure(): void {
    this.instance.disable('x-powered-by');
    // Behind nginx in production; trust the proxy for protocol and client IP.
    this.instance.set('trust proxy', true);
    this.instance.use(express.json({ limit: '1mb' }));
    this.instance.use(express.urlencoded({ extended: true }));
    this.instance.use(new RequestLoggerMiddleware(this.logger).handle());
    // Ahead of every module: no write gets through from another site, and no
    // request at all without a session when signing in is on (PRD 003, §2).
    this.instance.use(this.config.apiPrefix, new CsrfMiddleware().handle());
    this.instance.use(this.config.apiPrefix, new SessionMiddleware(this.auth).handle());
  }

  private createModules(): readonly RouteModule[] {
    const healthService = new HealthService(this.version, this.config.nodeEnv);

    return [
      new HealthRoutes(healthService),
      new AuthRoutes(this.auth),
      new FilesRoutes(this.filesService, this.filesLogger, this.watches, this.places),
      new OperationsRoutes(this.operations),
      new ArchiveRoutes(this.archives, this.filesLogger),
    ];
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
