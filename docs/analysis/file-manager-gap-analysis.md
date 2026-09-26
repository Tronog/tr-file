# tr-file — gap analysis against a full file-manager replacement

*Analysis date: 2026-09-26. Based on reading the code on `master` (plus the uncommitted
bottom-panel work) and running the backend test suite (60/60 pass). The frontend and UI library
have ~440 specs, which were not run for this report. The app itself was not launched; every
claim below comes from the source and cites the place it was read.*

---

## 1. Verdict

tr-file today is a **well-engineered read-only browser with upload**. The architecture is in
very good shape to become a full file manager: one `FilesService` reached over two transports,
confined path resolution, feature classes with clear ownership, and a signal-based UI library.
But the product still lacks what *defines* a file manager: **changing what is already on disk**.

| Capability area | State |
| --- | --- |
| Browse / navigate / preview | ✅ Solid |
| Upload / download single files | ✅ Works (with gaps, §4.5) |
| Create, rename, delete, copy, move | ❌ Absent at every layer |
| Multi-selection, clipboard, drag between locations | ❌ Absent |
| Context menus, menu bar, command palette | ❌ Components exist, nothing wired |
| Search, sort, filter | ❌ Absent (sort is hard-coded) |
| Live updates from disk | ❌ Absent |
| OS integration (open with, trash, drives, home) | ❌ Absent |
| Persistence of layout / preferences | ❌ Absent |
| Security for multi-user / network deployment | ❌ No auth, CSRF-exposed (§6) |

The critical path is the **backend**: until it can mutate the file system, most of the missing
UI has nothing to call. Once the operations exist, **selecting more than one item** is the
second bottleneck, because every batch operation depends on it.

---

## 2. What exists (baseline)

So the gaps below read against something concrete:

- **Backend** (`prj/backend/src/modules/files`): `list`, `details`, `download` (streamed,
  range-capable), `upload` (atomic temp-file + rename, size-capped). `FilePathResolver` confines
  every path to `FILES_ROOT`, lexically and via `realpath`. Errors use a uniform envelope.
- **Bridge** (`modules/bridge`): the same four commands (`read` in place of `download`) over
  IPC for the desktop shell. Requests are validated as untrusted, and failures are returned
  rather than thrown.
- **Frontend data**: `FsTransport` with HTTP and bridge implementations, `FsDataFeature` as a
  path-keyed cache, and `ImageSourceService` as an object-URL cache.
- **Workbench**: split/maximize/drag panel groups with tabs; list, grid and tree views;
  breadcrumbs; per-panel history; a thorough keyboard model; a folders-only explorer tree;
  a details sidebar (properties, permissions, image preview, actions); a Transfers panel
  (uploads) and a Problems panel; the status bar.
- **Previews**: plain text and markdown (≤ 2 MiB), and an image viewer with zoom and pan
  (≤ 32 MiB).
- **Desktop**: Electron shell, frameless window with custom title bar, sandboxed preload,
  single instance, single-file AppImage and portable `.exe`.

---

## 3. Missing capabilities — by priority

Priorities:
- **P0**: without it, nobody can use tr-file *instead of* their file manager.
- **P1**: expected daily; its absence is felt within minutes.
- **P2**: power features, or what makes it better than the incumbent.

### P0-1 · Operations that change the file system — *absent at every layer*

**Evidence.** `FsTransport` (`frontend/src/app/file-system/fs-transport.ts`) declares only
`list`, `details`, `read`, `saveUrl` and `upload`. `FilesService` imports only `lstat`,
`readdir`, `readlink`, `rename` and `unlink`, and those are used solely by the upload path
(`files.service.ts:3`). The bridge dispatches four commands (`bridge.service.ts:60-66`). The
UI has no keys for these operations either: `UiPanelKey` commands are `open`, `open-aside`,
`select`, `up`, `refresh`, `back` and `forward` (`panel-keyboard.feature.ts`), so there is no
`F2`, `Delete`, `F7`, `Ctrl+Shift+N`, and so on.

**Needed.**

| Operation | Notes a real implementation must handle |
| --- | --- |
| Create folder / empty file | Name validation per platform (Windows reserved names `CON`, `NUL`…, trailing dots/spaces, `<>:"/\|?*`) |
| Rename | Case-only renames on case-insensitive file systems (`a.txt` → `A.txt` needs a two-step rename on Windows/macOS); inline edit in list, grid and tree |
| Delete | **Trash / Recycle Bin by default** on desktop, permanent delete as `Shift+Delete`; the server deployment needs its own policy (no OS trash) |
| Copy / move | Recursive; across devices (`EXDEV` → copy + delete); preserve mtime/mode; copying a folder into itself must be refused; symlinks copied as links |
| Conflicts | Overwrite / skip / keep both (auto-rename `name (1).ext`) / "apply to all" — one decision model shared with uploads |
| Progress / cancel | Long operations need a job model: bytes and items done, cancellable, errors per item, a summary |
| Undo | At least for rename, move and trash (see P2-6) |

**Architecture note.** This is a new backend module (e.g. `modules/operations`), not
extensions to `files.routes.ts`. Copy and move of large trees are **jobs**, not
request/response calls: they need an id, progress events and cancellation. That requires a
push channel (see P1-3), which should therefore be designed together with this. The bridge
must expose the same commands, and `FsTransport` grows accordingly. The Transfers panel
(`TransfersFeature`) should generalise into an **operations queue** rather than a second,
parallel UI being built.

### P0-2 · Selecting more than one item

**Evidence.** `FileBrowserFeature.selectEntry` always replaces the selection with a single
entry: `selection: [entryId]` (`file-browser.feature.ts:157`). `UiFileList` and `UiIconView`
return early when a modifier is held (`ui-file-list.ts:109`, `ui-icon-view.ts:86`), so
`Ctrl`-click and `Shift`-click do nothing. There is no `Ctrl+A`, invert selection, or
select-by-pattern, and no rubber-band (drag-rectangle) selection in the grid. The status bar
item `selection` (`chrome.feature.ts`) summarises one entry.

**Needed.** Anchor + focus + set semantics (`Shift` extends from the anchor, `Ctrl` toggles,
`Ctrl+Space` toggles the focused row), `Ctrl+A`, rubber-band selection in the grid, and a
"Selected: n items, total size" summary. The details sidebar needs a multi-selection state
(aggregate size, count, and shared actions).

### P0-3 · Clipboard and drag between locations

**Evidence.** Drag-and-drop in the workbench handles tabs (`tabMove`, `tabDrop`, `zoneDrop`)
and files dropped in from the OS (`fileDrop` → `uploadInto`)
(`frontend/src/app/workbench/workbench.html:103-106`). Entries cannot be dragged out of a
panel at all.

**Needed.**
- `Ctrl+C` / `Ctrl+X` / `Ctrl+V` with an app-level clipboard, with cut entries shown dimmed.
- On desktop, interop with the OS clipboard: paste files copied in the OS file manager, and
  copy paths.
- Drag entries between panels, onto a folder row, onto the explorer tree, or onto a
  breadcrumb. Dragging moves by default, `Ctrl`-drag copies, and dropping onto a different
  volume copies.
- On desktop, drag entries **out** to other apps (`webContents.startDrag`).
- A dual-pane "copy to the other panel" key (`F5`/`F6` in Commander-style managers). `F5` is
  currently Refresh, so the binding needs a decision.

### P0-4 · Context menus

**Evidence.** `UiContextMenu` exists (`libs/ui/src/lib/context-menu/`) and is exported, but
nothing in `frontend/src` uses it. It also lacks what a real context menu needs: keyboard
navigation, submenus, dismiss on outside click or `Esc`, and positioning that stays inside
the viewport. Its template is a flat list of buttons.

**Needed.** Right-click menus on rows (single and multiple selection), empty panel space
(New, Paste, View, Sort), the explorer tree, tabs (Close others, Close to the right, Copy
path) and breadcrumbs. The `Menu` key and `Shift+F10` must open it on the focused row, to fit
the keyboard-first design.

### P0-5 · Opening files with system apps (desktop)

**Evidence.** Double-click or `Enter` on a file always opens the built-in read-only preview
(`file-browser.feature.ts:167-185`). The only use of Electron's `shell` API is
`shell.openExternal` for links (`desktop/src/main-window.ts:184`).

**Needed.**
- **Open** (with the system default app, via `shell.openPath`) as the default action, with
  "Preview" as the alternative. Most file-manager users expect a double-click to launch the
  app.
- Open with…, Reveal in system file manager (`shell.showItemInFolder`), Open terminal here.
- Handle executables and scripts explicitly: ask before running them.

This needs a new IPC channel. It must *not* go through the backend bridge, because opening
apps is shell behaviour, not file-system behaviour.

### P0-6 · Browsing beyond one root folder (desktop)

**Evidence.** All access is confined to one `FILES_ROOT` (`file-path.resolver.ts`). The
desktop picks it once at start from the environment or a default
(`desktop/src/desktop.config.ts:124-129`). There is no way to type a path into the
breadcrumb bar.

**Needed.** On desktop: home, other drives and mounts (Windows drive letters, `/media`,
`/Volumes`), and arbitrary absolute paths. The server deployment should keep confinement,
possibly as a *list* of named roots.

Design implication: the path model (root-relative POSIX, no leading slash) must become
`{ root, path }` or a URI-like `root:path`. This touches every cache key in `FsDataFeature`,
`ImageSourceService`, history, tabs and breadcrumbs. **It should be decided before the
P0-1 operations are built**, because copy and move across roots are exactly where the model
shows through.

---

### P1-1 · Sorting

**Evidence.** The column definition is hard-coded `sort: 'asc'` on Name
(`file-browser.feature.ts:20`), and the status bar is a constant "Sorted by Name"
(`chrome.feature.ts:83`). Sorting happens on the backend with
`localeCompare(…, { sensitivity: 'base' })` and **no `numeric: true`**
(`directory-listing.model.ts:30`), so `file10` sorts before `file2`.

**Needed.** Clickable headers that sort by name, size, type or modified date, ascending or
descending, with folders first and natural (numeric-aware) ordering. Sorting belongs on the
client, because the listing is already in memory. The chosen sort should be remembered per
panel, or per folder (P1-6).

### P1-2 · Search and filter

**Evidence.** The Search activity item is decoration only. The activity bar has no
`(select)` binding in `workbench.html`.

**Needed.**
1. **Quick filter** for the current listing, on the client. Type-to-find already exists, but
   it moves focus rather than filtering.
2. **Recursive search** by name or glob, and optionally by content. The backend must *stream*
   results with a cap and cancellation, and respect confinement and hidden-file settings.
3. Results as a panel content kind: a new tab kind, following the documented
   `PANEL_CONTENT` pattern. Entries in it support the same operations as in a folder listing.

### P1-3 · Live refresh when files change on disk

**Evidence.** Neither the backend nor the desktop uses `fs.watch` or chokidar. Nothing is
pushed to the client, over HTTP (no SSE or WebSocket) or over the bridge. `FsDataFeature`
refetches only when an action starts it.

**Needed.** Watch folders that are *open or visible* (subscribe and unsubscribe as panels and
tree nodes open and close), debounce and coalesce the events, and push invalidations over
SSE (HTTP) or an IPC event channel (desktop). Operations performed by the app itself should
invalidate their own listings immediately, rather than waiting for the watcher. This push
channel is also what P0-1's progress reporting needs, so they should be built as one piece
of infrastructure.

### P1-4 · Menu bar, activity bar and command palette

**Evidence.** The menus (File, Edit, Selection, View, Go, Transfer, Help) are static data
(`mock-data-workbench.service.ts:43-49`). `UiTitleBar` has a `menuSelect` output
(`ui-title-bar.ts:65`), but `workbench.html` does not bind it, and it does not bind
`commandSelect` either. The dropdowns have no content. PRD 003 (command palette) is a heading
only.

**Needed.** A **command registry**: one table of command id → label, keybinding, `when`
condition and handler. The menu bar, context menus, command palette, keybindings and toolbar
all read from it. This is the missing piece that stops menus, the palette and the
keyboard-shortcut tables from being maintained three times. `PanelKeyboardFeature` is
already one small registry, and it should become part of this one.

### P1-5 · Bookmarks, Places and recent folders

**Evidence.** The "Places" pane renders empty (`workbench.html:49-53`), and the Bookmarks
activity item does nothing.

**Needed.** User bookmarks (drag a folder in, reorder, rename), system places (Home,
Desktop, Documents, Downloads, drives and mounts on desktop), and recent folders.

### P1-6 · Remembering state between sessions

**Evidence.** Nothing in the code uses `localStorage`, `sessionStorage`, IndexedDB or
Electron storage. Layout, open tabs and paths, view mode, sidebar widths, the hidden-files
setting and pane expansion all reset on every start. The initial layout comes from
`MockDataWorkbenchService`.

**Needed.** Restore the session (panel grid, tabs, paths, history optionally) and store
preferences. The desktop should keep them in the user-data directory, and the browser in
`localStorage`. Settings need versioning and migration from the start.

### P1-7 · Uploading and downloading folders

**Evidence.** Busboy reduces an upload's name to its basename (`prj/backend/README.md`), so
dropping a folder flattens or fails. Directories cannot be downloaded
(`resolveDownload` → 400, `files.service.ts:98-100`).

**Needed.** Folder upload with relative paths (`webkitdirectory` or DataTransfer entries),
creating directories on the server under confinement. Folder or selection download as a
streamed zip. On desktop, a "save to…" that copies natively instead of going through the
browser download.

### P1-8 · Where the hidden-files toggle is

**Evidence.** It is reachable only from a status-bar item (`chrome.feature.ts:89-90`).
"Hidden" means *dot-prefixed only* (`file-entry.model.ts:71-72`); the Windows `hidden` and
`system` attributes are ignored.

**Needed.** `Ctrl+H`, a View menu entry, and a toolbar toggle. On Windows, detect the hidden
attribute (it needs a native call or `attrib`; Node's `stat` does not expose it).

### P1-9 · Confirmation and conflict dialogs

**Evidence.** Uploads are always sent with `overwrite: false` (`transfers.feature.ts:109`).
A name clash therefore ends as an error row, with no way to replace the file or keep both.
The library has no modal dialog or inline-input component.

**Needed.** Library components for a dialog (confirm, conflict resolution, properties) and
an inline rename editor. Every operation in P0-1 depends on them.

---

### P2 — beyond the basics

| # | Feature | Notes |
| --- | --- | --- |
| P2-1 | **Editing properties** | Permissions and ownership are shown (`ui-permission-grid`) but cannot be changed: needs chmod, chown (server), touch, and a Windows read-only flag. |
| P2-2 | **Archives** | Browse zip/tar as folders (a new root kind, see P0-6), extract, and compress the selection. |
| P2-3 | **More previews** | Syntax highlighting, PDF, audio and video (HTTP range support already exists; the bridge does not, §4.4), fonts, hex view for binaries, and **thumbnails in grid view**. |
| P2-4 | **Folder size and disk space** | Compute a directory's size on demand, cancellable. Show free and total space for the current volume in the status bar. |
| P2-5 | **Batch rename, checksums, compare/sync folders** | Classic dual-pane tools; the split-panel design fits them naturally. |
| P2-6 | **Undo / redo** | A journal of reversible operations (rename, move, trash → restore). |
| P2-7 | **Settings UI and keybinding editor** | The Settings activity icon has no target. |
| P2-8 | **OS integration** | Register as a folder handler, open the path passed on the command line (the single-instance lock is already taken in `main.ts:43`, so forward `second-instance` argv), a "Open in tr-file" entry for the OS file manager, auto-update. |
| P2-9 | **Leftover mock panes** | Outline and Timeline (`workbench.html:78-79`), plus the `tags` and `git` pane ids in `sidebar-panes.feature.ts:5`, have no content. Decide what they are, or remove them. |
| P2-10 | **Tabs of other kinds** | Terminal, search results, and an operations/transfers view as a tab. `PANEL_CONTENT` already provides the extension point. |
| P2-11 | **Remote file systems** | SFTP, SMB, WebDAV and S3 as root providers, once the root abstraction (P0-6) exists. |

---

## 4. Defects and weaknesses found in the existing code

These are not missing features. They are behaviour that is wrong or will not scale, found
while tracing the paths above.

### 4.1 Symlinked folders open as file previews — *bug*

`openEntry` treats only `entry.type === 'directory'` as a folder
(`file-browser.feature.ts:172`). A symlink is reported as `type: 'symlink'` (from `lstat`), so
double-clicking a link to a directory calls `filePreviewFt.open`. The preview accepts
`'symlink'` (`file-preview.feature.ts:99`) and then tries to read a directory. The explorer
tree is folders-only, so symlinked folders presumably do not appear there either.

**Fix:** have the backend report the target's type (`stat` in addition to `lstat`), e.g.
`targetType: 'directory' | 'file' | null`, and navigate into links that point at folders.

### 4.2 The image cache never frees anything — *memory leak*

`ImageSourceService.release()` (`image-source.service.ts:94`) is never called anywhere in
the app. A URL is revoked only when the same path is fetched again. Every image previewed,
in the details card or a tab, keeps its blob (up to 32 MiB each) alive for the whole session.
Browsing a photo folder with the details sidebar open grows memory without bound.

**Fix:** reference-count per consumer (tab + details card), release on tab close and on
selection change, and add an LRU cap.

### 4.3 The listing cache is never evicted

`FsDataFeature` keeps every listing and every details result it has ever fetched. The
maps only grow. It is harmless for short sessions, but with live refresh (P1-3) every cached
folder would need a watcher. The cache needs an eviction policy tied to which folders are
visible.

### 4.4 The desktop bridge loads whole files into memory

- `read` uses `readFile` on the whole file (`bridge.service.ts:87`).
- Upload on the desktop does `new Uint8Array(await file.arrayBuffer())`
  (`fs-bridge.service.ts:136`).
- Downloads on the desktop build a blob of the whole file and hand it over as an object URL
  (`fs-bridge.service.ts:104-110`).

So a 500 MiB upload or download on the desktop costs ≥ 500 MiB in the renderer and again in
the main process, and a cancelled bridge upload cannot actually stop once it has been handed
over (`fs-bridge.service.ts:116-117`). Video preview is impossible without ranged reads.

**Fix:** chunked `read(path, offset, length)` and chunked writes over IPC, or a custom
`protocol.handle` scheme that streams from the main process with range support. Either
matters before large-file copy and move exist.

### 4.5 Downloads are invisible and their errors are swallowed

`TransfersFeature.download` fires and forgets. Failures only reach `console.error`, because
"the panel has no row shape for a download" (`transfers.feature.ts:72-78`). The Transfers
panel tracks uploads only.

### 4.6 Listing large folders is slow, and rendering them may be too

- `listDirectory` runs `await lstat` **one entry after another**
  (`files.service.ts:59-70`). A folder of 10,000 entries means 10,000 sequential syscalls
  before the first byte of the response. Bounded parallelism (e.g. 64 at a time) is a small
  change with a large effect, especially on network mounts.
- There is no pagination or streaming of listings, and no virtual scrolling in `UiFileList`
  or `UiIconView` (no virtual-scroll code anywhere in the library). Every row is a DOM node,
  so folders like `node_modules` or a camera roll will be sluggish.

### 4.7 Text preview decides by an extension denylist

A file is shown as text unless its extension is in `BINARY_EXTENSIONS`
(`file-preview.feature.ts:19-25`). `.docx`, `.xlsx`, `.psd`, `.iso`, `.sqlite`, `.pyc` and
every other unlisted binary format render as garbage text.

**Fix:** sniff the first few KB (NUL bytes, invalid UTF-8) and treat the extension only as a
hint. Markdown previews also cannot show images that use relative paths, because `./img.png`
is not resolved through the transport.

### 4.8 Case-sensitive root check (Windows / macOS) — *needs verification*

`assertInsideRoot` compares with a case-sensitive `startsWith` (`file-path.resolver.ts`). On
case-insensitive file systems, `realpath` can return a different case for the root than the
configured `FILES_ROOT`. Every request would then be a false `403`. This needs checking on
Windows, where the portable `.exe` ships, especially for drive-letter case (`c:\` vs `C:\`).

---

## 5. Cross-cutting design decisions to make first

The order matters more than the list. These decisions shape everything above.

1. **Path and root model (P0-6).** Either one confined root or many roots and absolute
   paths. Changing it later touches every cache key, tab, history entry and API signature.
2. **Jobs plus a push channel (P0-1, P1-3).** One mechanism, used for operation progress, file
   watching and transfer status, over SSE (HTTP) and IPC events (desktop).
3. **Command registry (P1-4, P0-4).** One table of commands with keybindings and `when`
   conditions, which the menus, context menus, palette and panel keys all read.
4. **Selection model (P0-2).** It lives in the library components (anchor, focus, set). The
   workbench only receives "selection changed" events.
5. **Dialogs and inline editing in the library (P1-9).** The operations need confirmations,
   conflict prompts and renames, and the library has none of these.
6. **Server vs desktop policy.** Trash, "open with", absolute paths and native clipboard are
   desktop-only. Authentication and multi-user are server-only. `FsTransport.kind` exists
   "for diagnostics, not for branching", so a *capabilities* object is needed to hide what a
   deployment cannot do.

---

## 6. Security — needed before any server deployment beyond localhost

The confinement work is careful: lexical checks, `realpath` checks, NUL rejection, and
basename-only uploads. But there is nothing around it, and adding operations that write,
move and delete (P0-1) makes that sharply worse.

- **No authentication or authorisation** in `app.ts` or `docker/nginx/default.conf`. Anyone
  who can reach the production port can read and upload everything under `/data`. Once
  delete and move exist, they could destroy it.
- **Cross-site request forgery.** Upload is a `POST multipart/form-data` with its parameters
  in the query string. Browsers treat that as a "simple" request, so they send it
  cross-origin without a preflight. Any web page a user of a LAN instance visits can upload
  files, or overwrite them via `overwrite=true`. Write endpoints need CSRF protection
  (a custom header requirement or tokens) plus `Origin` checks.
- **The desktop exposes the full HTTP API on loopback.** `DesktopStack` mounts the whole
  `App` on `127.0.0.1:<random>` (`desktop.stack.ts:159-165`), although since §8.1 the
  window's data goes over the bridge. Any local process — or a web page that finds the port,
  helped by the missing `Host` header check (DNS rebinding) — gets unauthenticated read and
  write access to `FILES_ROOT`. Either stop mounting `/api` on the desktop, or require a
  per-launch secret and check `Host`.
- **Missing audit trail** for destructive operations: needed for the server deployment and
  useful for undo (P2-6).

---

## 7. Suggested roadmap (as PRD sections)

| Step | Scope | Unblocks |
| --- | --- | --- |
| **1** | Decide the root/path model; ADR. Add the **capabilities** object to the transport. | Everything |
| **2** | Library: selecting more than one item, dialog, inline editor, context menu v2 (keyboard, submenus, positioning), virtual scrolling. | Every operation's UI |
| **3** | Backend `operations` module + bridge commands: mkdir, rename, trash/delete, copy, move, conflicts; a **job model** with a push channel for progress. | Core file management |
| **4** | Command registry; wire the menu bar, context menus, keybindings (`F2`, `Delete`, `Ctrl+C/X/V`, `Ctrl+A`, `Ctrl+H`), and the command palette (PRD 003). | Discoverability |
| **5** | Clipboard and drag between panels and the tree; the transfers panel becomes an operations queue. | Dual-pane workflow |
| **6** | Desktop: open with the default app, reveal, open terminal, home/drives/places, OS clipboard, drag out. Remove the loopback `/api` exposure. | Desktop replacement |
| **7** | Watching with invalidation push; sorting; quick filter; recursive search. | Daily use |
| **8** | Persist the session and preferences; bookmarks and recent folders; settings UI. | Daily use |
| **9** | Fix the §4 defects (symlinked folders, image cache, streaming bridge, parallel `lstat`, content sniffing). Several can be done at any time. | Robustness |
| **10** | Server deployment: authentication, CSRF protection, audit log. | Network use |
| **11** | P2 features: archives, previews and thumbnails, folder sizes, batch rename, compare, undo. | Parity+ |

Steps 1–3 are sequential. Steps 4–8 can largely run in parallel once 3 lands. The §4 fixes
for 4.1, 4.2 and 4.6 (parallel `lstat`) are small, independent of everything else, and worth
doing now.
