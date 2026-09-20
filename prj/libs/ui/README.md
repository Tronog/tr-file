# @tr-file/ui

The workbench component library: a VS Code style shell built as small,
presentational Angular components. It is the Section 6 port of the static
mockup in `mockup/001/` (PRD 001, Section 1).

## Principles

- **Presentational only.** Every component takes signal inputs and emits
  outputs. None of them injects a service, fetches anything, or keeps business
  state. Application state lives in `frontend/src/app/workbench` (a thin
  service plus feature classes, per `docs/ai/ANGULAR.md`).
- **Interactions are reported, not applied.** A sash emits the pixels it
  travelled; a tab bar emits where a tab was dropped; a group emits which edge
  received it. None of them moves anything — the feature classes own the layout
  tree and decide what a gesture means. The only state a component keeps to
  itself is the transient kind a drag needs (which tab is dragging, where the
  insertion bar sits, which drop zone is lit), which dies with the gesture.
- **Zoneless and signal-based.** `input()` / `input.required()` / `output()` /
  `model()` / `computed()`, native control flow, no `@Input`/`@Output`, no
  `@HostBinding`/`@HostListener`, no `NgModule`, no zone.js.
- **Layout is data.** The editor area is a recursive `UiGridNode` tree rendered
  by `UiPanelGrid`, not a fixed template, so moving, grouping and dividing
  panels are transformations of that tree (`PanelLayoutFeature` in the app).
- **Accessible.** The app scores zero violations on an axe-core run across
  `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` and `best-practice`.

## Consuming it

The library ships TypeScript source and is compiled by the app that uses it —
no ng-packagr, one type-check across both. The frontend wires it up in three
places:

| Where | What |
| --- | --- |
| `frontend/package.json` | `"@tr-file/ui": "workspace:*"` |
| `frontend/tsconfig.json` | `paths` maps `@tr-file/ui` → `../libs/ui/src/public-api.ts` |
| `frontend/angular.json` | `stylePreprocessorOptions.includePaths` → `../libs/ui/src/styles` |

```ts
import { UiTree, UiPanelGrid } from '@tr-file/ui';
```

```scss
// once, globally — tokens, document reset, scrollbars
@use 'ui';
```

Component SCSS reads design tokens as CSS custom properties (`var(--vsc-*)`,
defined in `styles/_tokens.scss`) and may `@use 'mixins' as *;` for the shared
structural helpers. No component hardcodes a colour.

## What is in it

| Area | Components |
| --- | --- |
| Shell | `UiWorkbench`, `UiTitleBar`, `UiActivityBar`, `UiStatusBar` |
| Sidebars | `UiSidebar`, `UiPane`, `UiTree` |
| Details | `UiPreviewCard`, `UiPropertyList`, `UiPermissionGrid`, `UiChipList`, `UiActionList` |
| Editor | `UiPanelGrid`, `UiPanelGroup`, `UiTabBar`, `UiBreadcrumbs`, `UiFileList`, `UiIconView`, `UiDocumentView`, `UiImageView` |
| Bottom panel | `UiBottomPanel`, `UiTransferList` |
| Controls | `UiIconButton`, `UiSegmented`, `UiSearchField`, `UiSash`, `UiProgress`, `UiEmptyState`, `UiContextMenu` |
| Icons | `UiIcon`, `UiIconSprite` |

View models are exported from `lib/models`. Where a model would collide with the
component that renders it, the model carries the `Model` suffix
(`UiPanelGroupModel`, `UiEmptyStateModel`).

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

## Panel interactions

| Gesture | Result |
| --- | --- |
| Click a tab | Activates it; the group re-points at that folder, takes focus, and focus moves into its body |
| Middle-click / close button / `Delete` | Closes the tab; the group goes with its last tab |
| Drag a tab inside its bar | Reorders it, with a 2px insertion bar showing the landing spot |
| Drag a tab onto another bar or a group's centre | Moves it into that group |
| Drag a tab onto a group's edge (outer 25%) | Divides that group; the tab lands in the new half |
| Split right / Split down, or `Ctrl`+`T` | Copies the active tab into a new group beside this one |
| `Ctrl`+`W` | Closes the panel's focused tab; the group goes with its last one |
| Maximize | Renders one group alone; the button becomes Restore |
| Press a group's empty body | Emits `bodyPress`; the app focuses the group and its content |
| Drag OS files onto a group's body | Emits `fileDrop` with the dropped `File`s; the app uploads them |
| Drag a sash / focus it and press arrows | Resizes the two regions it divides |
| Drag the title bar's empty space | Moves a frameless desktop window; double-click maximizes |
| Click a window button | Emits `windowControlSelect`; the shell minimizes, maximizes or closes |
| Click a tree row / press `Enter` | Emits `activate`; the twisty and `←`/`→` emit `toggle` |
| Arrow around a panel body | Moves focus *and* the selection; the details sidebar follows |
| `Enter` / `Space` / `Backspace` / `F5` in a body | Emitted as a `UiPanelKey`; the app decides what each means |
| `Alt`+`←` / `Alt`+`→` in a body | Emitted as `back` / `forward`; the app walks that panel's own trail |
| Double-click a file (group gets a `document`) | The body becomes a read-only `UiDocumentView`: markdown or text, path and `Read-only` on a status line, no view switch |

Closing the last group anywhere leaves a single empty group, so there is always
somewhere to drop a tab.

### Getting into a panel body

Choosing a tab means wanting to work in it, so once its content has rendered
the body takes focus — no `Tab`, `Tab`, `Tab` down from the tab bar (PRD 001,
§6.3). Pressing the body's blank space means the same thing (§6.3.1), and
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

### Inside a panel body

The two directory views answer to the keyboard a file manager trains people to
expect (PRD 001, Section 6.2). `UiFileList` moves with `↑`/`↓`, `Home`/`End`
and `PageUp`/`PageDown`; `UiIconView` adds `←`/`→` for one tile and uses the
vertical arrows for a whole *visual row*, whose width it measures off the
rendered tiles because `auto-fill` — not the component — decides how many fit.
Typing letters jumps to a name in both: a prefix while the keystrokes keep
coming, and a single letter pressed repeatedly cycles through the entries
sharing it.

`UiPanelGroup` adds the one chord that belongs to the *panel* rather than to
what is selected in it: `Alt`+`←`/`→` walks the folders it has visited (PRD
001, §6.2.1). It is handled on the body rather than in either view, so it works
just as well over a document or an empty placeholder — neither of which has a
keyboard of its own — and both views let an `Alt` chord bubble untouched so it
arrives exactly once.

Two chords belong to the panel as a whole rather than to what is selected in
it (PRD 001, §6.2.2): `Ctrl`+`T` splits it and `Ctrl`+`W` closes its focused
tab. They are bound on the group's host, so they answer with focus anywhere
inside — a row, a tile, the document, or a tab in the bar — and they emit
exactly what the tab bar's split and close buttons emit, so the pointer and
the keyboard cannot drift apart.

An **empty folder** is the case that makes all of this hold together. Its
placeholder contains nothing focusable, so the body carries `tabindex="-1"` and
takes focus itself when it has nothing else to offer; without that the keyboard
would fall out of the panel and every one of its keys would reach nothing — a
keyboard user could walk into an empty folder and not get out. For the same
reason the group answers `Backspace` and `F5` when the body *itself* has focus,
and only then: whenever there is a row or a tile to stand on, those keys belong
to the view that owns it.

Two rules are worth stating outright. **Selection follows focus**: arrowing
onto an entry emits `select`, so the details sidebar tracks the keyboard the
same way it tracks the mouse. And **the views move focus but decide nothing**:
`Enter`, `Space`, `Backspace` and `F5` leave as a `UiPanelKey`
(`open` / `select` / `up` / `refresh`) for the application to interpret — in
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

## Testing

Specs for the library components live with the app's tests
(`frontend/src/app/workbench/ui-library.spec.ts`) because the app's test target
is what compiles this source. Run them with `pnpm exec ng test` from
`prj/frontend`.
