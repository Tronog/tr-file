# Overview
This is a TypeScript NodeJS monorepo pnpm workspace.
It is a full stack application consisting of
* Angular frontend - `prj/frontend`
* Express TypeScript backend - `prj/backend`
* docker compose
  * development - ports directly exposed
  * production - behind nginx proxy
* Electron desktop shell - `prj/desktop`
* libraries - `prj/libs`: the workbench (`@tr-file/ui`) and the file manager's components (`@tr-file/file-ui`)
* a demo app on the workbench library alone - `prj/demo`

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
├── tsconfig.angular.json # …and the Angular ones (frontend, libs, demo) this, which extends it
├── compose.dev.yaml
├── compose.prod.yaml
├── docker/nginx/default.conf
├── backend/
├── frontend/
├── desktop/              # @tr-file/desktop — Electron shell
├── demo/                 # @tr-file/demo — a notes app on @tr-file/ui alone (port 4300)
├── scripts/              # check-library-boundaries.mjs
└── libs/
    ├── ui/               # @tr-file/ui — the workbench library (ng-packagr)
    └── file-ui/          # @tr-file/file-ui — the file manager's components on it
```

Use pnpm (via `corepack enable pnpm`). Run `pnpm install` from `prj/`.

# Frontend
Refer to `docs/ai/ANGULAR.md` for architecture (component / component service / feature classes).
Refer to `docs/ai/VSCODE-UI.md` for all Tabler UI markup, layouts and classes — use it instead of
fetching the Tabler docs.

**The libraries (PRD 001, §17.1).** The workbench is a library of its own, `prj/libs/ui`
(`@tr-file/ui`): zoneless and signal-based, ported from `mockup/001/` — see `prj/libs/ui/README.md`,
including why it does not load Tabler. It holds nothing of an application's business (nothing that
touches a backend, directly or through a feature or a service): the presentational components, and
a configurable shell — `UiWorkbenchService` with its features (sub-apps, panels and their layout,
focus, sidebar panes, bottom panel, chrome, command table, keys, palette, context menus, preferences,
the settings and Help windows, the session), driven by a `UiWorkbenchConfig` and drawn by
`<ui-workbench-shell>` with the application's templates — plus `UiModalService`, `UiThemeService`
and the settings store (`UI_SETTINGS_STORE`, `UI_STORAGE_PREFIX`). The file manager's components —
`UiFileBrowser`, `UiFileList`, `UiIconView`, `UiDiskUsage`, `UiSourceControl`, `UiTransferList`,
`UiPermissionGrid`, their models and keys (`provideFileUi`) — are `prj/libs/file-ui`
(`@tr-file/file-ui`, `prj/libs/file-ui/README.md`). Both are ng-packagr libraries with their own
tests (`pnpm build:libs`, `pnpm test:libs`, after `scripts/check-library-boundaries.mjs`); the
apps compile their sources (`paths`). `prj/demo` (`pnpm demo`) is a notes app on `@tr-file/ui`
alone, built against the packaged library by `pnpm demo:build`.

The app composes them in `prj/frontend/src/app/workbench`: `WorkbenchService` extends
`UiWorkbenchService` — a thin service holding the app's shared state, plus feature classes holding
everything else — configured by `trFileWorkbenchConfig` (`workbench.config.ts`: sub-apps, the
sidebars' panes, menus, keys, settings, the cheatsheet, how a session is read). Where the file
manager does more than the library, it overrides the library feature's `create…` with a subclass:
`EditorGroupsFeature`, `CommandsFeature`, `ChromeFeature`, `BottomPanelFeature`,
`CommandPaletteFeature`, `ContextMenuFeature`, `KeybindingsFeature`, `PreferencesFeature`,
`SessionFeature`, `SidebarPanesFeature`, `SubAppsFeature`. The rest are the library's as they are
(`UiPanelFocusFeature`, `UiFocusCycleFeature`, `UiSettingsEditorFeature`, `UiHelpFeature`,
`UiResizeFeature`, `UiPanelLayout`). `provideTrFile()` (`app.providers.ts`: the settings store) is
the app's; `provideTrFileWorkbench()` (`provideFileUi`, `provideUiWorkbench`) is the lazy workbench
route's, and both are every spec's (`test-setup.ts`).

**Sub-applications (PRD 001, §1.1).** The file manager is one of the window's sub-applications,
beside *Search* (still a placeholder) and *Disk Usage* (PRD 013). They share the title bar with its
menus, the activity bar and the status bar — `<ui-workbench-shell>`, in the `Workbench` component
(`workbench.html`) — and the one shown fills the rest. `SubAppsFeature` keeps which (`active`,
`show`, `fileManager`; the config's `subApps`). The file manager is the main one: its sidebars are
`FileManagerExplorer` and `FileManagerDetails` (`workbench/sub-apps/`, given to the shell as
`uiSidebar` templates), its centre is the shell's panels and bottom panel, with tr-file's
`uiPanelContent` and `uiBottomTab` templates; the others are one centre component each
(`SearchApp`, `DiskUsageApp`, `uiSubApp` templates). A sub-application is drawn the first time it is shown and is kept, hidden
(`is-inactive`), while another one is shown, so the file manager comes back with its panels as they
were. The sidebars are the file manager's, so another sub-application hides them. The activity
bar's first group is the sub-applications (*File Manager* also brings back its Explorer, as the
Explorer button did; its name search is still `Ctrl`+`Shift`+`F`). Below a rule
(`UiActivityItem.separatorBefore`) come the file manager's Transfers and Bookmarks. The palette
has *View: Show …* (`view.app.<id>`). While another one is shown there is no panel to act on:
`CommandsFeature.activeTarget` has no paths and no folder, so the file commands are greyed out and
their keys do nothing, and the `Ctrl`+`Tab` ring is empty. Showing a folder (`navigateTo`), the
name search, Notes or a tab of the bottom panel chosen from the activity or status bar brings the
file manager forward, and the keyboard goes back to its active panel.
A new sub-application is an entry in the config's `subApps`, its component under `sub-apps/` and a
`uiSubApp` template in `workbench.html`.

A panel is a frame plus content. `UiPanelGroup` renders the tab bar, loading rail and body
frame (drops, focus, the `Ctrl` chords); what the active tab shows is a separate component
the app projects into it — file management is `UiFileBrowser`, with its own model and toolbar
(`UiPanelToolbar`), marking its body `uiPanelBody` so the frame knows where focus goes.
`EditorGroupsFeature` keeps groups and tabs only; the config's `editor.contents` maps each tab kind
to a content type, whose feature (`FileBrowserFeature` for `'files'`) implements
`PanelContentFeature` (the library's `UiPanelContentDriver`), is registered for it by
`WorkbenchService` (`registerContent`) and renders its model.
`UiFileBrowser` has three views — list, grid, and tree (PRD 002 §4.1): the list's
`UiFileList` with `tree` set, whose folders open in place with the same detail columns.
Which folders are open is `FileBrowserFeature`'s state, per panel; opening one is what
fetches it.
A new kind of content is a new tab kind in `editor.contents`, a component, a feature class
registered as its driver, and a `uiPanelContent` template in `workbench.html` — see
`prj/libs/ui/README.md` § Panel content.

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
`F1`–`F10` are window bindings of `KeybindingsFeature` (help, rename, view, edit/open, copy and
move — to the other panel's folder —, mkdir, delete for good (PRD 004, §2.1; the trash is `Delete`), main menu, and quit on the desktop), each a
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
(`EditorGroupsFeature.otherGroupOf`); splitting one off only when there is none — and take the keyboard there (`FileBrowserFeature.openEntryAside`);
closing a tab opened so chooses the tab it was opened from again, wherever it is, and gives its panel the
keyboard (§2.5.1; `PanelTabState.openedFrom`, session only, read by `EditorGroupsFeature.closeTab`;
a file opened from a listing in its own panel notes it too); the key is
`UiFileBrowser`'s, on its host, and the double click the views' `activateAside`; `Ctrl`+`Tab` / `Ctrl`+`Shift`+`Tab` (PRD 002 §2.6) walk the ring explorer → each
panel in layout order → bottom panel (while open) → details, and round: `UiFocusCycleFeature`
decides the ring, `<ui-workbench-shell>` finds the `data-focus-region` that has focus and
focuses into the next (a panel through `UiPanelFocusFeature`, a sidebar where focus last was in it,
else its first tab stop that takes focus).
Plain `Tab` / `Shift`+`Tab` in a panel's *body* (`data-panel-body`, set by `UiPanelBody`; never
in a text field or the chrome above it) walk the panels only, in layout order and round
(`UiFocusCycleFeature.panelDirectionOf` / `nextPanel`) — Midnight Commander's `Tab`; with one
panel (or one maximized) `Tab` keeps its usual meaning.
A browser keeps those chords for its own tabs, so they reach the page on the desktop only; the desktop shell installs its own accelerator
table so Electron's default `Ctrl`+`W` cannot close the window instead (`prj/desktop/src/app-menu.ts`). `Alt`+`↑` goes up a directory, and `Alt`+`←`/`→` walks
`PanelHistoryFeature`, which keeps a browser-style trail of visited folders *per panel*,
since two panels are two places someone is working. Each stop keeps what was selected there and the
cursor (PRD 002, §2.1): `FileBrowserFeature.navigateTo` calls `leave` just before the folder's
selection is cleared, and Back / Forward put both back (`setSelection`, so the details follow); an empty
folder restores nothing and its body keeps the keyboard. Any key that changes the folder also
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
selected, the first row or tile takes the cursor but is *not* selected (PRD 002, §3.1; PRD 004,
§1.3.3), and `FileBrowserFeature.setSelection` describes the *folder* in the details sidebar for a
cursor with nothing selected; a click and the view's own key moves keep their own rules; `UiPanelFocusFeature` owns
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
loaded before the tab moves to it, and a press meanwhile counts on from the one loading. The listing
it was opened from (§1.1.1; its tab is the viewer's `openedFrom`) follows: its cursor and selection move
to each picture — in its remembered state when that tab is in the background — while it still lists it,
without becoming the active panel, and `UiFileList` / `UiIconView` scroll a cursor moved while focus is
elsewhere into view (`FilePreviewFeature.reflect`).
In the viewer itself (§1.2) `+` / `-` zoom, `1` is 100 % and `0` the default fit — keymap commands
in their own context, `when: 'image'`, so a digit is never taken from type-to-find in a listing —
and the arrows pan an image larger than the view (`UiImageViewService.panBy`; navigation, so fixed).
Selecting an image also shows it on the details card, fitted `contain` and non-interactive
(§9); the panel and the sidebar read from the same cache, so a file is fetched once.

Modal windows (PRD 002, §3) are the library's `UiModalService`: `await
modal.confirm(…)`, `prompt(…)`, `message(…)`, `show(…)` for a full VS Code message dialog,
or `open(Component, …)` for a component of the app's own, which closes itself through
`UI_MODAL_REF`. `UiModalHost` at the root draws the stack with `UiModal` and
`UiDialog`, and `App` makes everything behind it `inert` while one is open. A dialog shown with
`onTop: true` stays above every window opened after it — they go in beneath it, inert until it is
answered (PRD 004, §2.2); a file operation's *Skip* / *Skip All* / *Retry* / *Abort* question is one,
so its own progress window, opened at the same poll, can never cover it. The first user
is an upload whose name is taken: `TransfersFeature` asks Replace / Skip, one conflict at a
time, with "Do this for all remaining conflicts" for a batch.

The Settings gear in the activity bar opens a menu (PRD 007, §1): the item is `hasMenu`, the
bar reports `menuOpen` with the gear's rect, and `ChromeFeature` (`settingsMenu`,
`openMenu`, `closeSettingsMenu`) shows `UiContextMenu` fixed beside it, opening upward. Its
items are commands of the table, laid out in `MockDataWorkbenchService.settingsMenuItems`:
hidden files, restore the layout on start, reset it, clear recent folders (PRD 003, §6).
On the desktop the title bar's buttons start with the window's zoom (PRD 001, §8.2.3): `UiTitleBar`'s
`zoom` input draws a button (its level beside it when not 100 %) dropping down `UiZoomMenu` — zoom out /
in, 100 %, and a slider applied when let go of, since zooming rescales the slider too — and reports a
`UiZoomRequest`; `WindowControlsFeature.zoom` / `zoomTo` send it to the main process over the window
channel (`zoomIn`, `zoomOut`, `resetZoom`, `setZoom`), which steps through browser-like levels
(`desktop/src/window-zoom.ts`), applies `webContents.setZoomFactor`, pushes the level back in the
window state and keeps it in `window-state.json`. `Ctrl`+`=` / `-` / `0` are the main process's
menu accelerators (`app-menu.ts`, through the same `applyZoom`), not keymap keys; *View › Zoom In /
Out / Reset Zoom* run the same. In a browser there is no zoom control — the browser's own zoom is.
The title bar's buttons (`ChromeFeature.titleBarActions`, `runTitleBarAction`) are commands of the
table: first of them, leftmost but for the zoom, the light/dark toggle (PRD 001, §8.2.2; `view.toggleTheme`,
`PreferencesFeature.toggleTheme`) — a sun in the dark, a moon in the light, choosing the other of the
theme in force outright, so a window following the system stops following it —, then *Toggle Explorer* / *Toggle Details* (`view.toggleExplorer` / `view.toggleDetails`, `Ctrl`+`E` /
`Ctrl`+`D` — PRD 001, §9.2.1; `Ctrl`+`/` is both, `view.toggleSidebars`, `ChromeFeature.toggleSidebars`: either shown, both are hidden, else both shown —, drawn on the
side each sidebar is on, pressed while shown — `ChromeFeature.isShown`, the session's
`hiddenSidebars`; hidden, a sidebar leaves the `Ctrl`+`Tab` ring, gives the keyboard back to the
active panel, and comes back for anything shown in it), *Toggle Panel* (§12.3), and last, the
layout grid (PRD 001, §15.1.1), *Reset Layout*; `view.resetLayout` asks first wherever it is run from
(`SessionFeature.confirmResetLayout`), since the window then reloads fresh.

The main menu (PRD 008, §1) is File, Edit, Selection, View, Go and Help (PRD 001, §16), from
`MockDataWorkbenchService.menuItems`; `UiTitleBar` draws the menus, `ChromeFeature` holds
which is open (`setMenuOpen`) and runs entries (`runMenuItem`, through `CommandsFeature`).
Go ends with *Local Computer* — checked while `WorkbenchService.backend` is `local`, the default and, until
PRD 006, the only one — and *Remote Computer…*, which opens the command palette at *Connect
to Remote Server* (`CommandPaletteFeature.run`).

The command palette (PRD 009, §1) is `CommandPaletteFeature`: `Ctrl`+`Shift`+`P`,
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
the settings window: the library's `UiSettingsEditorFeature` opens `UiSettingsModal` —
`UiSettingsEditor` in a `size: 'large'` modal — with *General*, *Appearance* and *Keyboard
Shortcuts* pages and a search box. The settings are `PREFERENCES` (`workbench.config.ts`, the
library's own built by `uiColorThemePreference` and the like), their values `PreferencesFeature`'s: hidden
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
library's root `UiThemeService` sets — from the stored preference (the settings store, under
`UI_STORAGE_PREFIX`) as the app
starts (before the sign-in screen), on each change, and with the OS while following it. Two things
paint before Angular does, and both read the same preference: an inline script in `index.html` (a
browser's `localStorage`) and, on the desktop, the window's `backgroundColor`
(`desktop/src/window-background.ts`, from the main process's settings file).

**Help (PRD 001, §16).** `F1` (`help.show`, Midnight Commander's key for it; also the Help menu) opens
the Help window: the library's `UiHelpFeature` opens `UiHelpModal` — `UiHelp` (tabs, a search box, close)
in a `size: 'large'` modal — whose one tab so far is the *Cheatsheet* (§16.1, `help.cheatsheet`):
`UiCheatsheet` cards, one colour each (`--vsc-hue-*`), keys as keycaps. The configurable cards are built
from `KeybindingsFeature.bindings()` as it is now, grouped by `HELP.subjects` (`workbench.config.ts`; a
bound command none names goes under *Other*; the function keys have their own card, `keyCard`, and are
not repeated), then the fixed keys (`HELP.fixed`) — keep both in step with `SHORTCUTS.md`. A new page of
help is a tab in the config's `help.tabs` and a `@case` in `UiHelpModal`.

**Every key is configurable (PRD 010, §2).** The library's components never test a key for a
command themselves: they ask `UiKeymap` (`prj/libs/ui/src/lib/keyboard/keymap.ts`; the workbench
route's own, which `provideUiWorkbench` brings) which of their commands it is bound to, in their
context — `list`, `panel` or `window` (VS Code's `when`). `KeybindingsFeature` (the library's
`UiKeybindingsFeature`) owns the table: the components' defaults — `FILE_UI_DEFAULT_KEYBINDINGS`
(`provideFileUi`) then `UI_DEFAULT_KEYBINDINGS` — plus `WORKBENCH_DEFAULT_KEYBINDINGS`, less what the
user removed, plus what they added (`tr-file.keybindings.v1`), handed to `UiKeymap` on every change
(`default-keybindings.golden.spec.ts` freezes the order). It runs the `window` keys itself
(`handleShortcut`, from `<ui-workbench-shell>`: the palette, search, the function keys, `Ctrl`+`H`,
`Ctrl`+`,` — each a command of `CommandsFeature` on the active panel; `F2`–`F4` act on the cursor's
entry), and it is where menus, the palette and the function-key strip read the key they show
(`label`, `keysFor`, `windowCommandOf`) — so the table has no key labels of its own. `Ctrl`+`Tab` and
`Tab` between panels are keymap commands too (`workbench.focusNextPart`, `workbench.nextPanel`),
answered by `UiFocusCycleFeature` because they move DOM focus. Navigation keys (arrows, `Home`/`End`,
page keys, type-to-find, `Escape`, keys inside menus and dialogs) are not commands and stay fixed.
A new key for the app: a binding in one of the default tables, and the component asks the keymap
for its command id.
Every default key is listed in `SHORTCUTS.md` beside this file — keep it in step with the tables.

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
`SidebarPanesFeature` keeps each sidebar's order (`order`, `move`), the file manager's sidebar components draw the panes
in it with `@for`/`@switch`, and the session remembers it (`paneOrder`, only where it is not the
default). In Details the entry's card heads the first pane that is not Git (`detailsCardBefore`).
Their heights too (§5.2): every boundary with an expanded pane above it and one at or below it has
a `UiSash` (on the top edge of the pane under it, collapsed or not — `UiSidebar`'s stylesheet decides
which); dragging it trades height between those two, collapsed headers riding along, and the
pane reports every expanded pane's measured height (`UiPaneResize`). `SidebarPanesFeature` keeps
them by id (`sizeOf`, `resize`, the session's `paneSizes`) and hands them back as `size`, which the
pane uses as a `flex` weight — so the panes keep their proportions as the window changes height.
A pane opened among sized ones takes the average of theirs.
Each sidebar's `…` (PRD 001, §9.2) opens a menu of its panes, checked while shown: `UiSidebar`
reports `actionAt` with the button's place, `ContextMenuFeature.openSidebarMenu` lists the
`view.pane.<id>` commands (not in the palette), and `SidebarPanesFeature` keeps what is hidden
(`shown`, `toggleShown`, the session's `hiddenPanes`) — never the last pane a sidebar shows.
*Permissions* starts hidden (`hidden` in `DETAILS`, `workbench.config.ts`), and so does it for a session saved before panes
could be hidden. The
templates draw `panes.shown(…)`; with every pane about the entry hidden the Details card goes last.

The bottom panel starts collapsed (§12.1): it keeps its tab bar, whose counts say when
something happened, and the button VS Code would close it with is the collapse toggle — a
double chevron pointing the way the panel will move. Choosing a tab, including from the
activity bar, opens it again; `BottomPanelFeature` owns all of that and `UiBottomPanel` only
takes a `collapsed` input.
Its last tab, and the one every start opens on, is *Notes* (§12.2, *View: Show Notes*, `view.notes`;
the session keeps only whether the panel was collapsed, not its tab): one plain text in the library's
`UiNotes`, kept by `NotesFeature` under `tr-file.notes.v1` — global, not per backend, so on the
desktop it is the `userData` settings file whichever server the window is on — written 500 ms after
typing stops, on leaving the box and on `pagehide`; past 250 KB it says so rather than letting the
settings file refuse it silently.
`Ctrl`+`Shift`+`` ` `` (§12.3, `view.togglePanel`, *View: Toggle Panel*, also the title bar's
*Toggle bottom panel* button) collapses and opens it; `chordOf` reads the key left of `1` by
`event.code` in a `Ctrl`/`Alt` chord, so it is `` ` `` on every layout, `Shift` kept. A toggle (that key, the
chevron, the title bar's button) moves the keyboard too: opening, `UiBottomPanel.bodyFocus` focuses the
tab content's first focusable element (else the body); closing, `PanelFocusFeature.focusBody` on the
active panel. A tab chosen for the user — a job opening Progress — takes no focus.

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
selected; it goes where the backend's details say, so `s:\tronog` typed opens as `S:/Tronog` —
PRD 004, §4.1: `FilePathResolver.resolveReal` answers a path differing from the real one in case
alone with the real one, and on a drive mapped to a share takes the share's spelling,
`caseFromShare`) — and suggests as it is typed in (§4.2): `UiBreadcrumbs` reports `pathInput`
and draws `suggestions`, the first chosen already so `Enter` opens it (a combobox: `↓`/`↑`, `Enter`,
`Tab` completes, `Escape`; a folder typed with a `/` suggests itself first, and a name typed whole
ranks first), and
`FileBrowserFeature.locationInput` reads the folder typed in and ranks its entries
(`listing/location-suggest.ts`: folders first, prefix before substring, case ignored, `*`/`?`) — and
keeps the keyboard while a large folder streams in (§4.2.1): a focus request `UiPanelGroup` holds
for a loading body, and a row a key moved to in `UiFileList` / `UiIconView`, are dropped once focus
has gone elsewhere, never taken back on a later render; the toolbar has Back and Forward. What the app cannot preview (PDF,
Office, archives, too large) opens with `SystemOpenFeature` — the default app on
the desktop (the main process asks before running a program), a new browser tab
served `inline` otherwise; *Reveal* exists only on the desktop, for local files. *Copy Path* (`Ctrl`+`Shift`+`C` in a panel — the `copy-path` panel key) copies
the *full* path (PRD 004, §1.3.2) — `SystemOpenFeature.copyPaths` → `FsTransport.copyPaths`: on the
desktop the main process writes the real host paths (`clipboard-write-paths` — the window's own
clipboard permission is denied; a remote server is asked with `host-paths`), in a browser the page
asks `/api/fs/host-paths` and writes with the Clipboard API, or `execCommand('copy')` where the page
is not a secure context; a failure is said, never swallowed. Pressed twice within a second on the
same entries (`PanelKeyboardFeature.copyPath`) it copies them the UNIX way instead — `C:\Users` as
`/C/Users`, every `\` a `/` (`unixPath`; `copyPaths(paths, 'unix')`, bridge `unix: true`).
Every path shown in the details sidebar — *Location*, *Links to*, the trash's *Original location*,
the Actions pane's *Source* / *Destination* — copies itself when pressed (PRD 001, §9.3.1), the UNIX
way with `Shift`: `SystemOpenFeature.copyable` makes the `UiProperty` a `copy` button (`UiPropertyList`
reports `{ id, shift }`), `copyPathValue` copies an entry of the root as *Copy Path* does and a path
naming none (a link's target, the system trash's) as text — `FsTransport.copyText`, bridge
`clipboard-write-text` — and the value says `Copied` for a moment (`badge`).
A folder's *Size* and *On disk* there are pressable too (PRD 001, §9.3.2): they open the Disk Usage
sub-application on it (`DiskUsageFeature.open`).

**Disk Usage (PRD 013).** A workbench of panels of its own: `DiskUsageFeature` keeps its groups and
tabs and a `UiPanelLayout` of its own (the class takes its starting grid), drawn by
`DiskUsageApp` with the library's `UiPanelGrid` / `UiPanelGroup` (split, new tab, close, maximize).
Each tab shows a folder in the library's `UiDiskUsage`: a pie (sunburst), a table with share bars,
or rectangles (treemap), to a depth of 1–8. Its path bar works as a file browser's: crumbs,
`FileBrowserFeature.locationSuggestionsFor` / `locationInput` under the key `disk-usage:<tab>`, and
`resolveLocation`, which `goToLocation` now shares. The space is worked out on the backend (§1, the
`disk-usage` module, `/api/disk-usage`, bridge `du-*`, mapped by `RemoteBackend`; `FsDiskUsageFeature`
on the frontend): a scan per folder, polled every `DISK_USAGE_POLL_MS` (3 s) while it runs, asked only
for the folder and depth the tab shows. Going into a folder of a scan, or back up, asks the same
scan. A folder outside every scan of the window, one the scan did not go into (`mount`,
`too-deep`), *Scan again*, or a scan the backend forgot starts a new one. A scan no tab shows any
more is stopped. One running is aborted from its tab (§2.1.1) by the toolbar's *Stop scanning*, or
`Escape` in the panel (`view.stopLoading`, as for a large folder), and what it found stays,
its unfinished folders marked *not all scanned*. Shown with nothing open, it starts on the file manager's active folder. Its
panels are not in the `Ctrl`+`Tab` ring, and its tabs are not kept in the session.
The activity bar's Search (`Ctrl`+`Shift`+`F`) is `SearchFeature`, a name search
under the workspace or the active folder (`/api/fs/search`). `AutoRefreshFeature`
polls `/api/fs/watch` every 2 s with the folders on screen and re-reads what
changed — which the backend's `WatchService` judges by what a listing shows: an entry coming, going
or renamed, or (in a folder under `WATCH_SNAPSHOT_MAX` entries, snapshotted as the watcher starts)
a child's type, size or modified time (a large folder is not asked about at all — PRD 004,
§3.1.1). Windows reports access-time updates as changes too, and a
Samba share whose files are dated ahead of its server's clock updates them on every read, so a
folder reading itself would otherwise be re-read for ever; folders leaving the screen are `expire`d in `FsDataFeature`, read again
when next shown.

**A whole computer's files (PRD 003, §6).** On the desktop the root is `/` — on Windows every
drive, `FilePathResolver.drives()`, paths like `C:/Users`, shown so and never `/C:/Users` (PRD 004,
§1.4: `shownPath` in `file-system/fs-path.ts`, `FilePathResolver.shown` in the backend) — and a fresh window starts in the
home folder `/api/fs/places` names. `PlacesFeature` fills the explorer's Places pane (root,
home, user folders, drives, mounts — a server names its root only, so in a browser the pane
starts closed and asks when opened), Bookmarks and Recent; the activity bar's Bookmarks opens
that pane. Bookmarks are in the user's order (PRD 002, §6.1): the pane's `UiTree` is `reorderable` — a
row drags onto another (upper half before, lower half after) or moves a slot with `Ctrl`+`↑`/`↓`,
reported as a `UiTreeMove` that `PlacesFeature.reorderBookmark` applies — and the first nine are
`Ctrl`+`1` … `Ctrl`+`9` from anywhere (window keys `places.openBookmark<n>`, `openBookmark`, in the
active panel), each row showing its key. Bookmarks, recent folders and the session (`SessionFeature`: groups, tabs, views,
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

**Large folders (PRD 004, §3.1).** A folder of 1000 entries or more is never read in one go. The
backend counts to 1000 as it reads names (`FilesService.listDirectory`); past that it answers at once
with `progressive: { token, names }` — the first 1000 names, shown straight away — and hands the
folder to a worker thread (which goes on after those names) (`LargeListings`,
`large-listing.worker.ts` — a source string started with `eval: true`, so tsx, the ES build and the
desktop's single CommonJS bundle all run it): the names with the directory's own types, handed
over in chunks of 10 000 as they are read (no count first — how many is known with the last), then
`lstat` in batches; links' targets are judged against the root on the host. `GET
/api/fs/list-progress` (bridge `list-progress`, mapped by `RemoteBackend`) serves it by cursor. The
frontend follows it in `FsDataFeature.readLarge`: the first names on screen at once, the list growing
once a second as names come (`· reading…`; a refresh keeps its old listing up until they are all in),
every entry `partial` (name and type; blank size and date), then details filled in — asking
once a second (at once while chunks are full) and putting the screen right at most once a second. A
large listing is ordered in a Web Worker (`ListingOrderFeature`, `listing-order.worker.ts`, the same
`compareKeys` as `sortEntries`), asked by an `effect` for what is on screen (`ordersWanted`); until
there is an order the panel says it is sorting rather than showing the disk's order, and a new sort
keeps the last order up meanwhile. Each update is made from the last — names added after it, some entries described
(`listing/array-delta.ts`, one step kept, `descendsFrom` by line and generation so no old listing is
held alive: the hidden filter, the order laid over — an order of an earlier listing is laid over the
start of a later one, the newest names after it — and the rows); the path index is kept by
`readLarge` as names come; the worker is asked one question at a time per order, rows
are built for the showing view only, their cells formatted when first read, and selection, focus
and cut are laid over a copy of the base rows — so a keypress in a folder of half a million costs a
copy of an array. Keep new per-entry work off those paths. A large folder is never polled
(§3.1.1): `FsListingState.large` (set from the first answer, kept through reloads) leaves it out of
`AutoRefreshFeature`'s folders and out of its expiring, so it is read again only by Refresh — the
summary says `· refresh by hand`. A large folder left before it is all in — its tab gone to another
folder or closed, and no other panel, tree or image still showing it — stops being read (§3.1.2):
an `effect` in `FileBrowserFeature` sees it leave the screen and calls `FsDataFeature.abortLarge`,
which ends the polling, cancels the backend's worker (`DELETE /api/fs/list-progress`, bridge
`list-cancel`) and puts back the last whole listing, or forgets the folder so it is read afresh.
`Escape` in the panel stops it where it is (§3.1.4; keymap `view.stopLoading`, claimed by
`UiFileBrowser` only while the model is `stoppable`): `abortLarge(path, true)` keeps what came as
the listing, `stopped` (`· stopped, refresh to read it all`); a refresh stopped goes back to the
whole listing it had.
A large folder's *entry count* (its details: selecting it in its parent) stops at 1000 and says so
(`entryCountMore`, shown `1000+ items`, §3.1.3); pressing that value (a `UiProperty` with an `action`)
counts it through (`?recount=1`, bridge `recount`), once — the backend keeps the number
(`FilesService.countEntries`, concurrent asks joined) and gives it from then on. A manual refresh
(*Refresh details*, a panel's Refresh of the folder the selection is in) counts again only a folder
counted through before (`DetailsFeature.recounts`); auto-refresh never does.

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
`GlobalShortcutsPortal` and `GlobalShortcutsPortalPreferredTrigger` features (both, or Electron 44
refuses every key) let a Wayland session grant it — but only to an app id with an
installed desktop file, so on Linux the main process writes `~/.local/share/applications/tr-file.desktop`
for the copy that is running, with its icon in the user's hicolor theme (`desktop/src/desktop-entry.ts`; the AppImage, or `electron .` in
development). Electron 44 cannot propose a punctuation key to the portal (electron#52223), so GNOME
binds the shortcut with no key: `Ctrl`+`` ` `` is assigned once in Settings › Apps › tr-file › Global
Shortcuts. A chord already taken is logged, not fatal.

Section 8.6: the desktop updates itself from a folder on the share (`S:\Library\Software\Applications\Tronog\TR-File`,
`/S/Library/Software/Applications/Tronog/TR-File`; `TR_FILE_UPDATE_DIR`, `off`). `SelfUpdate`
(`desktop/src/self-update.ts`) judges a file new by size and modified time (never its name, which may stay the same) against the key
recorded in `update-state.json`; `UpdateMonitor` looks at start and every 15 minutes; `UpdateChannel` and
the preload's `trFileUpdate` reach `AppUpdateFeature`, whose blue *Upgrade* sits right of the command palette box
(`UiTitleBar.upgrade`). Upgrading renames an AppImage over the running one (same path); on Windows the
new file is first copied into the local temp folder (a program on the share will not run) and run from
there — the portable `.exe` as the app from then on, the setup silently over the installation — and the
new version is started directly (`startDetached`, with `--tr-file-upgraded`, so it waits for the old one's single-instance lock) before this one quits; the portable launcher has no `unpackDirName`, so old and new never share an unpack folder. Every step goes to `update.log` in the user-data folder.
`pnpm --filter @tr-file/desktop publish:share` puts a release there.
*File › Check for Updates…* (§8.6.1, `file.checkForUpdates`, `Ctrl`+`U`, desktop only) looks now — the channel's
`check` — and always answers: up to date, a newer version to upgrade to (*Upgrade* / *Later*), the
folder unreadable, or a copy that does not update itself (`supported: false`).

Section 8.2 took the window's frame away: `UiTitleBar` is the title bar, with the drag
region and the window buttons in it. `WindowControlsChannel` plus the preload give the
page four verbs over its own window, `DesktopWindowService` is the frontend seam, and
`WindowControlsFeature` decides what the bar shows — nothing in a browser, no buttons
but a gap on macOS (the traffic lights stay), all three everywhere else.
The window comes back as it was left (§8.2.1): `MainWindow` keeps its restored size and place,
and whether it was maximised or full screen, in `window-state.json` in the user-data folder
(`WindowStateFile` — the main process's own, not the page's settings, which *Reset Layout* clears),
written a moment after each change and as it closes; `fitToScreens` drops a place no screen shows
any more and shrinks a size larger than the screen. On Wayland the compositor places windows, so
there only the size and the state come back.

# Docker
Refer to `docs/ai/DOCKER.md`. Two Compose environments live at the workspace root:
`prj/compose.dev.yaml` (ports exposed directly) and `prj/compose.prod.yaml` (behind nginx).
Both build with `context: .` relative to `prj/`.
