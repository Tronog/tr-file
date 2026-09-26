# @tr-file/desktop

The Electron shell (PRD 001, §8): one process that runs the whole stack — the
Express API, the built Angular workbench and the window showing it.

## Running it

```bash
pnpm build      # type-check, then bundle src/ → dist/main.cjs + dist/preload.cjs
pnpm start      # electron .
pnpm dev        # build, then run against `ng serve` with the dev tools open
pnpm dev:static # the same, but showing the built bundle
pnpm test       # node:test via tsx, straight from src/
pnpm typecheck  # runtime sources + test sources
pnpm package    # the distributables of §8.3, into release/
```

Two ways to see the frontend, and the difference is worth knowing:

* **`pnpm dev` at the workspace root** runs `ng serve` beside this shell, and
  the window loads *that* (`TR_FILE_DEV_SERVER`, default `http://localhost:4200`
  in the script). Saving a component reloads the window — no rebuild, no
  restart. Data still goes over the bridge: the preload belongs to the window,
  not to the origin it is showing, so `/api` is not involved either way. The
  shell waits up to 30s for the dev server and falls back to the built bundle
  if it never answers.
* **`pnpm desktop` / `pnpm desktop:dev` at the root** show the **built**
  frontend, and rebuild it first. That matters because the shell's own
  `pnpm build` only rebuilds *this* package: run `dev:static` or `start` here
  with a stale `frontend/dist` and the window shows yesterday's UI. Fix it with
  `pnpm --filter frontend build` and a reload.

| Variable | Default | Meaning |
| --- | --- | --- |
| `FILES_ROOT` | the user's home directory | Absolute path all file access is confined to |
| `TR_FILE_PORT` | `0` (OS picks) | Loopback port; pin it only to debug |
| `TR_FILE_STATIC_ROOT` | the workspace `ng build` output | Where the Angular bundle is |
| `TR_FILE_DEV` | `1` unless packaged | Debug logging |
| `TR_FILE_DEVTOOLS` | off | Open the dev tools with the window |
| `TR_FILE_DEV_SERVER` | unset | Angular dev server to load instead of the bundle; ignored unless `TR_FILE_DEV` |

`HOST` and `PORT` are deliberately *not* read here: the server is configured
from `DesktopConfig.serverEnv()`, not from the user's shell, so nothing in the
environment can move it off loopback.

## How the stack is composed

```
BrowserWindow ──http──▶ 127.0.0.1:<port>   (DesktopStack)   ← the bundle only
    │                     ├── express.static   → frontend/dist/…/browser
    │                     ├── /api/**          → new App(...)  (@tr-file/backend)
    │                     └── GET fallback     → index.html
    └──ipc───▶ FsBridgeChannel ──▶ App.bridge ──▶ FilesService   ← all the data
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

## No HTTP for data (PRD 001, §8.1)

The window loads the bundle over HTTP, because it has to come from somewhere.
Everything after that — every listing, every detail, every read and upload —
goes through IPC instead, straight into the backend running in this very
process. Serialising a request, framing it and parsing it again to reach an
object in the next process is work with nothing to show for it.

```
Angular ─ FsBridgeService ─ window.trFileBridge ─ ipc ─ FsBridgeChannel ─ App.bridge
   (frontend)                  (preload.cjs)                (main)        (backend)
```

Three pieces, each deliberately thin:

- **`preload.cts`** → `dist/preload.cjs`. A sandboxed preload is CommonJS, which
  is why it is a `.cts` file in an otherwise-ESM package. It exposes one
  function that can name exactly one channel: no paths, no file handles, no
  Node.
- **`FsBridgeChannel`** checks *who* is asking — `ipcMain.handle` answers any
  frame in the app — and hands the command to `FileSystemBridge`. It interprets
  nothing, because the moment it does, the desktop and the server have two
  different file-system APIs.
- **`App.bridge`** (in the backend) runs the command against the same
  `FilesService` the HTTP routes use.

The frontend picks its transport once, in `FileSystemService`: the bridge when
the preload put one on `window`, HTTP otherwise. Nothing downstream branches on
it, and a backend refusal arrives as the same `FsError`, with the same code and
status, either way.

**No file crosses whole** (PRD 003, §1). Reads and uploads move in 1 MiB
chunks (`read` from an offset; `upload-begin` / `upload-chunk` / `upload-commit`),
so a large file costs one chunk of memory at a time on either side, an upload
reports real progress, and a cancelled one stops part-way and is discarded.

A **download has no URL** here, so it does not go through the page at all:
`SaveFileChannel` (`'tr-file:save'`) shows the native Save dialog and streams
the file to the chosen path with `App.bridge.saveCopy`, pushing progress to the
window on `'tr-file:save:progress'`; the page can `cancel` it by the id it gave
it. The destination comes from the dialog, never from the page. The preload
exposes this as `trFileBridge.save` / `onSaveProgress`, and the bridge contract
is version 2 — a page expecting version 1 does not use it.

## No window decorations (PRD 001, §8.2)

The window has no frame: the Angular title bar *is* the title bar, drag region
and window buttons included, the way VS Code does it.

```
MainWindow  frame: false            (Windows, Linux)
            titleBarStyle: hidden…  (macOS — the traffic lights stay)
                 │
                 └── ipc 'tr-file:window' ── WindowControlsChannel ── the sender's own window
```

`WindowControlsChannel` is the entire vocabulary a page is given over its own
window: `state`, `minimize`, `toggleMaximize`, `close`. No arguments, and each
one answers with the resulting state, so the button that was just pressed is
already showing the right icon. Like `FsBridgeChannel` it checks the sender's
origin, and it acts on `BrowserWindow.fromWebContents(event.sender)` — the
window the command came from, never one it holds a reference to.

State is also **pushed**, because a window can be maximized without any button
being pressed: a snap gesture, a keyboard shortcut, a drag to the top of the
screen. `MainWindow` forwards `maximize`, `unmaximize` and the two full-screen
events, and the maximize button becomes Restore either way.

macOS is the exception, and deliberately so. `hiddenInset` hides the bar but
keeps the traffic lights, which the platform insists on drawing itself and for
which nothing convincing can be substituted — so there the app draws no
buttons of its own, leaves a gap for them, and lets the platform handle the
title-bar double-click too. `WindowControlsFeature` in the frontend is where
those three cases (browser, macOS, everywhere else) are decided.

## Layout

| File | Role |
| --- | --- |
| `src/main.ts` | Electron lifecycle only: single-instance lock, ready, activate, quit |
| `src/desktop.config.ts` | Every environment lookup, and where to find things |
| `src/desktop.stack.ts` | The server: backend + bundle + fallback |
| `src/main-window.ts` | The window, and the rules about what may happen in it |
| `src/fs-bridge.channel.ts` | The IPC channel: who may ask, and nothing else |
| `src/window-controls.channel.ts` | The four verbs a page may use on its own window |
| `src/app-menu.ts` | The accelerator table; deliberately without `Ctrl`+`W` |
| `src/preload.cts` | The two small objects the renderer is given |
| `scripts/bundle.mjs` | The build: one file for the main process, one for the preload |
| `electron-builder.yml` | The distributables: one executable per platform |
| `build/` | Icons the packager reads; not shipped inside the app |

Only `main.ts`, `main-window.ts`, `fs-bridge.channel.ts` and the preload import
`electron`. Everything Electron knows
reaches `DesktopConfig` as a plain `DesktopEnvironment`, which is what lets the
whole stack be booted and tested by `pnpm test` with no desktop session at all —
`src/desktop.stack.test.ts` starts the real thing and talks to it over HTTP.

## Security

The renderer is the ordinary Angular app, so it is given a browser's powers and
not one more: `contextIsolation` on, `nodeIntegration` off, `sandbox` on, no
`webview` tag, and every permission request denied. The one addition is the
preload above, whose entire surface is a single `invoke` — and every command
through it is validated by the backend as strictly as a query string, and
served only when the sending frame's origin is the stack's own.

Navigation is pinned to that same origin — a link in a previewed markdown file
opens in the real browser, where the user can see the address bar.

The server binds `127.0.0.1` on an OS-assigned port, so nothing on the network
can reach the file system it exposes, and two copies of the app can never
collide over a port. A single-instance lock means there is only ever one anyway.

## The application menu

`installAppMenu` replaces the menu Electron would otherwise install. The window
is frameless and carries its own menu bar in the page, so nothing native is
ever drawn — a menu is also an accelerator table, and that is the only reason
this one exists. The default table binds **Close** to `Ctrl`+`W`, which since
§6.2.2 closes the focused *tab*; an accelerator that closed the whole window
instead would be a spectacular way to lose someone's work, so the chord is
simply not bound. Reload, the inspector (`Ctrl`+`Shift`+`I`), full screen and
quit are kept.

## Showing the window

`MainWindow` creates the window with `show: false` so an empty frame never
flashes, and shows it once `loadURL` has resolved — *not* only on
`ready-to-show`. That event is the conventional cue, but it is not guaranteed,
and this frameless window on Linux never emits it: the app came up with no
visible window at all, which went unnoticed only because opening the dev tools
happened to show it. A window nobody can see is the worst failure this shell
has, so it does not depend on an event that may not arrive.

## Running inside a container

Chromium's `chrome-sandbox` helper must be root-owned and setuid, which it
usually is not in a dev container. `pnpm start` will abort with a message saying
so. Either fix the helper's ownership, or run `electron . --no-sandbox` for that
session — the flag is deliberately not in the `start` script, since it weakens
the renderer sandbox for everyone.

## Distributables (PRD 001, §8.3)

One file per platform, nothing to install:

```bash
pnpm package          # both, from this package
pnpm package:linux    # release/tr-file-0.1.0-x86_64.AppImage
pnpm package:win      # release/tr-file-0.1.0-x64.exe
```

From the workspace root: `pnpm desktop:package`, `…:linux`, `…:win`, which
build the whole workspace first. Everything lands in `desktop/release/`.

**AppImage** on Linux and **portable `.exe`** on Windows are the two targets
that *are* a single executable — a `.deb` or an NSIS installer would be a thing
that installs the app rather than the app itself, which §8.3 does not ask for.
The Windows executable unpacks itself into a temporary directory and runs from
there; `unpackDirName` pins that directory so repeated runs reuse it instead of
leaving one behind per launch.

### Why the main process is bundled

`scripts/bundle.mjs` compiles `src/main.ts` — and with it the backend, Express
and Busboy — into a single `dist/main.cjs`, and `src/preload.cts` into
`dist/preload.cjs`. The packaged app therefore contains **no `node_modules` at
all**:

```
tr-file.AppImage
└── resources/
    ├── app.asar          dist/main.cjs · dist/preload.cjs · package.json
    └── app/browser/      the Angular build   ← DesktopConfig's PACKAGED_STATIC
```

This is not an optimisation. A pnpm workspace is a graph of symlinks — half of
it into `node_modules/.pnpm`, and `@tr-file/backend` into a sibling package —
and a packager copying that graph produces either a broken tree or a
duplicated one. Compiling it away means the packager has one file to place, and
there is nothing left that could resolve differently in a release than it does
in a checkout.

It follows that **nothing is a runtime dependency**, which is why
`package.json` declares no `dependencies` at all: the backend and Express are
`devDependencies`, because by the time the app runs they are part of the
program rather than something it loads. `npmRebuild: false` says the same thing
to electron-builder — there are no native modules, so it has nothing to rebuild
and no reason to go looking through the store for some.

`pnpm start` runs that same bundled file, so a bundling mistake shows up the
first time anyone starts the app, not the first time someone ships it.

### Cross-building

Both targets are built from Linux, and neither needs Wine: electron-builder
carries its own NSIS, and stamps the executable's icon and version itself. What
it cannot do from here is *sign* either one, so both are unsigned — Windows
will show a SmartScreen warning the first time one is run.

### What the build needs beforehand

The backend's `dist/` (the bundle reaches into it through the `exports` map)
and the frontend's `ng build` output (which ships beside the app). Both are
someone else's `pnpm build`, so `scripts/bundle.mjs` checks for them and names
the command to run rather than failing somewhere inside a bundler.

### Icons

`build/icon.png` and `build/icon.ico` — see `build/README.md`. Without them the
app would ship with the default Electron icon, which is the one part of a
distributable a user sees before anything else runs.
