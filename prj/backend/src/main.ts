import { App } from './app.js';
import { AppConfig } from './config/index.js';
import { Logger } from './core/index.js';
import { Server } from './server.js';

const VERSION = process.env['npm_package_version'] ?? '0.1.1';

async function bootstrap(): Promise<void> {
  const config = AppConfig.fromEnv();
  const logger = Logger.create(config.logLevel, { service: 'tr-file-backend' });

  const app = new App(config, logger, VERSION);
  const server = new Server(app, config, logger);

  server.registerShutdownHandlers();
  await server.start();
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`failed to start backend: ${message}\n`);
  process.exit(1);
});
