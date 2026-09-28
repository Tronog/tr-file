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
The other way round (§9.1.2), the tree follows what a panel *opens*, not what it selects: the tree
keeps its own highlight (`ExplorerFeature.select` / `reveal`), separate from the workbench-wide
`selectedEntryId` the details sidebar follows. `FileBrowserFeature.navigateTo` / `openFolder` —
which opening a folder, Up, breadcrumbs, *Jump to Folder* and `Alt`+`←`/`→` all go through — call
`reveal`, which opens the folders above and highlights the target; `UiTree` scrolls a newly
selected row into view. Opening a file reveals the folder it is in.
Inside a panel body the library components move focus (arrows, `Home`/`End`, page keys,
type-to-find, selection following focus) and report the keys that mean something to the
workbench — `Enter`, `Space`, `Backspace`, `Ctrl`+`R` (refresh), `+`/`-`, and `Alt`+`←`/`→` — as a
`UiPanelKey`; `PanelKeyboardFeature` is the one place those bindings are decided.
**Midnight Commander (PRD 004, §2).** The function keys are the *window's*, not a panel's:
`F1`–`F10` are window bindings of `KeybindingsFeature` (palette, rename, view, edit/open, copy and
move — to the other panel's folder —, mkdir, trash, main menu, and quit on the desktop), each a
command of `CommandsFeature` run on the active panel; `FunctionKeysFeature` draws the strip in the
middle of `UiStatusBar` (`functionKeys`) from whatever they are bound to. `F5` copies, so refreshing is `Ctrl`+`R` (the desktop's
accelerator table leaves it unbound). In the list and grid `Insert` marks and moves on and `*`
selects all or none (`UiListSelection`); `+`/`-` select or unselect by a pattern
(`FileBrowserFeature.selectByPattern`, `listing/name-pattern.ts`). `/` (split — PRD 002, §2.2),
`Ctrl`+`T` (a new tab on the same folder, `EditorGroupsFeature.newTab`), `Ctrl`+`W` (close the
focused tab) and `Ctrl`+`PageUp`/`PageDown` (previous/next tab) are bound on the group's host
instead, and emit what the tab bar's buttons do (`new-tab` for `Ctrl`+`T`); `/` is a character, so
the list and the icon view let a panel-bound character past type-to-find while no name is being
typed (`isPanelCharacter`), and the group ignores it in a text field. `Ctrl`+`Enter` and
`Ctrl`+double click (§2.5) open the focused entry in a new tab of the *other* panel — with two,
the other one; with more, the previous one, or the next in layout order once it has gone
(`EditorGroupsFeature.otherGroupOf`); splitting one off only when there is none — and take the keyboard there (`FileBrowserFeature.openEntryAside`); the key is
`UiFileBrowser`'s, on its host, and the double click the views' `activateAside`; `Ctrl`+`Tab` / `Ctrl`+`Shift`+`Tab` (PRD 002 §2.6) walk the ring explorer → each
panel in layout order → bottom panel (while open) → details, and round: `FocusCycleFeature`
decides the ring, the `Workbench` component finds the `data-focus-region` that has focus and
focuses into the next (a panel through `PanelFocusFeature`, a sidebar where focus last was in it).
Plain `Tab` / `Shift`+`Tab` in a panel's *body* (`data-panel-body`, set by `UiPanelBody`; never
in a text field or the chrome above it) walk the panels only, in layout order and round
(`FocusCycleFeature.panelDirectionOf` / `nextPanel`) — Midnight Commander's `Tab`; with one
panel (or one maximized) `Tab` keeps its usual meaning.
A browser keeps those chords for its own tabs, so they reach the page on the desktop only; the desktop shell installs its own accelerator
table so Electron's default `Ctrl`+`W` cannot close the window instead (`prj/desktop/src/app-menu.ts`). `Alt`+`↑` goes up a directory, and `Alt`+`←`/`→` walks
`PanelHistoryFeature`, which keeps a browser-style trail of visited folders *per panel*,
since two panels are two places someone is working. Any key that changes the folder also
re-asks for body focus, or the rows it was standing on are gone and the keyboard is left
outside the panel — and that includes opening a folder by double click. An empty folder
has nothing focusable in it, so the content's `uiPanelBody` carries `tabindex="-1"` and
takes focus itself; otherwise a keyboard user could walk into one and not get out.
Double-clicking a tab maximizes or restores its group (§6.1.1) — the bar reports the
gesture, the app decides what it means. So does `Ctrl`+`↑` (PRD 002, §2.8: keymap
`view.toggleMaximize`, a command of the table, answered on the group's host); the list and the icon
view let a `Ctrl` chord bound above them pass instead of moving their cursor (`isBoundAbove`), so
`Ctrl`+`↓` is still a cursor move that leaves the selection alone. Choosing a tab (a click, not an arrow-key rove),
or pressing blank space anywhere in a panel — its body, the tab bar beside the tabs, the
loading rail, the gaps of the content's toolbar (PRD 002, §3.1; an element that answers a
press itself, like the editable path bar, is marked `data-own-press`) — hands focus to that
panel's content once it has rendered, and a click on a column header to sort gives focus back
to the cursor's row in its new place — (`UiFileList`). Whenever focus is handed to a listing from
outside — any of the above, `Tab` from another panel, a folder entered — while nothing is
selected, the first row or tile takes the cursor and becomes the selection (PRD 002, §3.1); a
click and the view's own key moves keep their own rules; `PanelFocusFeature` owns
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
`PgUp` / `PgDown` over an image (PRD 012, §1.1; keymap `image.previous` / `image.next`, answered by
`UiFileBrowser` only while it shows one) step the tab through its folder's images, in the order the
panel sorts that folder and round at the ends (`FilePreviewFeature.stepImage`): the next picture is
loaded before the tab moves to it, and a press meanwhile counts on from the one loading.
In the viewer itself (§1.2) `+` / `-` zoom, `1` is 100 % and `0` the default fit — keymap commands
in their own context, `when: 'image'`, so a digit is never taken from type-to-find in a listing —
and the arrows pan an image larger than the view (`UiImageViewService.panBy`; navigation, so fixed).
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
items are commands of the table, laid out in `MockDataWorkbenchService.settingsMenuItems`:
hidden files, restore the layout on start, reset it, clear recent folders (PRD 003, §6).
The title bar's last button, the layout grid (PRD 001, §15.1.1), is *Reset Layout* too
(`ChromeFeature.runTitleBarAction`); `view.resetLayout` asks first wherever it is run from
(`SessionFeature.confirmResetLayout`), since the window then reloads fresh.

The main menu (PRD 008, §1) is File, Edit, Selection, View and Go, from
`MockDataWorkbenchService.menuItems`; `UiTitleBar` draws the menus, `ChromeFeature` holds
which is open (`setMenuOpen`) and runs entries (`runMenuItem`, through `CommandsFeature`).
Go ends with *Local Computer* — checked while `WorkbenchService.backend` is `local`, the default and, until
PRD 006, the only one — and *Remote Computer…*, which opens the command palette at *Connect
to Remote Server* (`CommandPaletteFeature.run`).

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

**Settings (PRD 010).** The gear menu's *Settings* / *Keyboard Shortcuts* (and `Ctrl`+`,`) open
the settings window: `SettingsEditorFeature` opens `SettingsModal` — the library's
`UiSettingsEditor` in a `size: 'large'` modal — with *General*, *Appearance* and *Keyboard
Shortcuts* pages and a search box. The settings are `PREFERENCES` in `PreferencesFeature`: hidden
files and restoring the layout are read and written where they already live (the session,
`SessionFeature`); auto refresh, the function-key bar and thumbnails are kept under
`tr-file.preferences.v1`, only while they differ from their default; *Reset Layout* and *Clear
Recent Folders* are actions that run their commands. *Explorer: Location* and *Details: Location*
(PRD 010, §3) are two choices, left or right, and both may be the same side:
`PreferencesFeature.explorerSide` / `detailsSide` set `UiWorkbench`'s `leftAt` / `rightAt` (the slots
keep their names — `left` is the Explorer, and the activity bar goes wherever it goes; on one side
together the two stand side by side, the Explorer outermost), the activity bar's and sidebars'
`side`, the `Ctrl`+`Tab` ring's order (left to right as shown) and which way the gear's menu opens.
Each sidebar's sash sits in it, on the edge facing the centre.
*Workbench: Color Theme* (PRD 010, §4) is Dark Modern (the default), Light Modern or Follow the
System: the library's tokens are dark on `:root` and light under `data-theme="light"`, which the
root `ThemeService` (`prj/frontend/src/app/settings/`) sets — from the stored preference as the app
starts (before the sign-in screen), on each change, and with the OS while following it. Two things
paint before Angular does, and both read the same preference: an inline script in `index.html` (a
browser's `localStorage`) and, on the desktop, the window's `backgroundColor`
(`desktop/src/window-background.ts`, from the main process's settings file).

**Every key is configurable (PRD 010, §2).** The library's components never test a key for a
command themselves: they ask the library's root `UiKeymap` (`prj/libs/ui/src/lib/keyboard/keymap.ts`)
which of their commands it is bound to, in their context — `list`, `panel` or `window` (VS Code's
`when`). `KeybindingsFeature` owns the table: `UI_DEFAULT_KEYBINDINGS` plus
`WORKBENCH_DEFAULT_KEYBINDINGS`, less what the user removed, plus what they added
(`tr-file.keybindings.v1`), handed to `UiKeymap` on every change. It runs the `window` keys itself
(`handleShortcut`, from the `Workbench` component: the palette, search, the function keys, `Ctrl`+`H`,
`Ctrl`+`,` — each a command of `CommandsFeature` on the active panel; `F2`–`F4` act on the cursor's
entry), and it is where menus, the palette and the function-key strip read the key they show
(`label`, `keysFor`, `windowCommandOf`) — so the table has no key labels of its own. `Ctrl`+`Tab` and
`Tab` between panels are keymap commands too (`workbench.focusNextPart`, `workbench.nextPanel`),
answered by `FocusCycleFeature` because they move DOM focus. Navigation keys (arrows, `Home`/`End`,
page keys, type-to-find, `Escape`, keys inside menus and dialogs) are not commands and stay fixed.
A new key for the app: a binding in one of the default tables, and the component asks the keymap
for its command id.

**Git (PRD 011, §1)** is optional — the backend's `git` module (`/api/git`, the bridge's `git`
command, `RemoteBackend` maps it) runs the system's `git`, and says so when there is none; a
production server needs `GIT_ENABLED=true`, the desktop turns it on. A folder is in a repository
when it or a folder above it inside the root holds a `.git`. The right sidebar's **Git** pane — at its top, and there only while the folder shown is in a
repository (§2.1) — is `GitFeature`: it follows the active panel's folder (an `effect`, started by the `Workbench`
component, never by `WorkbenchService.start`, so specs ask nothing of git), keeps the status, log
and a draft message per repository, and builds the `UiScmModel` the library's `UiSourceControl`
draws — stage, unstage, discard (asked first), commit (offering to stage all), sync/pull/push/
publish, fetch, stash/pop, init. Branches are picked and made in the command palette
(`CommandPaletteFeature.prompt`); the pane's `…` is `ContextMenuFeature.openGitMenu` over the
`git.*` commands of `CommandsFeature`. Choosing a change opens a `diff` tab (`GitDiffFeature`,
drawn as a `kind: 'diff'` document). Auto-refresh also watches the repository's `.git`, so a
commit made in a terminal shows up.

The status bar's last item is the backend machine's date and time (§13.1): `ServerClockFeature`
asks the server (`/api/health`'s `timestamp`, `timeZone`, `utcOffsetMinutes`; the bridge's `time`,
which `RemoteBackend` maps to a remote server's health) on start and every 10 minutes, keeps the
difference from this computer's clock, ticks on the server's minute, and formats in the *server's*
zone — started by the `Workbench` component, like Git, so specs ask nothing.

The panes of the Explorer and Details sidebars can be rearranged (PRD 002, §5.1): a `UiPane` with a
`paneId` drags by its header onto another pane of the same sidebar (upper half before it, lower half
after), or moves a slot with `Ctrl`+`↑`/`↓` on its header, and reports a `UiPaneMove`;
`SidebarPanesFeature` keeps each sidebar's order (`order`, `move`), `workbench.html` draws the panes
in it with `@for`/`@switch`, and the session remembers it (`paneOrder`, only where it is not the
default). In Details the entry's card heads the first pane that is not Git (`detailsCardBefore`).
Their heights too (§5.2): every boundary with an expanded pane above it and one at or below it has
a `UiSash` (on the top edge of the pane under it, collapsed or not — `UiSidebar`'s stylesheet decides
which); dragging it trades height between those two, collapsed headers riding along, and the
pane reports every expanded pane's measured height (`UiPaneResize`). `SidebarPanesFeature` keeps
them by id (`sizeOf`, `resize`, the session's `paneSizes`) and hands them back as `size`, which the
pane uses as a `flex` weight — so the panes keep their proportions as the window changes height.
A pane opened among sized ones takes the average of theirs.

The bottom panel starts collapsed (§12.1): it keeps its tab bar, whose counts say when
something happened, and the button VS Code would close it with is the collapse toggle — a
double chevron pointing the way the panel will move. Choosing a tab, including from the
activity bar, opens it again; `BottomPanelFeature` owns all of that and `UiBottomPanel` only
takes a `collapsed` input.

The workbench remembers the active panel and the one active before it (PRD 002, §2.7):
`WorkbenchService.previousGroupId`, kept by `EditorGroupsFeature` — every change of active panel goes
through its `activate()`. A file action's source is the active panel and its destination the previous
one: *Copy To…* / *Move To…* (and `F5` / `F6`) offer that panel's folder, falling back to the next
folder panel in layout order when it has gone or shows no folder.
The details sidebar's Actions pane ends with both (§2.7.1, `DetailsFeature.transferPaths`, from
`OperationsFeature.defaultDestination`), so what `F5` / `F6` will offer is visible beforehand.

File operations (PRD 005 §1) — copy, move, move to trash, empty trash — are backend jobs,
started and followed by `OperationsFeature`: it asks first (destination, what to do with
taken names, and *always* a confirmation before anything is trashed or the trash emptied),
then polls each running job once a second — never faster, so neither the UI nor the channel
is flooded. A job still running at its first poll opens a progress window
(`OperationProgressModal` over the library's `UiProgressDialog`: *Run in Background* /
*Cancel*); every job is a row in the bottom panel's Progress tab, with a stop button while it
runs. When one ends, the folders it names in `affected` are re-read. An entry a job cannot do
(PRD 001, Fix 3) does not end it: the frontend starts jobs with `errors: 'ask'`, the job waits
(`state: 'waiting'`, with its `problem`), and `OperationsFeature` asks as Midnight Commander does —
*Skip*, *Skip All*, *Retry*, *Abort* (`Escape`) — answering with `/api/ops/jobs/:id/resolve` (bridge
`op-resolve`).
After a file action the keyboard goes back into the content of the panel it acted on (PRD 001,
Fix 5): `CommandsFeature.run` does it once a file action's dialogs are done (`FILE_ACTIONS` — not
open, reveal, filter or search, which send focus elsewhere on purpose), and `OperationsFeature` again
when a job ends, after the folders it changed are read again and its progress window has closed.
`PanelFocusFeature.returnFocus` never takes it from another window, a text field or another region. Entry points: `Delete` in a
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

**What every file manager has (PRD 003, §5).** One command table,
`CommandsFeature`, is what the main menu (laid out by id in
`MockDataWorkbenchService.menuItems`), the right-click menus
(`ContextMenuFeature`, per kind of target: entry, entries, blank space, tree
folder, tab), the palette and the panel keys all run — each command is a label,
a key to show, an `enabled` rule and a `run` over a `CommandTarget` (group,
paths, folder). Rename (`F2`), New Folder (`Ctrl`+`Shift`+`N`) and New File are
`FileEditFeature`: a modal prompt, one `/api/fs` request, then every path that
knew the old name follows it (`relocatePath`). `UndoFeature` (`Ctrl`+`Z`) keeps
the last 20 changes: rename back, trash what was created or copied, rename moved
entries back from a job's `outcome`, restore trashed ones where the trash
`canRestore`; a delete, or the system trash, says it cannot. `Shift`+`Delete`
deletes for good, always after asking. Panels sort by clicking a column
(folders always first, `listing/listing-order.ts`) — the order and the view (list, grid,
tree) are the *folder's* (PRD 004, §1.3.1): `FolderViewsFeature` keeps them per folder in
`SettingsService`, every panel showing a folder shows it that way, and a folder nothing was
chosen for keeps its panel's last (`PanelGroupState.view` / `sort`) — and
filter with the toolbar box (`Ctrl`+`F`, cleared on leaving the folder); the path
bar is an address bar (`Ctrl`+`L`, `goToLocation` — a file opens its folder,
selected); the toolbar has Back and Forward. What the app cannot preview (PDF,
Office, archives, too large) opens with `SystemOpenFeature` — the default app on
the desktop (the main process asks before running a program), a new browser tab
served `inline` otherwise; *Reveal* exists only on the desktop, for local files. *Copy Path* (`Ctrl`+`Shift`+`C` in a panel — the `copy-path` panel key) copies
the *full* path (PRD 004, §1.3.2) — `SystemOpenFeature.copyPaths` → `FsTransport.copyPaths`: on the
desktop the main process writes the real host paths (`clipboard-write-paths` — the window's own
clipboard permission is denied; a remote server is asked with `host-paths`), in a browser the page
asks `/api/fs/host-paths` and writes with the Clipboard API, or `execCommand('copy')` where the page
is not a secure context; a failure is said, never swallowed.
The activity bar's Search (`Ctrl`+`Shift`+`F`) is `SearchFeature`, a name search
under the workspace or the active folder (`/api/fs/search`). `AutoRefreshFeature`
polls `/api/fs/watch` every 2 s with the folders on screen and re-reads what
changed; folders leaving the screen are `expire`d in `FsDataFeature`, read again
when next shown.

**A whole computer's files (PRD 003, §6).** On the desktop the root is `/` — on Windows every
drive, `FilePathResolver.drives()`, paths like `C:/Users` — and a fresh window starts in the
home folder `/api/fs/places` names. `PlacesFeature` fills the explorer's Places pane (root,
home, user folders, drives, mounts — a server names its root only, so in a browser the pane
starts closed and asks when opened), Bookmarks and Recent; the activity bar's Bookmarks opens
that pane. Bookmarks, recent folders and the session (`SessionFeature`: groups, tabs, views,
sorts, grid, sizes, panes, bottom panel, hidden files) are kept per backend in
`SettingsService` (`prj/frontend/src/app/settings/`) — `localStorage` in a browser, a file
the main process keeps on the desktop, whose page origin is new on every start — loaded by
an app initializer so `WorkbenchService.layout` is the restored one before any feature
reads it; the Settings menu switches restoring off and resets the layout. The root's name
is `WorkbenchService.workspaceName()`. Where the desktop is on its own computer
(`systemFt.sharesFiles`), `FileClipboardFeature` shares the system clipboard, a drag out of a
panel is the system's (`UiFileBrowser.nativeDrag`), and files dropped from outside that the
root holds are moved like entries (`FileBrowserFeature.dropFiles`); anything else dropped —
folders too — is uploaded (`TransfersFeature.uploadDropped`, *Upload Folder…*). The icon
view draws thumbnails `ThumbnailsFeature` makes of what it has on screen (`UiIconView.shown`).
The trash (PRD 001, §14.1) is the last row of Places: `TrashFeature` opens it as a `trash` tab
(read-only, like a zip) listing what `GET /api/ops/trash-items` (bridge `op-trash-list`) says is in
it — where each entry was and when — with *Restore* where the trash can (the server's) and *Empty
Trash*; while a panel shows it, the details sidebar describes it (or the entry picked) with *Empty
Trash…* among its actions. The desktop's system trash lists on Linux (freedesktop `.trashinfo`);
macOS and Windows say theirs is the file manager's (`canList: false`) and still empty from here.
Zips: the `archive` backend module; a `.zip` opens as an `archive` tab
(`ArchiveBrowserFeature`, read-only, `inner` is the folder inside it); *Compress…*,
*Extract Here* / *To…* are `/api/ops` jobs Undo trashes; a folder or a selection downloads
as one zip.

Since Section 7.1 the workbench runs on real data: `prj/frontend/src/app/file-system` is the
`/api/fs` client, and `FsDataFeature` is the path-keyed cache the tree, the panels and the details
sidebar all read from. Fetches are only ever started by an action (expanding a node, opening a
folder, selecting an entry) — never from a `computed`, which would write signals during change
detection. What is left of `MockData*` is the shell the session starts with: menus, activity bar
and the initial layout — two panels side by side on the root, the left one active (PRD 002, §1.3).
Specs of the layout's mechanics start from one panel instead (`provideOnePanel()`,
`workbench/testing/one-panel.ts`).

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
Choosing another tab of the panel does not lose it (PRD 001, Fix 4): the tab being left keeps it
(`PanelTabState.remembered`), the tab chosen gets its own back — with the details sidebar on its
cursor — and none of it is written to the session (`EditorGroupsFeature.withTabs`).

# Backend
Refer to `docs/ai/EXPRESS.md`. Every `/api` route but `/api/auth/*` and `/api/health`
needs a session when an account is configured (`AUTH_USERNAME` + `AUTH_PASSWORD[_HASH]`);
a production server refuses to start without one. Every write needs the
`X-TR-File-Request: 1` header (CSRF) — the frontend's `csrfInterceptor` adds it — and the
frontend shows `auth/login` until `AuthService` says there is a session (PRD 003, §2).
The file-system API lives at `/api/fs`
(listing, details, download — `inline` for a browser tab —, upload, rename, mkdir, create,
search, watch) — see `prj/backend/README.md` for the
endpoint reference, the error codes and the `FILES_ROOT` confinement rules. File operations are the `operations` module at `/api/ops`: background jobs (copy, move,
trash, empty-trash, delete, restore), polled by id and cancellable, each reporting an
`outcome` Undo reads; the server's trash is `.tr-file-trash` in the root, reserved by the
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
unless `TR_FILE_AUTH_USERNAME` (with a password) is set. Its root is the whole file system
unless `FILES_ROOT` pins it; places, the settings file, the system clipboard and drags out
are the main process's (PRD 003, §6, `prj/desktop/README.md`).

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
Section 8.4 adds a Windows setup beside the portable `.exe`: electron-builder's NSIS target, one
click and per user, whose pinned `nsis.guid` makes a later setup update the installed copy in place
(settings kept) rather than install a second one. Building it on Linux needs no Wine:
`desktop/scripts/nsis-toolset` stands in for it, reading the uninstaller out of electron-builder's
stub with electron-builder's own reader (`prj/desktop/README.md`).

File operations (PRD 005 §1) run in the backend on whichever side the window is on; on
this computer `App` is given `ShellTrash`, so trash goes to the system trash
(`shell.trashItem`), and on a remote server `RemoteBackend` maps the `op-*` commands onto
its `/api/ops`.

Opening with the system (PRD 003, §5): `BridgeSessions` answers `shell-open` and
`shell-reveal` itself, through an injected `DesktopShell` (`desktop-shell.ts`) — Electron's
`shell.openPath` / `showItemInFolder` in `main.ts`, stubs in tests. A local path comes from
`bridge.localPath` (main process only, never a command); a remote file is copied to a temp
folder first, and Reveal is refused for it. Anything that looks like a program is confirmed
with a native dialog in the main process, so the renderer cannot skip it.

Section 8.5: `Ctrl`+`` ` `` shows and hides the desktop window system-wide — a global shortcut the
main process registers (`desktop/src/window-visibility.ts`, `VisibilityShortcut`), which hides the
window being looked at and brings back a hidden, minimised or background one; on Linux the
`GlobalShortcutsPortal` feature lets a Wayland session grant it. A chord already taken is logged,
not fatal.

Section 8.2 took the window's frame away: `UiTitleBar` is the title bar, with the drag
region and the window buttons in it. `WindowControlsChannel` plus the preload give the
page four verbs over its own window, `DesktopWindowService` is the frontend seam, and
`WindowControlsFeature` decides what the bar shows — nothing in a browser, no buttons
but a gap on macOS (the traffic lights stay), all three everywhere else.

# Docker
Refer to `docs/ai/DOCKER.md`. Two Compose environments live at the workspace root:
`prj/compose.dev.yaml` (ports exposed directly) and `prj/compose.prod.yaml` (behind nginx).
Both build with `context: .` relative to `prj/`.
