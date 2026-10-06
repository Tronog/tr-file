# @tr-file/file-ui

The file manager's components (PRD 001, §17.1), built on `@tr-file/ui`: the
file browser that is a panel's content — a path bar, a toolbar, and a listing
as a details table (`UiFileList`), large icons (`UiIconView`) or a tree, or a
file read-only — and disk usage (`UiDiskUsage`), the git pane
(`UiSourceControl`), the transfers list (`UiTransferList`) and the POSIX
permission grid (`UiPermissionGrid`).

They know what a folder, an entry and a path are — which is why they are not
in the generic library — but nothing about where files come from: like the
rest, they are presentational, with no service and no HTTP (the boundaries
are checked by `scripts/check-library-boundaries.mjs`). What a key or a drop
*does* is the application's: tr-file's `FileBrowserFeature`,
`PanelKeyboardFeature`, `OperationsFeature` and the rest.

## Using it

```ts
providers: [provideFileUi()],  // the listings' keys among the keymap's defaults
```

`provideFileUi()` gives `UiKeymap` the components' default keys
(`FILE_UI_DEFAULT_KEYBINDINGS` — a row's `Enter`, `Space`, `Delete`, `Insert`,
`*`, `+`, `-`, …, and a browser's `Alt`+`←`, `Ctrl`+`C`, `Ctrl`+`L`, …),
through `UI_KEYBINDING_DEFAULTS`. Give it where the workbench is provided
(`provideUiWorkbench`), which brings its own keymap: in tr-file, both are the
workbench route's. A key bound to a command id of the application's table
(`file.open`, `edit.copy`, `go.up`) governs both the key and what a menu shows
beside the command.

The models — `UiFileRow`, `UiIconViewItem`, `UiFileBrowserModel`,
`UiPanelView`, `UiTransfer`, `UiPanelKey` and `UiPanelCommand`,
`UI_ENTRY_MIME` and `UiEntryDrop`, `UiPermissions`, the source-control and
disk-usage models — are exported beside the components. What any panel content
shares — `UiPanelBody`, `UiPanelToolbar`, `UiBreadcrumbs`, `UiDocumentView`,
the list building blocks (`UiListSelection`, `UiTypeahead`,
`UiVirtualViewport`) — is `@tr-file/ui`'s.

Built like `@tr-file/ui` (ng-packagr, `pnpm build:libs` builds `ui` first and
this against it), consumed from its sources inside the workspace
(`paths`: `@tr-file/file-ui` → `../libs/file-ui/src/public-api.ts`), tested
on its own (`pnpm --filter @tr-file/file-ui test`; `src/testing/panel-host.ts`
puts a browser in a `UiPanelGroup` for the specs that need both).

## What every file manager has (PRD 003, §5)

The library reports these; what they do is the application's.

- **Sorting.** `UiFileList` with `sortable` draws its headers as buttons that
  report `sort` with the column's key; the column carrying `sort` shows the
  order. Once the re-sorted rows render, focus goes back to the cursor's
  row, not the header — or, when nothing is selected, to the first row, which
  becomes the selection (PRD 002, §3.1). `UiFileBrowserModel.sortable` turns it on for a browser, which
  re-emits `sortChange`.
- **Keys.** `Shift`+`Delete` is the `delete-permanently` panel key, and `+` /
  `-` are `select-pattern` / `unselect-pattern` (PRD 004, §2), in the list and
  the grid. `UiFileBrowser` adds `Ctrl`+`Z` (`undo`), `Ctrl`+`Shift`+`N`
  (`new-folder`), `Ctrl`+`R` (`refresh`) and `Ctrl`+`Shift`+`C` (`copy-path`,
  PRD 004, §1.3.2) — never inside a text field — and
  the mouse's back and forward buttons as `back` / `forward`. No function key
  is a panel key: `F1`–`F10` are the window's, and the app binds them.
- **Filter box.** Given `searchPlaceholder`, the toolbar shows
  `UiSearchField` holding `filterText`; typing is `filterChange`. `Ctrl`+`F`
  goes there, `Escape` empties it (and, empty, leaves it), `↓` / `Enter` go
  back to the listing. `UiSearchField.focusToken` asks for focus the way
  `focusBody` does.
- **Address bar.** Given `location` (`/docs/prd`), `UiBreadcrumbs` turns into
  a text field on a click on its blank space, its pencil button, or
  `Ctrl`+`L`; `Enter` is `pathSubmit`, `Escape` or leaving the field puts the
  crumbs back, and focus returns where it was.
- **Requests from a menu.** `filterFocus` and `locationEdit` on the model are
  tokens: bump one to focus the filter box or edit the path, as the keys do.
- **Context menus.** A right-click, `Shift`+`F10` or the menu key reports a
  `UiContextMenuRequest` (`target`, viewport `x`/`y`): `UiFileBrowser.contextMenu`
  (an entry — selected first if it was not — or `null` for blank space; a
  document keeps the browser's own menu), `UiTree.contextMenu` and
  `UiTabBar` / `UiPanelGroup.tabContextMenu`. `UiContextMenu`, when `fixed`
  and opening from its top-left corner, moves back inside the viewport.

## Git (PRD 011, §1)

`UiSourceControl` draws a `UiScmModel`: the branch button (`branchSelect`),
the sync button (`syncSelect`), a commit message box whose `Ctrl`+`Enter` is
the Commit button (`commit`), the changes by group — each row reports
`itemOpen`, its buttons `itemAction`, a group's header buttons `groupAction`
— and the latest commits (`moreCommits`). `UiDocumentView` takes a
`kind: 'diff'` document of `UiDiffLine`s, coloured by kind. `UiPane.actionAt`
reports a header button together with where it is, for a `…` menu.

## Disk usage (PRD 013, §2.1)

`UiDiskUsage` is panel content for what takes up the space in a folder. It has a file
browser's path bar (`UiBreadcrumbs`, with the same editing and suggestions) and a toolbar
(the app's buttons, a `UiSegmented` for the view, and the depth as − / +). It draws a
`UiDiskUsageItem` tree, already sized and labelled, three ways:
- **pie**: a sunburst, a ring per level, with a legend of the folder's own entries
- **table**: rows depth first, each with a bar for its share of the folder
- **rectangles**: a squarified treemap, folders under their names, laid out in pixels
  the component measures

The geometry is plain functions in `lib/disk-usage/disk-usage-layout.ts` (`sunburst`,
`treemap`, `squarify`, `tableRows`), and an entry keeps its top-level entry's hue
everywhere. Clicking an `openable` folder, or `Enter` on it in the table or legend, emits
`open`. The keymap's `go.up`, `view.refresh` and `view.stopLoading` emit the toolbar's
`up` / `refresh` / `stop`, while those buttons are there. `Ctrl`+`L` edits the path bar.

## Inside a listing

The two directory views answer to the keyboard a file manager trains people to
expect (PRD 001, Section 6.2). `UiFileList` moves with `↑`/`↓`, `Home`/`End`
and `PageUp`/`PageDown`; `UiIconView` adds `←`/`→` for one tile and uses the
vertical arrows for a whole *visual row*, whose width it measures off the
rendered tiles because `auto-fill` — not the component — decides how many fit.
Typing letters jumps to a name in both: a prefix while the keystrokes keep
coming, and a single letter pressed repeatedly cycles through the entries
sharing it.

`UiFileBrowser` adds the chords that are about the *folder* rather than what
is selected in it: `Alt`+`←`/`→` walks the folders the panel has visited
(PRD 001, §6.2.1) and `Alt`+`↑` leaves the current one for its parent (§6.2.3)
— the trail and the tree are different journeys, so they are different chords.
They are handled on its `uiPanelBody` rather than in either view, so they work
just as well over a document or an empty placeholder — neither of which has a
keyboard of its own — and both views let an `Alt` chord bubble untouched so it
arrives exactly once.

Some chords belong to the panel as a whole rather than to what is selected in
it: `/` splits it, `Ctrl`+`T` opens a new tab in it (PRD 002, §2.2), `Ctrl`+`W` closes its
focused tab (PRD 001, §6.2.2)
and `Ctrl`+`PageUp`/`PageDown` moves between its tabs, wrapping at either end
(§6.2.4). They are bound on the group's host, so they answer with focus
anywhere inside — its content, or a tab in the bar — and each
emits exactly what the equivalent pointer gesture emits: the split and close
buttons, or a click on the neighbouring tab. The pointer and the keyboard
cannot drift apart, and switching by keyboard lands focus in the new tab's
content just as clicking would. `/` is a plain character, which type-to-find
would otherwise take: the list and the icon view let a character bound in the
panel or window pass while no name is being typed (`isPanelCharacter`), and the
group ignores an unmodified chord typed into a text field.

`Ctrl`+`Enter` is the exception to that symmetry (§6.2.5): opening an entry in
the other panel (PRD 002, §2.5) has no tab-bar equivalent, so it leaves as a
`UiPanelKey` for the application to carry out — as does its pointer twin,
`Ctrl`+double click, which the views report as `activateAside`. It is `UiFileBrowser`'s, bound
on its host so it answers from a row, a tile, the document or the path bar,
and it supplies the entry from its own model — the cursor if there is one, the
selection otherwise — which is what lets one handler serve the listing and the
grid alike. With focus on a tab in the bar the key goes to the group, which has
no entries to open, so it does nothing there.

Both body views therefore let an `Alt` *or* `Ctrl` chord bubble untouched. The
list pages its rows on a bare `PageDown`, so without that it would page **and**
switch tabs on the same key.

An **empty folder** is the case that makes all of this hold together. Its
placeholder contains nothing focusable, so the `uiPanelBody` element carries
`tabindex="-1"` and takes focus itself when it has nothing else to offer (the
group's own body does the same when it has no content at all); without that the
keyboard would fall out of the panel and every one of its keys would reach
nothing — a keyboard user could walk into an empty folder and not get out. For
the same reason the browser answers `Backspace` when its body *itself* has focus,
and only then: whenever there is a row or a tile to stand on, the key belongs
to the view that owns it.

Two rules are worth stating outright. **Selection follows focus**: arrowing
onto an entry selects it, so the details sidebar tracks the keyboard the same
way it tracks the mouse. Focus handed to a list or grid from outside — the
panel giving its content the keyboard, `Tab` from another panel, a sort — while
nothing is selected moves to the first entry and selects it (PRD 002, §3.1); a
pointer press and the view's own moves (`Ctrl`+arrow, `Insert`) keep their own
rules.

Selection is **multiple** in all three views (PRD 004, §1.2). `UiListSelection`
(`@tr-file/ui`) is the one place the rules live — replace,
toggle, range from an anchor, range added, cursor only, all — and `UiFileList`
and `UiIconView` only decide which rule a gesture means. Every change leaves as
one `selectionChange: { selected, focused }`, the whole selection in list order
plus the entry the cursor is on; `select` still names that entry, and
`UiFileBrowser` forwards `selectionChange`. The icon view's box selection is
hit-tested against the grid's geometry, not the rendered tiles, so it reaches
tiles the virtual window has not drawn, and scrolls the panel when dragged
near its edge. And **the views move focus but decide nothing**:
`Enter`, `Space`, `Backspace`, `Delete`, `+` and `-` leave as a `UiPanelKey`
(`open` / `select` / `up` / `delete` / `select-pattern` / `unselect-pattern`) for the application to interpret — in
the app that is `PanelKeyboardFeature`, which is the whole answer to "what does
this key do in a panel". Focus movement stays in the component because a
roving tabindex can only be rolled where the elements are.

`UiTree` follows the ARIA tree keyboard pattern — `↑`/`↓`, `Home`/`End` move
between rows, `→` opens a directory (or steps into an open one) and `←` closes
it (or steps out to its parent). That is not decoration: the twisty is
`aria-hidden`, because a focusable button inside a `treeitem` is an AXE
violation, so these keys are the only way a keyboard user can expand anything.

`UiDocumentView` is the read-only preview a file tab opens (PRD 001, Section
7.3). It parses nothing: a `markdown` document arrives as finished, already
sanitised HTML — **the application renders the markdown, not this library**,
which keeps the parser (and its dependency) out of the component library — and
the view supplies only the typography and the `[innerHTML]` binding, which
Angular's default sanitiser scrubs on the way in. A `text` document is printed
verbatim in a monospace block, and an `image` document is handed to
`UiImageView`. Nothing in it is editable, and the only focusable element is the
scroll container — or, for an image, the viewport.

`UiImageView` is the picture half of that preview (PRD 001, §7.3.1). It is
deliberately thin: what the viewer *is* — the scale, the pan, every fit and the
arithmetic that holds a point still under the pointer — lives in
`UiImageViewService`, which the component provides one of. That is the only
service in a library of otherwise presentational components, and it earns its
place by being **component-scoped**: two images open in two panels zoom
independently, and nothing outside a viewer can reach another's state.

One model drives all five controls: the image is drawn at its natural size and
transformed, so `contain`, `cover` and `100%` are three ways of computing one
`scale`, the wheel and the `+`/`-` buttons set it directly, and panning is a
`translate`. Wheeling or dragging switches to a free zoom, which is why the fit
buttons stay meaningful rather than becoming a mode the viewer is stuck in; a
double click returns to `contain`. Two details are deliberate: a wheel zoom is
anchored under the pointer, so zooming into a corner works instead of
recentring, and the pan is clamped on the way *out*, so a hard drag can never
park the picture off-screen and an image smaller than the frame simply stays
centred. Like the rest of the viewer it fetches nothing — `src` is a URL the
application made, owns and revokes.

`interactive: false` is the difference between the viewer in a panel and the
thumbnail in the details sidebar (§9): it drops the controls, the gestures and
the tab stop, leaving the default `contain` fit. A thumbnail is a picture, not
something to operate. `UiPreviewCard` uses exactly that when the selected entry
has an `imageSrc`, so a selected image shows itself in place of its type icon.

Two inputs exist for the asynchronous world the workbench now lives in:
`UiTreeNode.busy` turns a row's twisty into a spinner while its contents are
being fetched, and `UiPanelGroupModel.loading` lights a 2px indeterminate rail
under the tab bar. Both are pure inputs — the library never knows what is being
loaded, only that something is.

## Copy, paste, drag and drop (PRD 005, §2)

`UiFileBrowser` adds file-manager clipboard chords and drag and drop to any
listing, and — as everywhere else — decides nothing about what they do:

- **`Ctrl`+`C` / `X` / `V`** (`Cmd` on macOS) leave as the `copy`, `cut` and
  `paste` `UiPanelKey`s, with the entry the cursor is on. Not in a text field,
  and not over a document, where the chords keep their meaning for text.
- **Dragging** a row or tile drags the selection it is part of — or that entry
  alone, which it then selects — as `UI_ENTRY_MIME` (`{ sources }`), so it
  passes between browsers and nothing else (the group's zones, the OS file
  drop) takes it. Several entries drag as a count.
- **Dropping**: a row or tile marked `dropTarget` (a folder) lights up under
  the drag; elsewhere the listing's blank space takes it for the listed folder
  when the model says `dropFolder`. A browser never offers its own dragged
  entries as their target, nor its own blank space for a plain move — which
  would put entries where they already are. The drop is an `entryDrop`
  (`UiEntryDrop`: `sources`, `target` or `null` for the listed folder, and
  `copy` when `Ctrl` or `Alt` was held — a move otherwise, as in VS Code).
- Rows and tiles marked **`cut`** are drawn faded, as file managers draw what
  waits to be moved.
- **Files from outside** (PRD 003, §6) — the system's file manager, or a
  native drag of this app's — are taken the same way, onto a folder row or the
  listing's blank space when `dropFolder`, and reported as `filesDrop`
  (`UiFilesDrop`: the `File`s, their `FileSystemEntry`s read during the drop
  so a folder can be walked, `target`, `copy`); the group around the browser
  does not hear of them. `UiPanelGroup` reports the same shape as `filesDrop`
  beside `fileDrop`.
- **`nativeDrag`** makes a drag the system's: the browser cancels the page's
  drag and emits `nativeDragStart` with the sources, for the application to
  hand to the operating system (the desktop's `webContents.startDrag`).
- **Thumbnails**: a tile with `thumbnail` (any `<img>` URL) draws it in the
  icon's place, the same height; `UiIconView.shown` — `itemsShown` on the
  browser — reports the tiles rendered whenever that set changes, so the
  application reads pictures only for what is on screen.

## Long lists

`UiFileList` (tree mode included) and `UiIconView` render only what is near the
viewport once they hold `VIRTUAL_THRESHOLD` (200) entries or more; below that
every entry is rendered, exactly as before. `UiVirtualViewport` follows the
nearest scrolling ancestor — the panel body scrolls, not the list — and
`visibleRange` turns its scroll position into a slice, counted in *lines*: a
table row, or one visual row of tiles whose column count is measured from the
layout. Spacers above and below keep the scrollbar the whole list's, and
`aria-rowcount` / `aria-setsize` tell assistive tech the real size.

Every key still reaches every entry: a move to one that is not rendered
scrolls it in and focuses it after the next render, and the roving tab stop is
always a rendered entry — the focused one when it is in view, else the first
that is.
