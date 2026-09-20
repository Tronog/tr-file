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
| Editor | `UiPanelGrid`, `UiPanelGroup`, `UiTabBar`, `UiBreadcrumbs`, `UiFileList`, `UiIconView` |
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

## Panel interactions

| Gesture | Result |
| --- | --- |
| Click a tab | Activates it; the group re-points at that folder and takes focus |
| Middle-click / close button / `Delete` | Closes the tab; the group goes with its last tab |
| Drag a tab inside its bar | Reorders it, with a 2px insertion bar showing the landing spot |
| Drag a tab onto another bar or a group's centre | Moves it into that group |
| Drag a tab onto a group's edge (outer 25%) | Divides that group; the tab lands in the new half |
| Split right / Split down | Copies the active tab into a new group beside this one |
| Maximize | Renders one group alone; the button becomes Restore |
| Drag OS files onto a group's body | Emits `fileDrop` with the dropped `File`s; the app uploads them |
| Drag a sash / focus it and press arrows | Resizes the two regions it divides |

Closing the last group anywhere leaves a single empty group, so there is always
somewhere to drop a tab.

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
