import type { Router } from 'express';

/** Contract every feature module's route class implements. */
export interface RouteModule {
  /** Path the module is mounted at, relative to the API prefix. */
  readonly basePath: string;
  /** Fully configured Express router for the module. */
  readonly router: Router;
}
