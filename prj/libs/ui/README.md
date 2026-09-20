# @tr-file/ui

The workbench component library: a VS Code style shell built as small,
presentational Angular components. It is the Section 6 port of the static
mockup in `mockup/001/` (PRD 001, Section 1).

## Principles

- **Presentational only.** Every component takes signal inputs and emits
  outputs. None of them injects a service, fetches anything, or keeps business
  state. Application state lives in `frontend/src/app/workbench` (a thin
  service plus feature classes, per `docs/ai/ANGULAR.md`).
- **Zoneless and signal-based.** `input()` / `input.required()` / `output()` /
  `model()` / `computed()`, native control flow, no `@Input`/`@Output`, no
  `@HostBinding`/`@HostListener`, no `NgModule`, no zone.js.
- **Layout is data.** The editor area is a recursive `UiGridNode` tree rendered
  by `UiPanelGrid`, not a fixed template — so moving, grouping and dividing
  panels become transformations of that tree when interactivity lands.
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
3. **Inert affordances are hidden from assistive tech.** Sashes
   (`role="separator"` with no value and no drag) and tab close buttons are
   `aria-hidden` with `tabindex="-1"` while interactivity is deferred. Adding
   drag support means restoring focusability together with `aria-value*`;
   wiring up close means dropping `aria-hidden` and giving the tab a keyboard
   path to it.

## Testing

Specs for the library components live with the app's tests
(`frontend/src/app/workbench/ui-library.spec.ts`) because the app's test target
is what compiles this source. Run them with `pnpm exec ng test` from
`prj/frontend`.
