# Overview
This is a TypeScript NodeJS monorepo pnpm workspace.
It is a full stack application consisting of
* Angular frontend - `prj/frontend`
* Express TypeScript backend - `prj/backend`
* docker compose
  * development - ports directly exposed
  * production - behind nginx proxy
* Electron desktop shell - `prj/desktop`
* other future libraries - `prj/libs`

# Layout
`prj/` is the pnpm workspace root. Sources, docker definitions, the workspace
manifest and all config files live inside `prj/` — the git repo root is kept
clean and holds only `.git`, this file, `docs/` and `mockup/`.

```
prj/
├── package.json          # workspace root manifest + docker:* scripts
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json    # packages extend ../tsconfig.base.json
├── compose.dev.yaml
├── compose.prod.yaml
├── docker/nginx/default.conf
├── backend/
├── frontend/
├── desktop/              # @tr-file/desktop — Electron shell
└── libs/
    └── ui/               # @tr-file/ui — workbench component library
```

Use pnpm (via `corepack enable pnpm`). Run `pnpm install` from `prj/`.

# Frontend
Refer to `docs/ai/ANGULAR.md` for architecture (component / component service / feature classes).
Refer to `docs/ai/VSCODE-UI.md` for all Tabler UI markup, layouts and classes — use it instead of
fetching the Tabler docs.

The workbench UI lives in `prj/libs/ui` (`@tr-file/ui`), a zoneless, signal-based component
library ported from `mockup/001/`; see `prj/libs/ui/README.md`, including why that library does
not load Tabler. The app composes it in `prj/frontend/src/app/workbench`: a thin `WorkbenchService`
holding shared state, plus feature classes holding everything else.

A panel is a frame plus content. `UiPanelGroup` renders the tab bar, loading rail and body
frame (drops, focus, the `Ctrl` chords); what the active tab shows is a separate component
the app projects into it — file management is `UiFileBrowser`, with its own model and toolbar
(`UiPanelToolbar`), marking its body `uiPanelBody` so the frame knows where focus goes.
In the app `EditorGroupsFeature` keeps groups and tabs only; `PANEL_CONTENT`
(`panel-group.model.ts`) maps each tab kind to a content type, whose feature
(`FileBrowserFeature` for `'files'`) implements `PanelContentFeature` and renders its model.
`UiFileBrowser` has three views — list, grid, and tree (PRD 002 §4.1): the list's
`UiFileList` with `tree` set, whose folders open in place with the same detail columns.
Which folders are open is `FileBrowserFeature`'s state, per panel; opening one is what
fetches it.
A new kind of content is a new tab kind, a library component, a feature class, and a
`@case` in the leaf template of `workbench.html` — see `prj/libs/ui/README.md` § Panel content.

The explorer tree lists *folders only* (§9.1.1) — it is a map of the workspace, and files
belong to the panels. Clicking a folder in the explorer shows it in the *active* panel; that
link lives in `ExplorerNavigationFeature` so neither side has to know about the other.
Inside a panel body the library components move focus (arrows, `Home`/`End`, page keys,
type-to-find, selection following focus) and report the keys that mean something to the
workbench — `Enter`, `Space`, `Backspace`, `F5`, and `Alt`+`←`/`→` — as a `UiPanelKey`;
`PanelKeyboardFeature` is the one place those bindings are decided. `Ctrl`+`T` (split),
`Ctrl`+`W` (close the focused tab) and `Ctrl`+`PageUp`/`PageDown` (previous/next tab) are
bound on the group's host instead, and emit the same outputs the tab bar's buttons do;
`Ctrl`+`Enter` (open the focused entry in a new panel on the right) is `UiFileBrowser`'s,
on its host; the desktop shell installs its own accelerator
table so Electron's default `Ctrl`+`W` cannot close the window instead (`prj/desktop/src/app-menu.ts`). `Alt`+`↑` goes up a directory, and `Alt`+`←`/`→` walks
`PanelHistoryFeature`, which keeps a browser-style trail of visited folders *per panel*,
since two panels are two places someone is working. Any key that changes the folder also
re-asks for body focus, or the rows it was standing on are gone and the keyboard is left
outside the panel — and that includes opening a folder by double click. An empty folder
has nothing focusable in it, so the content's `uiPanelBody` carries `tabindex="-1"` and
takes focus itself; otherwise a keyboard user could walk into one and not get out.
Double-clicking a tab maximizes or restores its group (§6.1.1) — the bar reports the
gesture, the app decides what it means. Choosing a tab (a click, not an arrow-key rove),
or pressing the blank space of a panel body, hands focus to that panel's content once it
has rendered; `PanelFocusFeature` owns
that request and `UiPanelGroup` answers it. The workbench asks for it once on start
(§10.1), after the listing is in flight, so the keyboard is already in the folder content
when the app opens rather than needing a click first. Row clicks only ever
open — collapsing is the twisty's job (or `←` on the focused row). Double-clicking a file opens
it read-only in a new tab (`FilePreviewFeature`), markdown rendered: that feature turns bytes
into a `UiDocumentModel`, and the library only renders what it is handed. An image is read by
`ImageSourceService` (`prj/frontend/src/app/file-system/`), one cache of object URLs keyed
by path that owns their lifetime — `PreviewRetentionFeature` tells it (and the text previews)
what is on screen, and everything else is freed but for a few recent ones — and drawn by `UiImageView` — contain by default, five
icon controls, wheel zoom anchored under the pointer, drag to pan, double click back to
contain (§7.3.1). The viewer's model lives in `UiImageViewService`, provided per component.
Selecting an image also shows it on the details card, fitted `contain` and non-interactive
(§9); the panel and the sidebar read from the same cache, so a file is fetched once.

Modal windows (PRD 002, §3) are `ModalService` (`prj/frontend/src/app/modal/`): `await
modal.confirm(…)`, `prompt(…)`, `message(…)`, `show(…)` for a full VS Code message dialog,
or `open(Component, …)` for a component of the app's own, which closes itself through
`MODAL_REF`. `ModalHost` at the root draws the stack with the library's `UiModal` and
`UiDialog`, and `App` makes everything behind it `inert` while one is open. The first user
is an upload whose name is taken: `TransfersFeature` asks Replace / Skip, one conflict at a
time, with "Do this for all remaining conflicts" for a batch.

The Settings gear in the activity bar opens a menu (PRD 007, §1): the item is `hasMenu`, the
bar reports `menuOpen` with the gear's rect, and `ChromeFeature` (`settingsMenu`,
`openMenu`, `closeSettingsMenu`) shows `UiContextMenu` fixed beside it, opening upward. Its
items come from `MockDataWorkbenchService.settingsMenuItems` — for now one disabled `Todo`.

The main menu (PRD 008, §1) is File, Edit, Selection, View and Go, from
`MockDataWorkbenchService.menuItems`; `UiTitleBar` draws the menus, `ChromeFeature` holds
which is open (`setMenuOpen`) and runs entries (`runMenuItem`). Only Go has entries so far:
*Local Computer* — checked while `WorkbenchService.backend` is `local`, the default and, until
PRD 006, the only one — and *Remote Computer…*, which opens the command palette at *Connect
to Remote Server* (`CommandPaletteFeature.run`). The others hold a disabled `Todo`.

The command palette (PRD 009, §1) is `CommandPaletteFeature`: `Ctrl`+`Shift`+`P`, `F1`,
`Ctrl`+`P` or the title bar's command centre open it in the library's `UiQuickInput`;
commands are filtered by `command-palette/fuzzy-match.ts`, and a command that needs a value
turns the box into an input box (`InputStep`: `validate` as you type, `accept` does the work
and returns why it could not). *Go: Jump to Folder…* takes an absolute path within the
workspace and checks it is a folder before showing it; *Remote: Connect to Remote Server…*
is a pick list (`PickStep`) of the servers `SavedServersFeature` keeps in `localStorage`
(`tr-file.remote-servers.v1`) — user, host and port, **never the password** — with edit
(`F2`) and remove (`Shift`+`Delete`) on each row and *Add New Remote Server…* below.
Addresses are `[http(s)://][user[:password]@]host:port` (`remote-target.ts`). Picking or
adding one connects the window to that server (PRD 006, §1) through `RemoteConnectionService`
— desktop only — and, once connected, keeps it and reloads the window against it.

**Remote servers (PRD 006, §1).** The desktop connects to another tr-file server's REST API
from its *main process* — a page cannot: CORS, the `SameSite=Strict` cookie and the CSRF
check all stop it. `RemoteBackend` (`prj/desktop/src/remote-backend.ts`) answers the very
bridge commands `FileSystemBridge` does, over HTTP (chunked reads by `Range`, one streamed
multipart `POST` per upload, the session cookie and CSRF header kept by the client), and
`BridgeSessions` routes each window's commands to the local bridge or its remote server;
`connect` / `disconnect` / `connection-status` are bridge commands too. The renderer's
transport does not change; `WorkbenchService.backend` follows the connection, the status
bar names the server, a remote that needs signing in shows the normal sign-in screen, and
Go › Local Computer disconnects.

The bottom panel starts collapsed (§12.1): it keeps its tab bar, whose counts say when
something happened, and the button VS Code would close it with is the collapse toggle — a
double chevron pointing the way the panel will move. Choosing a tab, including from the
activity bar, opens it again; `BottomPanelFeature` owns all of that and `UiBottomPanel` only
takes a `collapsed` input.

File operations (PRD 005 §1) — copy, move, move to trash, empty trash — are backend jobs,
started and followed by `OperationsFeature`: it asks first (destination, what to do with
taken names, and *always* a confirmation before anything is trashed or the trash emptied),
then polls each running job once a second — never faster, so neither the UI nor the channel
is flooded. A job still running at its first poll opens a progress window
(`OperationProgressModal` over the library's `UiProgressDialog`: *Run in Background* /
*Cancel*); every job is a row in the bottom panel's Progress tab, with a stop button while it
runs. When one ends, the folders it names in `affected` are re-read. Entry points: `Delete` in a
panel (a `UiPanelKey`), the File menu and the palette's `File:` commands.

Copy / cut / paste and drag & drop of entries (PRD 005 §2) sit on top of those jobs.
`UiFileBrowser` reports `Ctrl`+`C`/`X`/`V` as `copy` / `cut` / `paste` panel keys (never in
a text field or the document viewer), and is itself the drag source and drop target: rows and
tiles drag the selection as `UI_ENTRY_MIME`, a folder row (`dropTarget`) or the listing's blank
space (`dropFolder`) takes it, and it emits `entryDrop` — a move, or a copy with `Ctrl`/`Alt`.
`FileClipboardFeature` is the workbench's own clipboard (paths, not the system's); a paste goes
into the panel's folder, a cut is drawn faded (`cut`) until pasted, and pasting a copy where it
came from makes `name copy.ext`. `FileBrowserFeature.dropEntries` turns a drop into
`OperationsFeature.transfer`, which starts nothing for a move to where the entries already are.
Edit › Cut / Copy / Paste run the same.

Since Section 7.1 the workbench runs on real data: `prj/frontend/src/app/file-system` is the
`/api/fs` client, and `FsDataFeature` is the path-keyed cache the tree, the panels and the details
sidebar all read from. Fetches are only ever started by an action (expanding a node, opening a
folder, selecting an entry) — never from a `computed`, which would write signals during change
detection. What is left of `MockData*` is the shell the session starts with: menus, activity bar
and the initial layout.

**No blank frames.** A reload keeps what is on screen: `FsDataFeature`, `FilePreviewFeature` and
`ImageSourceService` go to `status: 'loading'` *with* the previous listing / details / document /
object URL, which is replaced (and, for a URL, revoked) only when the answer lands; a reload asked
for while one is in flight reads once more afterwards. So "loading" means "nothing to show yet"
only when there is no data — `ExplorerFeature.loading`, a tree row's `busy` and the panel's empty
placeholders test for missing data, not for the status. The details sidebar keeps the previous
entry up (`DetailsFeature.stale`, dimmed after 200 ms) while the next one loads, and acts only on
the current one. The library does its part: the loading rail waits `UI_LOADING_RAIL_DELAY_MS`,
a file tab still reading is `pending` (an empty body, not an empty table), `UiPanelGrid` tracks
cells by group and maximizes by hiding the others, and `UiImageView` rescales on `load`, not on
`src`. Keep new code to the same rule.

A symlink is judged by what it leads to (`targetType`, `isFolder`/`isFile` in
`file-system/fs-entry-kind.ts`): a link to a folder navigates, expands and sorts like one.
Previews decide text by sniffing the bytes (`text-sniff.ts`), the extension list only
refuses early. Downloads are rows in the Transfers panel like uploads. Lists and grids of
200+ entries render only what is near the viewport (`UiVirtualViewport` in the library).
Every view selects many (PRD 004, §1.2): `Ctrl`/`Shift` clicks and keys, and box selection in
the icon view, all through `UiListSelection`; the views emit `selectionChange` and
`FileBrowserFeature.setSelection` stores it in the group's `selection` / `focusedEntryId`.

# Backend
Refer to `docs/ai/EXPRESS.md`. Every `/api` route but `/api/auth/*` and `/api/health`
needs a session when an account is configured (`AUTH_USERNAME` + `AUTH_PASSWORD[_HASH]`);
a production server refuses to start without one. Every write needs the
`X-TR-File-Request: 1` header (CSRF) — the frontend's `csrfInterceptor` adds it — and the
frontend shows `auth/login` until `AuthService` says there is a session (PRD 003, §2).
The file-system API lives at `/api/fs`
(listing, details, download, upload) — see `prj/backend/README.md` for the
endpoint reference, the error codes and the `FILES_ROOT` confinement rules. File operations are the `operations` module at `/api/ops`: background jobs, polled
by id and cancellable; the server's trash is `.tr-file-trash` in the root, reserved by the
path resolver so no API reaches into it. The same
API is reachable without HTTP through `App.bridge`, for the desktop shell. Its
frontend client is `prj/frontend/src/app/file-system/`, where `FsHttpService` and
`FsBridgeService` are the two transports behind one `FsTransport`.

# Desktop
`prj/desktop` is the Electron app that runs the whole stack in one process — see
`prj/desktop/README.md`. It does not spawn the backend: `DesktopStack` constructs
`new App(...)` from `@tr-file/backend` in-process and serves only the frontend build
over `express.static`, on a loopback port the OS picks, with a `Host` check; the window
loads that. It serves **no `/api`** (PRD 003, §2) — the window's data goes over the
bridge, and an HTTP API would only let other local programs in. `pnpm --filter
@tr-file/desktop test` boots the real stack with no desktop session, because
`DesktopConfig` and `DesktopStack` import no `electron`. Signing in is off on the desktop
unless `TR_FILE_AUTH_USERNAME` (with a password) is set.

In development the window can load `ng serve` instead of the bundle: `TR_FILE_DEV_SERVER`
names it, `pnpm dev` at the root sets it, and the shell waits for that server and falls back
to the built bundle if it never answers. The bridge is unaffected — the preload belongs to
the window, not to the origin it shows — so only the IPC channels' trusted origin moves,
which is why `main.ts` decides the page URL before it registers them.

Since Section 8.1 the desktop loads the *bundle* over that server and nothing else:
data goes straight to the backend. `App.bridge` (`prj/backend/src/modules/bridge`) runs
the same commands against the same `FilesService` as the HTTP routes, `FsBridgeChannel`
plus a sandboxed preload carry them over IPC, and `FsBridgeService` is the frontend
transport that speaks them. `FileSystemService` picks a transport once — bridge if the
preload is there, HTTP otherwise — so no feature, component or error path below it
knows which one it has.

Section 8.3 packages it: `desktop/scripts/bundle.mjs` compiles the main process —
backend, Express and all — into one `dist/main.cjs`, so the distributable carries no
`node_modules`, and `electron-builder.yml` turns that into a single file per platform
(an AppImage, a portable `.exe`). Nothing in `prj/desktop/package.json` is a runtime
dependency any more, which is why they are all `devDependencies`.

File operations (PRD 005 §1) run in the backend on whichever side the window is on; on
this computer `App` is given `ShellTrash`, so trash goes to the system trash
(`shell.trashItem`), and on a remote server `RemoteBackend` maps the `op-*` commands onto
its `/api/ops`.

Section 8.2 took the window's frame away: `UiTitleBar` is the title bar, with the drag
region and the window buttons in it. `WindowControlsChannel` plus the preload give the
page four verbs over its own window, `DesktopWindowService` is the frontend seam, and
`WindowControlsFeature` decides what the bar shows — nothing in a browser, no buttons
but a gap on macOS (the traffic lights stay), all three everywhere else.

# Docker
Refer to `docs/ai/DOCKER.md`. Two Compose environments live at the workspace root:
`prj/compose.dev.yaml` (ports exposed directly) and `prj/compose.prod.yaml` (behind nginx).
Both build with `context: .` relative to `prj/`.
