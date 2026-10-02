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
| `FILES_ROOT` | `/` — the whole file system; on Windows every drive | Absolute path all file access is confined to. The window still *starts* in the home folder |
| `TR_FILE_PORT` | `0` (OS picks) | Loopback port; pin it only to debug |
| `TR_FILE_STATIC_ROOT` | the workspace `ng build` output | Where the Angular bundle is |
| `TR_FILE_DEV` | `1` unless packaged | Debug logging |
| `TR_FILE_DEVTOOLS` | off | Open the dev tools with the window |
| `TR_FILE_DEV_SERVER` | unset | Angular dev server to load instead of the bundle; ignored unless `TR_FILE_DEV` |

| `TR_FILE_AUTH_USERNAME` | unset | Turns signing in on: the window asks for this account before the bridge answers anything |
| `TR_FILE_AUTH_PASSWORD` / `TR_FILE_AUTH_PASSWORD_HASH` | unset | Its password, plain or as made by `pnpm --filter backend hash-password` |

Signing in is **off by default** on the desktop (PRD 003, §2): the app runs as
the user, over files the user can already open. With an account set, each
window has its own bridge session (`BridgeSessions`), shared by the command and
save channels, and starts signed out.

`HOST` and `PORT` are deliberately *not* read here: the server is configured
from `DesktopConfig.serverEnv()`, not from the user's shell, so nothing in the
environment can move it off loopback.

## How the stack is composed

```
BrowserWindow ──http──▶ 127.0.0.1:<port>   (DesktopStack)   ← the bundle only
    │                     ├── Host check       → 421 unless 127.0.0.1:<port> / localhost:<port>
    │                     ├── express.static   → frontend/dist/…/browser
    │                     ├── /api/**          → 404, JSON: there is no HTTP API
    │                     └── GET fallback     → index.html
    └──ipc───▶ FsBridgeChannel ──▶ App.bridge ──▶ FilesService   ← all the data
```

Under Docker these are three things — two containers and nginx in front
(`prj/docker/nginx/default.conf`). Here there is no room for a third process,
so `DesktopStack` stands in for that nginx, and the backend is **constructed,
not spawned**: `new App(config, logger, version)` is built in-process and only
its `bridge` is used. A backend that fails to start is therefore a rejected
promise the main process can show in a dialog, rather than a dead child nobody
notices. It is also why `@tr-file/backend` gained an `exports` map — the pieces
the shell composes are named, not reached for by deep path.

The middleware order is the design:

1. **The `Host` check**, so a page on another name that resolves to 127.0.0.1 —
   DNS rebinding — gets nothing at all.
2. **Static**, so a real file always wins. The bundle is fingerprinted and
   served `immutable`; `index.html` names those fingerprints and is `no-store`.
3. **The closed API prefix.** Since the window's data goes over the bridge, an
   HTTP API here would only have been a way in for every *other* local program,
   or a web page that found the port (PRD 003, §2). `/api/**` answers a JSON 404,
   so a stale bundle that tries HTTP fails plainly.
4. **The SPA fallback**, last, and for `GET`/`HEAD` only: a stray `POST /nowhere`
   should fail rather than quietly receive a page.

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

## Remote servers (PRD 006, §1)

A window can work on another computer's files: a tr-file server running there
headless — the same backend, the same REST API the web version uses. The
command palette's *Connect to Remote Server* asks for
`[http(s)://][user[:password]@]host:port`.

```
Angular ─ FsBridgeService ─ ipc ─ FsBridgeChannel ─ BridgeSessions ─┬─ App.bridge ─ FilesService   (this computer)
                                                                     └─ RemoteBackend ─ https ─▶ /api (remote server)
```

The page could not do this itself: another origin needs CORS the server does
not grant, would not get the server's `SameSite=Strict` session cookie, and is
refused by its CSRF check. So the main process does it, and the page is none
the wiser — `RemoteBackend` answers **the same bridge commands** as the local
bridge, over HTTP:

| Command | Over HTTP |
| --- | --- |
| `list`, `details` | `GET /api/fs/list`, `/api/fs/details` |
| `read` | `GET /api/fs/download` with `Range` — one chunk; the size from `Content-Range` |
| `upload-begin` / `-chunk` / `-commit` / `-abort` | One streamed multipart `POST /api/fs/upload`; a taken name is checked for first |
| `auth-status`, `login`, `logout` | `/api/auth/*`; the session cookie is kept by the client |
| `saveCopy` | `GET /api/fs/download`, streamed to the chosen file |
| `op-*` (PRD 005, §1) | `/api/ops/*` — the file operations run on the server; the window polls them |
| `rename`, `mkdir`, `create-file` (PRD 003, §5) | `POST /api/fs/rename`, `/mkdir`, `/create` |
| `search`, `watch` | `GET /api/fs/search`, `POST /api/fs/watch` — the watch session lives on the server |

Every write carries the CSRF header; the server's refusals come back with its
own code and status, and an unreachable server as `NETWORK_ERROR`.
`BridgeSessions` keeps each window's connection and routes its commands, and
answers `connect` (check it is a tr-file server, sign in when credentials are
given), `disconnect` and `connection-status`. The password signs in once and is
kept nowhere; a server that needs signing in without one shows the window's
normal sign-in screen. The window reloads after connecting or disconnecting —
the connection survives the reload — so everything is read afresh. HTTPS is
used when asked for (`https://`) or on port 443; plain HTTP otherwise, which
on anything but a trusted network sends the password in the clear.

## File operations (PRD 005, §1)

Copy, move, move to trash and empty trash are backend jobs everywhere
(`prj/backend`, `/api/ops`), reached through the same bridge commands
(`op-copy`, `op-status`, …) whichever backend the window is on. What differs is
the trash:

- **This computer** — `App` is built with `ShellTrash` (`src/shell-trash.ts`),
  so trashed entries land in the system trash the user's file manager shows and
  can be restored from there — from there only: `shell.trashItem` gives no id
  to put an entry back by, so `op-info` says `canRestore: false` and the job's
  `outcome` has no trash ids (PRD 003, §5). Trashing is Electron's `shell.trashItem`, handed
  in by `main.ts`, so the class itself imports no `electron` and is tested
  without a desktop session. Emptying has no Electron call: on Linux the
  freedesktop.org home trash is cleared entry by entry (with progress), on
  macOS Finder empties it, on Windows `Clear-RecycleBin` does.
- **A remote server** — `RemoteBackend` maps the commands onto that server's
  `/api/ops`; the work, and the server's own trash, are over there — which can
  restore (`op-restore`), and delete for good (`op-delete`) works the same.

Copies and moves run in the backend on this machine either way — Electron has
no file-copy call of its own — so progress and cancelling behave the same
locally and remotely.

## Open with an app, Show in Folder (PRD 003, §5)

Two commands only a desktop has, answered by `BridgeSessions` itself, as
`connect` is: `shell-open` `{ path }` → `{ opened }` hands an entry to the
operating system's default app (a folder opens in the file manager), and
`shell-reveal` `{ path }` → `{ revealed: true }` selects it in the file manager.
Both go through a `DesktopShell` — `shell.openPath`, `shell.showItemInFolder`
and a native dialog, built in `main.ts` — so `BridgeSessions` still imports no
`electron` and is tested with a stub (`src/desktop-shell.ts`).

- **On this computer** the backend's `bridge.localPath` says where the entry
  is: the same sign-in, resolver and root confinement as any command, and a
  `404` for what is not there. It is a method, not a command — a host path is
  never handed to the page. A failure to open is `OPEN_FAILED` with the
  system's own reason.
- **Programs are asked about first.** A file that would *run* — a Windows
  program or script extension (`exe`, `bat`, `cmd`, `msi`, `ps1`, `vbs`, `js`,
  `lnk`, `jar`, …) on any platform, and off Windows a file with an execute bit
  or a launcher (`desktop`, `sh`, `run`, `AppImage`, `command`, `app`) — gets a
  native dialog, *'name' is a program. Opening it will run it.*, with Run and
  Cancel, Cancel the default. Anything but Run answers `{ opened: false }` and
  opens nothing. The decision is made in the main process, so a compromised
  page cannot skip it.
- **On a remote server** a *file* is streamed (`saveCopy`) into a folder of
  its own under `<tmp>/tr-file-open/<uuid>/` and that copy is opened; a program
  is asked about before it is copied. A remote folder is refused
  (`NOT_SUPPORTED`), as is Show in Folder — there is no folder here to show.
  The temp folder is removed when the app quits (best effort).

## A whole computer's files (PRD 003, §6)

What a file manager on the desktop has that a server does not:

- **The whole file system.** With no `FILES_ROOT` the root is `/` — other
  drives, USB sticks, network mounts and everything above home are reachable.
  On Windows `/` means *every drive*: the backend's `FilePathResolver.drives()`
  makes the root the list of drives, and paths start with one (`C:/Users/me`).
  A fresh window starts in the home folder, which the places say.
- **Places** (`src/system-places.ts`): home and the user's folders from
  `app.getPath`, then the drives and mounts — `/proc/self/mounts` on Linux
  (under `/media`, `/run/media`, `/mnt`, and network file systems anywhere),
  `/Volumes` on macOS (but the start-up disk), the drive letters on Windows.
  Looked up on each request, so what was plugged in since is there. It is the
  `PlacesProvider` `DesktopStack` hands `App`; the backend proves each inside
  the root and answers root-relative paths.
- **Settings that outlive a restart** (`src/settings-store.ts`,
  `src/settings.channel.ts`): the window's origin is a new loopback port on
  every start, so `localStorage` forgets. The main process keeps
  `<userData>/settings.json` instead — layout, bookmarks, recent folders,
  saved servers — read once, written through a temp file and a rename. The
  preload's `trFileSettings` has `all()` and `set(key, value)`; keys are short
  names, values plain JSON of at most 256 KiB, 64 keys at most.
- **The system clipboard** (`src/system-clipboard.ts`, adapted to Electron's
  clipboard in `src/electron-clipboard.ts`): `clipboard-read` answers the
  files the system clipboard holds as root-relative paths — `{ paths, cut,
  outside }`, `outside` counting what this window cannot reach — and
  `clipboard-write` `{ paths, cut }` puts entries there for the system's file
  manager. GNOME's `x-special/gnome-copied-files` and `text/uri-list` (with
  KDE's cut marker) on Linux, Finder's `NSFilenamesPboardType` on macOS, the
  first file of Explorer's `FileNameW` on Windows — where nothing can be
  written that Explorer pastes as files, so the paths go as text. On a remote
  server neither reaches anything.
- **Dragging out** (`src/drag-out.channel.ts`): the page names the entries at
  the start of its drag (`trFileBridge.startDrag`), and the main process starts
  the system's drag with their host paths (`webContents.startDrag`) — this
  computer's files only. **Dropping in**: `trFileBridge.localPaths(files)`
  reads a dropped file's host path in the preload and asks the main process
  (`local-paths`) where it is in the root; the page gets root-relative paths or
  `null`, never a host path. Files the root holds are moved (copied with
  `Ctrl`) like entries between panels; anything else is uploaded.
- **Zips**: saving a folder or a selection goes through the same Save dialog
  as a file (`save-zip` on the save channel, `saveZip` on the backend or the
  remote server's `/api/archive/zip`); its size is counted as it is written.

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

The window comes back as it was left (§8.2.1): its size and place when neither
maximised nor full screen, and whether it was either — never minimised. They
are kept in `window-state.json` in the user-data folder (`window-state.ts`, no
`electron` import), a moment after each move or resize and once more as the
window closes. A place that no screen shows any more — a monitor unplugged — is
dropped and the OS centres the window; a size larger than the screen is cut to
it. Wayland compositors place windows themselves, so there only the size and
the state are restored.

So does its zoom (§8.2.3), kept there too and given back as the window's
`zoomFactor` — Chromium's own per-origin zoom would forget it, the page's
origin being new on every start. The title bar's zoom control asks for it over
the window channel (`zoomIn`, `zoomOut`, `resetZoom`, `setZoom` with a factor
clamped to 50–300 %); `Ctrl`+`=` / `-` / `0` are the application menu's
accelerators. Both go through `applyZoom` (`window-controls.channel.ts`), which
pushes the new level to the page and to `MainWindow` to remember; the levels
are `window-zoom.ts`'s.

## Layout

| File | Role |
| --- | --- |
| `src/main.ts` | Electron lifecycle only: single-instance lock, ready, activate, quit |
| `src/desktop.config.ts` | Every environment lookup, and where to find things |
| `src/desktop.stack.ts` | The server: backend + bundle + fallback |
| `src/main-window.ts` | The window, and the rules about what may happen in it |
| `src/fs-bridge.channel.ts` | The IPC channel: who may ask, and nothing else |
| `src/bridge-sessions.ts` | Each window's session, and which backend it talks to |
| `src/remote-backend.ts` | A remote server's REST API, spoken as bridge commands |
| `src/shell-trash.ts` | The system trash, for file operations on this computer |
| `src/desktop-shell.ts` | Open with an app / Show in Folder: the shell's interface, and what counts as a program |
| `src/system-places.ts` | Home, the user's folders, drives and mounts, for the Places pane |
| `src/settings-store.ts`, `src/settings.channel.ts` | The page's settings, in a file in the user-data folder |
| `src/system-clipboard.ts`, `src/electron-clipboard.ts` | Files on the system clipboard, both ways |
| `src/drag-out.channel.ts` | Entries dragged out of a panel into other apps |
| `src/window-controls.channel.ts` | The four verbs a page may use on its own window |
| `src/self-update.ts`, `src/update.channel.ts` | Upgrading from the share: what is newer, putting it in place, the *Upgrade* button's channel |
| `src/app-menu.ts` | The accelerator table; deliberately without `Ctrl`+`W` |
| `src/preload.cts` | The two small objects the renderer is given |
| `scripts/bundle.mjs` | The build: one file for the main process, one for the preload |
| `electron-builder.yml` | The distributables: one executable per platform |
| `build/` | Icons the packager reads; not shipped inside the app |

Only `main.ts`, `main-window.ts`, the `*.channel.ts` files, `electron-clipboard.ts` and the preload import
`electron`. Everything Electron knows
reaches `DesktopConfig` as a plain `DesktopEnvironment`, which is what lets the
whole stack be booted and tested by `pnpm test` with no desktop session at all —
`src/desktop.stack.test.ts` starts the real thing, checks over HTTP that it
serves the bundle and no API, and reaches the files through its bridge.

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

### Showing and hiding it from anywhere (PRD 001, §8.5)

`Ctrl`+`` ` `` is a *global* shortcut — it works while another app has the
keyboard — registered through Electron's `globalShortcut` once the window is
up, and given back on quit (`window-visibility.ts`). One press behaves like a
drop-down terminal: the window you are looking at hides; a hidden, minimised
or background window comes to the front with the keyboard. It is `Control`
on macOS too, because `Cmd`+`` ` `` is the system's own window-cycling key.
Launching the app again also brings a hidden window back (the single-instance
lock hands the launch to the running copy).

When the chord cannot be had — another app owns it, or the session offers no
global shortcuts — the app logs a warning and runs without it. On Linux the
`GlobalShortcutsPortal` feature is switched on, so a Wayland session grants it
through its desktop portal (which may ask the user once); an X11 session needs
nothing.

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
pnpm package:win      # release/tr-file-0.1.0-x64.exe, release/tr-file-Setup-0.1.0-x64.exe
```

From the workspace root: `pnpm desktop:package`, `…:linux`, `…:win`, which
build the whole workspace first. Everything lands in `desktop/release/`.

**AppImage** on Linux and **portable `.exe`** on Windows are the two targets
that *are* a single executable — a `.deb` or an NSIS installer would be a thing
that installs the app rather than the app itself, which §8.3 does not ask for.
The Windows executable unpacks itself into a temporary directory and runs from
there; `unpackDirName` pins that directory so repeated runs reuse it instead of
leaving one behind per launch.

### The Windows setup (PRD 001, §8.4)

Beside the portable executable, `package:win` makes
`tr-file-Setup-<version>-x64.exe`: one file that **installs** the app — or,
run where it is installed already, **updates** that copy in place. It is
electron-builder's NSIS target, set up in `electron-builder.yml` as:

- **one click** — no wizard; running the file is the whole of installing or
  updating, and it starts the app when it is done;
- **per user** — into `%LOCALAPPDATA%\Programs\tr-file`, with a Start-menu and
  a desktop shortcut: no administrator, no UAC prompt, for an update either;
- **the same installation every time** — the setup finds the previous version
  by its `guid` in the registry, runs that version's uninstaller silently and
  installs over it. The user's settings survive (`deleteAppDataOnUninstall:
  false`), and a copy still running is asked to close first. The `guid` is
  pinned to exactly what electron-builder derives from `appId`, so it matches
  installs made before it was pinned, and renaming `appId` can never turn an
  update into a second, side-by-side install.

Building the setup on Linux would normally take **Wine**: electron-builder runs
a stub installer once, so that it writes its uninstaller. The package scripts
avoid that — `scripts/nsis-toolset/` stands in for Wine and reads the
uninstaller out of the stub with electron-builder's own reader instead (see its
README). So `pnpm package:win` needs nothing installed: no Wine, no `sudo`, no
Docker. (electron-builder's own downloadable Linux Wine, `toolsets.wine`, is no
help here: its archive ships without Wine's Windows DLLs and cannot start.)

### Self-updating (PRD 001, §8.6)

The distributables are published to a folder on the office share, and every
packaged copy watches it — at start and every 15 minutes:

| Platform | Folder | Files |
| --- | --- | --- |
| Windows | `S:\Library\Software\Applications\Tronog\TR-File` | `*.exe` — the portable one for a portable copy, `*Setup*` for an installed one |
| Linux | `/S/Library/Software/Applications/Tronog/TR-File` | `*.AppImage` |

`TR_FILE_UPDATE_DIR` names another folder, and `off` turns it off; a
development run (not packaged, or no `APPIMAGE` / Windows) never updates.

There is no feed and no version to read: a file is a new version when its
**size and modified time** are not those of the file this copy was installed
from — the **name** plays no part, and may stay the same from one version to
the next. `update-state.json` in the user-data folder records that key, and
the file it was installed as. Of several, the most recently modified wins; one
modified in the last 30 s is taken to be still copying and waits. Where the
running file is not the one recorded (a copy installed by hand, or an older one
started from its old shortcut), it stands in itself — the same size is the same
file, whatever a copy did to its time — or, for the installed kind, a name
carrying `app.getVersion()`; either records the share's key from then on.

While one is there the page's title bar shows a blue **Upgrade** right of the
command palette box (`UpdateChannel` → `window.trFileUpdate` → `AppUpdateFeature`). Pressed
and confirmed, `SelfUpdate.apply`:

- **AppImage** — copies the new file beside the running one (a dot-name) and
  renames it over it, so the path every shortcut points at stays.
- **Windows** — a program on a network share will not run, so the new file is
  always copied into the **local temporary folder** first
  (`%TEMP%\tr-file-update\…`) and run from there:
  - **portable `.exe`** — into a folder of its own per version, and that copy
    is the app from then on; the old `.exe` is left alone (started again, it
    is offered the upgrade once more). Folders of versions no longer running
    are removed on the next start.
  - **installed** — the setup, run with `--updated /S --force-run`: silent,
    over the installation (§8.4), and it starts the app when done.

The file on the share is checked again before and after the copy, so one
changed meanwhile is refused and the running copy left alone; a failure is
said in the window. The new copy is then started directly — the local
AppImage or `.exe`, or the setup — as a process of its own, with
`--tr-file-upgraded`, and the app quits once it is running (if it cannot start,
the window says so and stays). Nothing waits in between: a copy started with
that flag asks for the single-instance lock again for up to 20 s while the old
one exits, and the portable launcher unpacks into a folder of its own each run
(no `unpackDirName` — with a fixed folder, the new launcher would unpack into
the one the old launcher deletes as it exits). A batch helper that waited
instead opened a console window for every `tasklist`/`find` it ran.

Every step — what was copied from where to where, and what was started with
what — is appended to **`update.log`** in the
user-data folder (`%APPDATA%\tr-file\update.log`, `~/.config/tr-file/update.log`):
the first thing to read when an upgrade does not come back.

*File › Check for Updates…* (§8.6.1) asks the same channel to look now
(`check`) rather than at the next quarter hour, and the window always answers:
up to date, a newer version — offered for upgrade on the spot, or left on the
title bar for later —, the folder could not be read (a periodic check only logs
that, once), or this copy does not update itself (a development run, or
`TR_FILE_UPDATE_DIR=off`).

`pnpm publish:share [folder]` copies this version's AppImage and `.exe`s from
`release/` to the share, each under a dot-name renamed into place, so no copy
ever sees half a file.

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

Every target is built from Linux. The AppImage and the portable executable
need no Wine — electron-builder carries its own NSIS, and stamps the
executable's icon and version itself; the setup does (see above). What
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
