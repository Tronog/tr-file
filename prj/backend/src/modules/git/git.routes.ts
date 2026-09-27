import { Router } from 'express';

import { asyncHandler, type RouteModule } from '../../core/index.js';
import { GIT_READ_ACTIONS, GIT_WRITE_ACTIONS, parseGitRequest } from './git-request.js';
import type { GitService } from './git.service.js';

/**
 * HTTP surface of the `git` module (PRD 011, §1), at `<apiPrefix>/git`.
 *
 * Reads are `GET /api/git/<action>?path=…` — `info`, `status`, `log`,
 * `branches`, `diff`. Everything that changes a repository is
 * `POST /api/git/<action>` with a JSON body, and answers with the
 * repository's status as it now is, so the client needs no second request.
 */
export class GitRoutes implements RouteModule {
  readonly basePath = '/git';
  readonly router: Router;

  constructor(private readonly git: GitService) {
    this.router = Router();
    this.register();
  }

  private register(): void {
    for (const action of GIT_READ_ACTIONS) {
      this.router.get(
        `/${action}`,
        asyncHandler(async (req, res) => {
          res.json({ data: await this.git.handle(parseGitRequest(action, req.query)) });
        }),
      );
    }
    for (const action of GIT_WRITE_ACTIONS) {
      this.router.post(
        `/${action}`,
        asyncHandler(async (req, res) => {
          res.json({ data: await this.git.handle(parseGitRequest(action, req.body)) });
        }),
      );
    }
  }
}
