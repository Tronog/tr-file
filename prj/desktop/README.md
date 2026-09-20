# @tr-file/desktop

The Electron shell (PRD 001, §8): one process that runs the whole stack — the
Express API, the built Angular workbench and the window showing it.

## Running it

```bash
pnpm build      # tsc → dist/ (runtime only; tests are excluded)
pnpm start      # electron .
pnpm dev        # build, then run with the dev tools open
pnpm test       # node:test via tsx, straight from src/
pnpm typecheck  # runtime sources + test sources
```

From the workspace root, `pnpm desktop` and `pnpm desktop:dev` do the same. The
app serves the **built** frontend, so `pnpm build` at the root (which builds the
backend, then the frontend, then this) has to have run at least once.

| Variable | Default | Meaning |
| --- | --- | --- |
| `FILES_ROOT` | the user's home directory | Absolute path all file access is confined to |
| `TR_FILE_PORT` | `0` (OS picks) | Loopback port; pin it only to debug |
| `TR_FILE_STATIC_ROOT` | the workspace `ng build` output | Where the Angular bundle is |
| `TR_FILE_DEV` | `1` unless packaged | Dev tools and debug logging |

`HOST` and `PORT` are deliberately *not* read here: the server is configured
from `DesktopConfig.serverEnv()`, not from the user's shell, so nothing in the
environment can move it off loopback.

## How the stack is composed

```
BrowserWindow ──http──▶ 127.0.0.1:<port>   (DesktopStack)
                          ├── express.static   → frontend/dist/…/browser
                          ├── /api/**          → new App(...)  (@tr-file/backend)
                          └── GET fallback     → index.html
```

Under Docker these are three things — two containers and nginx in front
(`prj/docker/nginx/default.conf`). Here there is no room for a third process,
so `DesktopStack` *is* that nginx, and the backend is **constructed, not
spawned**: `new App(config, logger, version).instance` is mounted as ordinary
Express middleware. A backend that fails to start is therefore a rejected
promise the main process can show in a dialog, rather than a dead child nobody
notices. It is also why `@tr-file/backend` gained an `exports` map — the pieces
the shell composes are named, not reached for by deep path.

The middleware order is the design:

1. **Static first**, so a real file always wins. The bundle is fingerprinted and
   served `immutable`; `index.html` names those fingerprints and is `no-store`.
2. **The API gate**, because the backend answers its own 404s in JSON — which is
   what the frontend client parses — so it must never see a request meant for
   the Angular router.
3. **The SPA fallback**, last, and for `GET`/`HEAD` only: a stray `POST /nowhere`
   should fail rather than quietly receive a page.

Because the API and the app share one origin, there is no CORS, no dev proxy and
no configured API base URL — the frontend's plain `/api/fs` requests just work.

## Layout

| File | Role |
| --- | --- |
| `src/main.ts` | Electron lifecycle only: single-instance lock, ready, activate, quit |
| `src/desktop.config.ts` | Every environment lookup, and where to find things |
| `src/desktop.stack.ts` | The server: backend + bundle + fallback |
| `src/main-window.ts` | The window, and the rules about what may happen in it |

Only `main.ts` and `main-window.ts` import `electron`. Everything Electron knows
reaches `DesktopConfig` as a plain `DesktopEnvironment`, which is what lets the
whole stack be booted and tested by `pnpm test` with no desktop session at all —
`src/desktop.stack.test.ts` starts the real thing and talks to it over HTTP.

## Security

The renderer is the ordinary Angular app over loopback HTTP, so it is given a
browser's powers and not one more: `contextIsolation` on, `nodeIntegration` off,
`sandbox` on, no preload script, no `webview` tag, and every permission request
denied. Navigation is pinned to the stack's own origin — a link in a previewed
markdown file opens in the real browser, where the user can see the address bar.

The server binds `127.0.0.1` on an OS-assigned port, so nothing on the network
can reach the file system it exposes, and two copies of the app can never
collide over a port. A single-instance lock means there is only ever one anyway.

## Running inside a container

Chromium's `chrome-sandbox` helper must be root-owned and setuid, which it
usually is not in a dev container. `pnpm start` will abort with a message saying
so. Either fix the helper's ownership, or run `electron . --no-sandbox` for that
session — the flag is deliberately not in the `start` script, since it weakens
the renderer sandbox for everyone.

## Packaging

Not set up. `pnpm build` produces the main-process JavaScript and the app runs
from the workspace; turning that into an installer wants `electron-builder` (or
Forge), a copy of `frontend/dist/frontend/browser` placed where
`TR_FILE_STATIC_ROOT`/`PACKAGED_STATIC` expects it, and the backend's runtime
dependencies bundled out of the pnpm store. `DesktopConfig` already looks in the
packaged location first, so that is a packaging job rather than a code change.
