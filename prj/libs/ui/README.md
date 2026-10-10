# @tr-file/ui

A VS Code style workbench for Angular, as a library (PRD 001, §17.1): the
title bar with its menus, the activity bar, two sidebars of movable,
resizable, hideable panes, panels that split, group, move and maximize, a
bottom panel, a status bar, a command palette, context menus, configurable
keys, a settings window, a Help window with a cheatsheet, modal dialogs, dark
and light themes — and the session that remembers the layout.

It began as the port of the static mockup in `mockup/001/` (PRD 001,
Section 1). tr-file's file manager is built on it, and so is `prj/demo`, a
small notes app on this library alone. The file manager's own components —
the file browser, its listings, disk usage, the git pane — are the separate
`@tr-file/file-ui` (`libs/file-ui`).

## Principles

- **Nothing of an application's business.** No component or service here
  talks to a backend, and none knows what the application is about. What
  touches a backend — directly or through a feature or a service — is the
  application's (PRD 001, §17.1). `scripts/check-library-boundaries.mjs`
  keeps it so: no `@angular/common/http`, no `@tr-file/file-ui`, nothing of an
  app.
- **Components are presentational.** Every component takes signal inputs and
  emits outputs; none fetches anything or keeps business state. **Interactions
  are reported, not applied**: a sash emits the pixels it travelled, a tab bar
  where a tab was dropped, a group which edge received it. The only state a
  component keeps to itself is the transient kind a gesture needs (which tab is
  dragging, where the insertion bar sits), which dies with the gesture.
- **The workbench is a service and its features.** What a workbench *does* —
  the layout tree, the groups and their tabs, the focus ring, the command
  table, the keys, the session — lives in `UiWorkbenchService` and the feature
  classes it owns (`docs/ai/ANGULAR.md`: a thin service holding shared state,
  features holding the rest). `<ui-workbench-shell>` draws it. An application
  configures it with data and extends it by subclassing (below). A handful of
  root services stand beside it: `UiKeymap`, `UiModalService`,
  `UiThemeService`, `UiImageViewService` (per viewer), `UiCodeEditorService` (per editor), `UiJsonTreeService` (per tree).
- **Zoneless and signal-based.** `input()` / `input.required()` / `output()` /
  `model()` / `computed()`, native control flow, no `@Input`/`@Output`, no
  `@HostBinding`/`@HostListener`, no `NgModule`, no zone.js.
- **Layout is data.** The panels are a recursive `UiGridNode` tree rendered
  by `UiPanelGrid` and transformed by `UiPanelLayout`, so moving, grouping and
  dividing panels are transformations of that tree.
- **Accessible.** The app scores zero violations on an axe-core run across
  `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `best-practice`.

## The package

An Angular library built with ng-packagr (`pnpm --filter @tr-file/ui build`,
or `pnpm build:libs` at the workspace root for both libraries) into `dist/`,
in the Angular Package Format — what a consumer outside this workspace
installs. Its styles ship beside it (`@use '@tr-file/ui/styles'`).

Inside the workspace the apps compile the **sources** instead — one type-check
across app and library, and an edit to the library is live in `ng serve`:

| Where | What |
| --- | --- |
| `package.json` | `"@tr-file/ui": "workspace:*"` |
| `tsconfig.json` | `paths` maps `@tr-file/ui` → `../libs/ui/src/public-api.ts` |
| `angular.json` | `stylePreprocessorOptions.includePaths` → `../libs/ui/styles` (the components' `@use 'mixins'`) |

`prj/demo` builds against `dist/` too (`pnpm demo:build`, its `dist`
configuration), so the packaged library is used the way an outside consumer
would use it. Every Angular package extends `prj/tsconfig.angular.json`.

```ts
import { UiWorkbenchShell, provideUiWorkbench } from '@tr-file/ui';
```

```scss
// once, globally — tokens, document reset, scrollbars
@use '@tr-file/ui/styles'; // or `@use 'ui'` through the include path
```

Component SCSS reads design tokens as CSS custom properties (`var(--vsc-*)`,
defined in `styles/_tokens.scss`) and may `@use 'mixins' as *;` for the shared
structural helpers. No component hardcodes a colour.

Two themes (PRD 010, §4): the tokens are VS Code's *Dark Modern* on `:root`, and
*Light Modern* under `:root[data-theme='light']` — only colours change.
`UiThemeService` sets the attribute — from the stored choice as the page
starts, on each change, and with the OS while following it; a component that
needs a colour that differs between themes reads a token for it, never a
literal. The light palette's text colours clear WCAG AA on its surfaces.

## What is in it

| Area | |
| --- | --- |
| The workbench | `UiWorkbenchService`, `provideUiWorkbench`, `UiWorkbenchConfig`, `<ui-workbench-shell>` and its templates (`uiPanelContent`, `uiBottomTab`, `uiPane`, `uiSidebar`, `uiSubApp`); the features: `UiSubAppsFeature`, `UiEditorGroupsFeature`, `UiPanelFocusFeature`, `UiFocusCycleFeature`, `UiSidebarPanesFeature`, `UiBottomPanelFeature`, `UiChromeFeature`, `UiCommandsFeature`, `UiKeybindingsFeature`, `UiCommandPaletteFeature`, `UiContextMenuFeature`, `UiPreferencesFeature`, `UiSettingsEditorFeature`, `UiHelpFeature`, `UiSessionFeature`, `UiResizeFeature` |
| Layout | `UiPanelLayout` — the split tree: insert beside, remove, resize, maximize |
| Shell components | `UiWorkbench` (`leftAt` / `rightAt` put each sidebar at either edge, both at one if need be — PRD 010, §3), `UiTitleBar` (menus, command centre, buttons, zoom, *Upgrade*, window controls), `UiZoomMenu`, `UiActivityBar` (`side`), `UiStatusBar` (with an optional function-key strip, `functionKeys`) |
| Sidebars | `UiSidebar`, `UiPane` (movable by its header or `Ctrl`+`↑`/`↓` — `UiPaneMove`, PRD 002, §5.1; resizable by its sash — `UiPaneResize`, §5.2), `UiTree` (`reorderable` — `UiTreeMove`, PRD 002, §6.1) |
| Details widgets | `UiPreviewCard`, `UiPropertyList` (a value with an `action` is a button — `action`), `UiChipList`, `UiActionList` |
| Panels | `UiPanelGrid`, `UiPanelGroup`, `UiPanelBody`, `UiPanelToolbar`, `UiTabBar`; viewers any content may use: `UiDocumentView` (markdown, text, image, diff, a JSON tree, and the editor), `UiImageView` and `UiImageViewService`, `UiCodeEditor` and `UiCodeEditorService` (a textarea under a coloured overlay; `UiSyntaxHighlighter` — markdown, bash, JSON), `UiJsonTree` and `UiJsonTreeService`, `UiSheet` and `UiSheetService` (a spreadsheet of delimited text; `parseDelimited` / `serializeDelimited`), `UiBreadcrumbs` (a path bar that edits and suggests) |
| Bottom panel | `UiBottomPanel` (`bodyFocus` puts the keyboard in the active tab's content), `UiNotes` (a plain text box: `textChange`, `commit` on blur, `error`) |
| Controls | `UiIconButton`, `UiButton`, `UiSegmented`, `UiSearchField`, `UiSash`, `UiProgress`, `UiEmptyState`, `UiContextMenu` |
| Modal windows | `UiModalService` (`confirm`, `prompt`, `message`, `show`, `open`), `UiModalHost`, `UI_MODAL_REF`; `UiModal` (`size: 'large'` for a window to work in), `UiDialog`, `UiProgressDialog`; `UiSettingsModal`, `UiHelpModal` |
| Settings and help | `UiSettingsEditor`, `UiKeybindingsTable` (with its key recorder), `UiHelp`, `UiCheatsheet` (`UiCheatsheetSection` cards, each a `hue`, keys as keycaps) |
| Keys | `UiKeymap`, `UI_DEFAULT_KEYBINDINGS`, `UI_KEYBINDING_DEFAULTS`, `chordOf`, `displayChord` … — see *Key bindings* |
| Lists | `UiListSelection`, `clickMode`, `moveMode`, the selection modes (`UiSelectionModeFeature`, `UiNormalSelectionMode`, `UiAdditiveSelectionMode`, `uiSelectionMode`), `UiTypeahead`, `pageStep`, `UiVirtualViewport`, `visibleRange` — the building blocks of a keyboard-driven, multi-select, virtualised list (`@tr-file/file-ui`'s are built of them) |
| Palette | `UiQuickInput` — the palette's box; `fuzzyMatch` |
| Settings store and themes | `UiSettingsStore`, `UI_SETTINGS_STORE` (`localStorage` unless provided), `UI_STORAGE_PREFIX`, `UiMemorySettingsStore`, `UiThemeService` |
| Icons | `UiIcon`, `UiIconSprite` |

View models are exported from `lib/models`. Where a model would collide with the
component that renders it, the model carries the `Model` suffix
(`UiPanelGroupModel`, `UiEmptyStateModel`).

## The workbench shell (PRD 001, §17.1)

An application is a configuration, a service, and its templates.

```ts
// app.config.ts
providers: [
  { provide: UI_STORAGE_PREFIX, useValue: 'my-app' },        // its keys in the store: my-app.session.v1, …
  { provide: UI_SETTINGS_STORE, useExisting: MySettings },    // optional: localStorage otherwise
  provideUiWorkbench(MY_CONFIG, MyWorkbenchService),           // or provideUiWorkbench(MY_CONFIG) alone
],
```

```html
<!-- the root: everything but the modal windows goes inert while one is open -->
<div [attr.inert]="modal.isOpen() ? '' : null"><my-workbench /></div>
<ui-modal-host />

<!-- my-workbench -->
<ui-workbench-shell>
  <ng-template uiPane="notes"><ui-tree [nodes]="…" (activate)="…" /></ng-template>
  <ng-template uiPanelContent="note" let-groupId>
    <div uiPanelBody>…the tab's content…</div>
  </ng-template>
  <ng-template uiBottomTab="output">…</ng-template>
  <ng-template uiSubApp="about">…</ng-template>
</ui-workbench-shell>
```

**The configuration** (`UiWorkbenchConfig`) is data: the title, the layout a
window starts with (the grid and its groups), the sub-applications (the
`main` one has the panels and the sidebars), the two sidebars and their panes
(`UiSidebarDef`: id, label, side, the command that toggles it, the setting
that moves it), the bottom panel's tabs, the main menu and the Settings
gear's menu (rows are command ids), the activity bar's other buttons, the
title bar's buttons (each a command, shown pressed while what it `toggles` is
shown), the kinds of panel content (`UiPanelContentDef`: which tab kinds each
is), the application's keys, the settings (`UiPreference` — the library has
builders for its own: `uiColorThemePreference`, `uiSidebarLocationPreference`,
`uiRestoreLayoutPreference`, `uiResetLayoutPreference`), the cheatsheet's
cards, and how a session is read back (`readTab`, `readGroup`, `readSession`,
`writeGroup`, `sessionScope`).

**The service.** `UiWorkbenchService` holds the shared state — the active and
previous panel, the regions' sizes, the restored session — and one instance
of each feature. An application extends it with its own features as fields,
and varies the library's by overriding the `create…` method that makes one:

```ts
@Service({ autoProvided: false })
export class MyWorkbenchService extends UiWorkbenchService<MyTab, MyGroup, MyTarget> {
  declare readonly commandsFt: MyCommandsFeature;
  protected override createCommands() { return new MyCommandsFeature(this); }
  readonly notesFt = new NotesFeature(this);
}
```

Those are called while the base class is being constructed, before the
subclass's own fields exist — so a feature must not read the application's
features until it is used (`UiCommandsFeature` makes its table on first use for
that reason). What each feature lets an application vary:

| Feature | Hooks |
| --- | --- |
| `UiCommandsFeature` | `define()` lists the table — the library's commands placed among the application's with `builtin(id)` / `builtinsOf(prefix)`; `activeTarget()`, `tabTarget()` say what commands act on; `ran()` follows a command run |
| `UiEditorGroupsFeature` | `registerContent(type, driver)` — what loads a tab, says it is loading, takes dropped files, has unsaved changes (`isDirty`, the tab's dot) and may be closed (`canClose`, which may ask); `remember` / `recall` / `follow` keep a group's own fields as tabs change; `blankGroup`, `newTabFrom`, `groupAdded`, `groupRemoved`, `tabChosen`, `tabIcon` |
| `UiChromeFeature` | `activityItems`, `activityBottomItems`, `statusLeadingItems`, `statusTrailingItems` (computeds to override); `menuRow`, `runMenuRow`, `runActivity`, `runStatusAction`, `selectActivity` |
| `UiBottomPanelFeature` | `countOf`, `tabActions`, `runTabAction` |
| `UiCommandPaletteFeature` | `leadingCommands`, `trailingCommands`; `prompt(step)` asks in the box (`UiInputStep`, `UiPickStep`) |
| `UiContextMenuFeature` | `show(request, label, layout, target)` for a menu of the application's; a tab's menu and a sidebar's `…` are built in |
| `UiKeybindingsFeature` | `targetOf(command)` — what a window key acts on |
| `UiPreferencesFeature` | `read` / `write` for settings kept elsewhere, `applied` for what changes at once |
| `UiSessionFeature` | `extras()` — the application's fields of the session |
| `UiSubAppsFeature` | `onShown(id)` |

**The shell** draws the title bar, the activity bar, the sidebars — from the
`uiPane` templates in the order the panes stand, or the application's own
`uiSidebar` — the panels with each tab's `uiPanelContent` template (projected
into its group with the group's injector, so `uiPanelBody` finds it), the
bottom panel, the other sub-applications, the status bar, and over them the
context menus, the gear's menu and the palette. It answers the window's keys
(`UiKeybindingsFeature.handleShortcut`), `Ctrl`+`Tab` round the parts of the
window and `Tab` between panels (PRD 002, §2.6), writes the session before the
page goes, and starts the workbench (`UiWorkbenchService.start`) as it is
made. A desktop shell's extras are its inputs and outputs: `zoom`, `upgrade`,
`windowControls`, `draggable`, `leadingInset`, `functionKeys`, and
`panelFilesDrop` for files dropped on a panel.

**The session** (PRD 003, §6) is written a moment after each change under
`<prefix>.session.v1:<scope>`: the grid, every group with its tabs, the active
panel, the regions' sizes, the panes (open, hidden, order, heights), the
hidden sidebars, the bottom panel — and the application's `extras`. A snapshot
that does not hold together is ignored. *Reset Layout* asks first, forgets it
and reloads.

`provideUiWorkbench` provides a `UiKeymap` of its own beside the workbench, so
it can be given on a lazily loaded route with the keys of the components it
uses (`UI_KEYBINDING_DEFAULTS`) — tr-file's workbench route is.

## Panel content

`UiPanelGroup` is a frame, not a file manager. It renders the tab bar, the
loading rail under it (shown only once a load has lasted
`UI_LOADING_RAIL_DELAY_MS`, so a quick refresh never flashes it) and the body — tab drop zones, OS file drops, the
focus request — and whatever the active tab *shows* is projected into that
body by the application:

```html
<ui-panel-group [group]="shell" [acceptFiles]="true" …>
  <ui-file-browser [browser]="files" (rowActivate)="…" (command)="…" />
</ui-panel-group>
```

Each kind of content is its own component with its own model and its own
toolbar — tr-file's file management is `UiFileBrowser` over a
`UiFileBrowserModel` (`@tr-file/file-ui`): a path bar, a `UiPanelToolbar` and
a list, a grid or a read-only document. In the shell, the content is the
application's `uiPanelContent` template for the tab's kind. A new kind of
content follows the same shape:

- **Model** — its own interface; `UiPanelGroupModel` never grows fields for it.
- **Toolbar** — `UiPanelToolbar` for the row itself, with icon `actions`, a
  right-aligned `summary`, and anything else (a view switch, a filter box)
  projected between them, so every content type looks like it belongs.
- **Body** — mark the element below its chrome with `uiPanelBody`. That is the
  only contract with the group: asked to focus its body, the group looks for the
  tab stop (`tabindex="0"`) inside that element and focuses the element itself
  when there is none. A press on blank space anywhere in the panel — the body,
  the tab bar beside the tabs, the loading rail, the gaps of the content's
  chrome — is a `bodyPress` (PRD 002, §3.1); a press on something focusable is
  not, nor on an element marked `data-own-press`, which answers a press itself
  (the editable path bar, a tab's box). `UiPanelBody` finds
  the group by injection, which works because the content is projected into it.
- **Keys** — the content handles its own; it sits inside the group's host, so it
  sees a key before the group's panel chords do.
- **File drops** — off unless the application sets `acceptFiles` for the tab
  that is showing.

A group with no tabs has no content and renders `UiPanelGroupModel.empty`.

Icons are a `<symbol>` sprite (`UiIconSprite`, rendered once by `UiWorkbench`);
`UiIcon` references symbols by a name from the `UiIconName` union, so a typo is
a compile error rather than an empty box.

## Deviations from the mockup

1. **No Tabler.** `docs/ai/VSCODE-UI.md` makes Tabler the house UI kit, and the
   static mockup loaded it from a CDN. The Angular port does not: the workbench
   is VS Code chrome, for which Tabler offers no component, and the mockup
   already overrode Tabler's tokens wholesale. The one piece the mockup borrowed
   — the progress bar — is `UiProgress` here. This keeps the production bundle
   at ~227 kB (Tabler's CSS alone is 694 kB, which would blow the 500 kB budget)
   and removes a CDN dependency from the Docker images.
2. **Two tokens lightened for contrast.** VS Code's `#6e6e6e` dim grey scores
   ~3.1:1 on the editor background; `--vsc-fg-dim` and `--vsc-git-ignored` use
   `#949494` instead, which clears WCAG AA. Cut entries render at 70% rather
   than 50% opacity for the same reason.
3. **Tab close buttons stay out of the tablist's accessible tree.** A focusable
   button inside `role="tablist"` is an `aria-required-children` violation, so
   the close button is `aria-hidden` with `tabindex="-1"`. The keyboard path is
   the tab's own `Delete`, advertised through `aria-keyshortcuts`. A dirty tab
   shows its dot until hover or focus, then swaps it for the close button, so
   it is closable either way.
4. **Drag and drop has keyboard equivalents, not a keyboard drag.** Pointer
   drags reorder tabs, move them between groups and divide a group at an edge.
   By keyboard: `Ctrl`+`←`/`→` reorders within a bar, the tab bar's split
   buttons divide a group, and every sash is a focusable `separator` that
   arrow keys move in `step` increments. Moving a tab to an *existing* other
   group without a pointer is the one gesture still missing; it wants a command
   palette more than another shortcut.

## The title bar as window decoration

`UiTitleBar` doubles as the decoration of a window that has none (PRD 001,
§8.2), the way VS Code's does. Three inputs turn it into one, and all three are
*data* rather than behaviour, because a web page cannot move a window — only
the desktop shell can, and only it knows there is one:

| Input | What it does |
| --- | --- |
| `windowControls` | The buttons at the bar's end. Empty in a browser, where the tab has its own |
| `draggable` | Makes the bar's empty space the region the OS moves the window by |
| `leadingInset` | Blank space for buttons the *platform* draws over the bar, i.e. macOS's traffic lights |

A drag region swallows clicks, so `is-draggable` puts every button, input and
link back with `app-region: no-drag` — without that, the menu bar would simply
stop working. The buttons are their own `role="toolbar"` group, flush to the
corner and 46px wide like every desktop's, and only the one marked `danger`
turns red. A double-click is reported through `dragAreaDoubleClick`, but only
when it landed on the bar itself: without that guard, double-clicking a menu
entry would maximize the window.

`upgrade` (PRD 001, §8.6) is the blue *Upgrade* button right of the command palette box —
at the start of the right-hand column, so it sits against the command centre
however many chrome buttons follow. The app sets it while a newer version is
there (`busy` while it is being put in place) and hears `upgradeSelect`.

## Panel interactions

The gestures of the panels and the shell. Those on a listing's rows and tiles are
`@tr-file/file-ui`'s (`UiFileList`, `UiIconView`, `UiFileBrowser`), listed here
because they are what a panel of tr-file answers.

| Gesture | Result |
| --- | --- |
| Click a tab | Activates it; the group re-points at that folder, takes focus, and focus moves into its body |
| Double-click a tab | Emits `tabDoubleClick`; the app maximizes or restores that group — `UiPanelGrid` hides the others (`inert`) rather than removing them, so nothing is rebuilt |
| Middle-click / close button / `Delete` | Closes the tab; the group goes with its last tab |
| Drag a tab inside its bar | Reorders it, with a 2px insertion bar showing the landing spot |
| Drag a tab onto another bar or a group's centre | Moves it into that group |
| Drag a tab onto a group's edge (outer 25%) | Divides that group; the tab lands in the new half |
| Split right / Split down, or `/` | Copies the active tab into a new group beside this one |
| `Ctrl`+`T` | Emits `new-tab` (`actionSelect`); the app opens a new tab on the same folder (PRD 002, §2.2) |
| `Ctrl`+`W` | Closes the panel's focused tab; the group goes with its last one |
| `Ctrl`+`PageUp` / `Ctrl`+`PageDown` | Moves to the previous / next tab, wrapping at either end |
| `Ctrl`+`Enter`, or `Ctrl`+double click | Emits `open-aside`; the app opens that entry in a new tab of the other panel (PRD 002, §2.5) |
| Maximize, or double-click a tab | Renders one group alone; the button becomes Restore |
| Press a group's blank space — body, tab bar, loading rail, toolbar gaps | Emits `bodyPress`; the app focuses the group and its content |
| Drag OS files onto a group's body | Emits `fileDrop` with the dropped `File`s; the app uploads them |
| Drag a sash / focus it and press arrows | Resizes the two regions it divides |
| Drag the title bar's empty space | Moves a frameless desktop window; double-click maximizes |
| Click a window button | Emits `windowControlSelect`; the shell minimizes, maximizes or closes |
| Click a tree row / press `Enter` | Emits `activate`; the twisty and `←`/`→` emit `toggle` |
| Main menu (`UiTitleBar`, PRD 008) | A `role="menubar"`: a title opens its `items` under it (`menuOpenChange`), a second click closes it; with one open, pointing at another title or `←`/`→` inside it switches menus; `↓` on a title opens it, `←`/`→` walk the titles; a choice is `menuItemSelect({ menuId, itemId })`. Items with `checked` are `menuitemradio` rows with a check mark |
| An activity item with `separatorBefore` | Starts a new group of buttons, with a short rule above it (none before the first) |
| Click an activity item with `hasMenu` (the Settings gear) | Emits `menuOpen` with the button's rect instead of `select`; the button carries `aria-haspopup="menu"` and `aria-expanded` |
| In a `UiContextMenu` | Focus starts on the first row; `↑`/`↓` wrap, `Home`/`End` jump, `Enter`/`Space` choose (disabled rows are readable but do nothing); `Escape` and a choice hand focus back to the opener; `Escape`, `Tab`, a click elsewhere, window blur or resize emit `dismiss` with the reason. `fixed` + `origin: 'bottom-left'` opens it upward from a point, as VS Code's Manage menu does |
| Arrow around a panel body | Moves focus *and* the selection; the details sidebar follows |
| `Ctrl`/`⌘`-click, `Ctrl`+`Space` | Toggles one entry in or out of the selection (every view) |
| `Shift`-click, `Shift` + a movement key | Selects the range from the anchor; `Ctrl`+`Shift`-click adds the range |
| `Ctrl` + an arrow, `Home`, `End` | Moves the cursor without changing the selection |
| `Ctrl`+`A` | Selects every entry |
| `Insert` | Marks the entry (or unmarks it) and moves the cursor on, selecting nothing else (PRD 004, §2) |
| `*` | Selects every entry — or none, once every one is |
| Drag across blank space in the icon view | Box selection: every tile the box touches; added to the selection with `Ctrl`/`Shift`. A plain click on blank space clears it |
| `Enter` / `Space` / `Backspace` / `Delete` / `+` / `-` in a body, `Ctrl`+`R` anywhere in it | Emitted as a `UiPanelKey`; the app decides what each means |
| `Ctrl`+`C` / `X` / `V` over a listing | `copy` / `cut` / `paste` panel keys (PRD 005, §2) |
| Drag a row or tile | Onto a folder or another listing: `entryDrop`, a move — or a copy with `Ctrl` |
| `Alt`+`←` / `Alt`+`→` in a body | Emitted as `back` / `forward`; the app walks that panel's own trail |
| `Alt`+`↑` in a body | Emitted as `up`; the app leaves the folder for its parent |
| Tree view (`UiPanelView` `'tree'`) | The details table as a tree grid: same columns, folders open in place |
| Twisty, or `→` / `←` on a tree row | Emits `toggle` (`UiFileBrowser.rowToggle`); `→` on an open folder steps into it, `←` on anything else steps out to its parent |
| Double-click a file (browser gets a `document`) | The body becomes a read-only `UiDocumentView`: markdown or text, path and `Read-only` on a status line, no view switch |

Closing the last group anywhere leaves a single empty group, so there is always
somewhere to drop a tab.

### Getting into a panel body

Choosing a tab means wanting to work in it, so once its content has rendered
the body takes focus — no `Tab`, `Tab`, `Tab` down from the tab bar (PRD 001,
§6.3). Pressing blank space in the panel means the same thing (§6.3.1; PRD 002,
§3.1 widened it from the body to the tab bar and the content's chrome), and
`bodyPress` reports it — but only when the press landed on nothing focusable,
since a row, a tile or the document's scroll container is already about to take
focus and asking again would drag it off what was actually clicked. `UiTabBar` separates the two things a tab bar reports: a click
(or the `Enter`/`Space` the browser turns into one) emits `select` **and**
`activate`, while the arrow keys emit only `select`. If roving counted as
choosing, focus would leave the bar on the first arrow and the tab after next
would be unreachable.

The application answers `activate` by bumping `UiPanelGroup`'s `focusBody`
token; the group moves focus after its next render, onto whichever single tab
stop the body is currently offering — the focused row, the focused tile or the
document's scroll container. A token rather than a boolean, because asking
twice for the same group has to be two asks. A request whose body is still
`loading` survives until the rows arrive, so a tab clicked before its folder
has been fetched still ends up focused; any other unsatisfied request is spent
at once, so a stale ask can never steal focus back from the user.

## Quick input (PRD 009, §1)

`UiQuickInput` is VS Code's quick input: a box hanging from the top of the
window, centred, with one field and under it either a list to pick from or a
message (a hint in blue, a problem in red). Focus stays in the field — it is a
`combobox` whose list is announced through `aria-activedescendant` — so `↑`/`↓`
move the active row (wrapping), `Enter` emits `accept`, `Escape` emits
`dismiss` and hands focus back, and focus leaving the box dismisses it too.
Rows carry optional `highlights` (drawn bold in the link blue), an `icon`, key
chips, and `buttons` — VS Code's row actions, shown on the active row and the
one under the pointer, each with an optional `shortcut` (e.g. `F2`,
`Shift+Delete`) that works on the active row, reported as `itemButton`;
`busy` draws a progress rail along the top. It filters nothing and decides
nothing: the command palette (`UiCommandPaletteFeature`) owns the list, the
matching (`fuzzyMatch`) and what accepting means.

## Modal windows (PRD 002, §3)

Two pieces, split the way VS Code's own are:

- **`UiModal`** is the window: the page dimmed behind it, the window centred,
  `role="dialog"` with `aria-modal`, and the keyboard kept inside — focus goes
  to the element marked `data-autofocus` (else the first focusable), `Tab`
  wraps, and focus returns to wherever it was when the window closes.
  `Escape` emits `dismiss` when `dismissible`; a click outside never closes
  it — the window shakes, as VS Code's does, to say it is waiting.
- **`UiDialog`** is VS Code's message dialog inside it: a close button in the
  corner, the severity icon (`info`, `question`, `warning`, `error`) beside the
  bold message, a quieter `detail`, then an optional text field (with an
  `error` that holds the primary button back, and a `selection` to preselect)
  and checkbox, and the buttons bottom-right. The first button is primary —
  accent-coloured, focused first, what `Enter` in the field presses — and
  `←`/`→` move between buttons. It reports `choose` with the button, the
  checkbox and the field, and never closes itself.

- **`UiProgressDialog`** is a long-running operation (PRD 005, §1): the title,
  the entry being worked on, a `UiProgress` bar and the counts, from a
  `UiProgressDialogModel`. While it runs it offers *Run in Background*
  (`background`) and *Cancel* (`cancel`, shown as *Cancelling…* and disabled
  once asked); once it has ended, only *Close* (`close`) — with the reason,
  as an alert, when it failed. It closes nothing itself either.

Anything else — a form, a picker — is projected into `UiModal` as it is.
`button[uiButton]` (`variant: 'primary' | 'secondary'`) is the text button both
use.

`UiModalService` keeps the stack of windows and `UiModalHost` draws it, once,
at the root: `await modal.confirm(…)`, `prompt(…)`, `message(…)`, `show(…)` for
a whole message dialog, or `open(Component, …)` for a component of the
application's, which closes itself through `UI_MODAL_REF`. Every call resolves
when its window closes — `null` for `Escape`. A dialog shown with `onTop`
stays above every window opened after it (PRD 004, §2.2). Making the page
behind the windows `inert` is the host's job — the library does not own the
page: `[attr.inert]="modal.isOpen() ? '' : null"` around everything but the
host. The settings and Help windows (`UiSettingsModal`, `UiHelpModal`) are
opened this way by their features.

## Key bindings (PRD 010, §2)

No component tests a key itself for anything that is a *command*: it asks
`UiKeymap` (a root service, the one piece of state the library keeps) which of
*its* commands the key is bound to, in its context — `list` for a row or a
tile, `panel` for a panel's content and the group around it, `window` for the
application's own. A binding is `{ command, key, when }`, VS Code's shape; a
key is a chord as `chordOf` writes it (`Ctrl+Shift+P`, `Alt+Left`, `F5`,
`Plus`, `*`), with `Cmd` read as `Ctrl` and a symbol written without the
`Shift` it took.

The keymap starts with its `defaults`: every table provided as
`UI_KEYBINDING_DEFAULTS` (`multi`) — `@tr-file/file-ui`'s listings' keys, with
`provideFileUi()` — then `UI_DEFAULT_KEYBINDINGS`, the library's own: a panel
group's (split, new tab, maximize, close, the next and previous tab) and the
image viewer's (zoom and fit). So the components work as they are. In a
workbench, `UiKeybindingsFeature` owns the table in force — those defaults,
then the configuration's `keybindings`, less what the user removed and with
what they added (`<prefix>.keybindings.v1`) — and hands it to the keymap on
every change; the menus, the palette and the cheatsheet read the keys they
show from it, so what is shown is what works. It also runs the window's keys
(`when: 'window'`) as commands of the table.

A key a component answers for a command of the application's table is bound
to that command's id (`tab.new`, or tr-file's `file.open`), so one binding
governs both the key and what a menu shows beside the command. Gestures have
ids of their own: `view.splitRight`, `tab.previous`, `tab.next`,
`image.zoomIn`, … Navigation is not bound — the arrows, `Home` /
`End`, the page keys, type-to-find, `Escape`, and the keys inside menus,
dialogs and the quick input are what those widgets *are*, not commands.

`UiSettingsEditor` and `UiKeybindingsTable` draw the settings window
(PRD 010): a table of contents, a search box, pages of settings drawn the way
VS Code draws them — `Category: Title`, the description, a checkbox,
drop-down or button, a bar by a setting changed from its default — and the
Keyboard Shortcuts table. Its recorder takes the keyboard while a key is
recorded: each key is reported as a chord, `Enter` accepts (or is recorded
itself, as the first key), `Escape` gives up, and neither reaches the modal
around it.

## Testing

The library has its own specs, next to what they test, and its own test target
(`@angular/build:unit-test`, Vitest in jsdom): `pnpm --filter @tr-file/ui test`,
or `pnpm test:libs` at the workspace root for both libraries, after the
boundaries check. `ui-workbench-shell.spec.ts` runs the shell on a small
workbench of its own; helpers that are only for specs live in `src/testing/`,
outside the package.
