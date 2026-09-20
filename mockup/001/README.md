# Mockup 001 — VS Code style file manager

Design deliverable for `docs/prd/001.md`, **Section 1**. Static HTML/CSS only —
no JavaScript, no framework, no interactivity (per the PRD: *"Interactivity will be
done in future. Only design for now."*).

| File | Contents |
| --- | --- |
| `index.html` | The full workbench at rest — title bar, activity bar, left tree sidebar, three panel groups (one split column), bottom panel, right details sidebar, status bar |
| `states.html` | Every drag / resize / menu state rendered statically, with annotations: tab drops (split right, split down, join group, reorder), sash dragging, context menu, empty group, dragging files out of the tree |
| `vscode-ui.css` | The skin: VS Code "Dark Modern" tokens layered over Tabler 1.5.1 |

## Viewing

Open either file in a browser. Chrome blocks `file://` for some tooling, so a
local server is the reliable route:

```bash
cd docs/mockup/001 && python3 -m http.server 8731
# http://localhost:8731/index.html
```

Tabler 1.5.1 core CSS comes from the jsDelivr CDN (`docs/ai/VSCODE-UI.md` §2), so
first load needs network access. Icons are an inline `<symbol>` sprite at the top
of each page — `@tabler/core` ships no icon font (§2, gotcha 11), and an external
sprite file would be blocked over `file://`.

## Layout

```
┌──────────────────────── title bar (menu · command center · layout toggles) ───┐
│ act │  left sidebar   │            editor area              │ right sidebar   │
│ bar │  directory tree │  ┌────────────┬──────────────────┐  │  details        │
│     │                 │  │  group 1   │     group 2      │  │  · preview      │
│     │  panes:         │  │  (tabs +   ├──── sash ────────┤  │  · properties   │
│     │  Places         │  │   list)    │     group 3      │  │  · permissions  │
│     │  tr-file (tree) │  ├──────────── sash ─────────────┤  │  · tags         │
│     │  Outline        │  │        bottom panel           │  │  · git          │
│     │  Timeline       │  │  problems/output/term/transfers│ │  · open with    │
└──────────────────────── status bar ───────────────────────────────────────────┘
```

The workbench is a CSS grid: `48px | 280px | 4px | 1fr | 4px | 320px`. Every
`4px` column or row is a `.vsc-sash` — the draggable border from the PRD. The
editor area is a nested grid, which is what makes groups divisible and
groupable: a group is either a leaf (`.vsc-group`, tab bar + body) or a
`.vsc-grid--cols` / `.vsc-grid--rows` holding two children. `index.html` shows
one of each nesting so the visual result of a split is fixed by the design.

## Conventions followed

- **Tabler first, skin second.** Stock Tabler components are used where they fit
  (`.progress` / `.progress-bar` in the transfers panel, the grid/flex and spacing
  utilities); `vscode-ui.css` redefines Tabler's own tokens (`--tblr-body-bg`,
  `--tblr-border-color`, `--tblr-primary`, …) rather than fighting them.
- **No JS.** Per `docs/ai/VSCODE-UI.md` §8, every "interactive" state — active tab,
  focused row, selected rows, open context menu, drag overlay, hovered sash — is
  written into the markup. Nothing depends on Bootstrap's plugins.
- **`data-bs-theme="dark"` is server-rendered** on `<html>`; `tabler-theme.min.js`
  is deliberately not loaded (§5).
- **VS Code theme keys as CSS variables.** `--vsc-list-active`, `--vsc-tab-active-bg`,
  `--vsc-focus-border` and friends are named after the corresponding VS Code theme
  keys, so a light theme (or a real theme import) is a variable swap.

## States covered

`index.html`: active vs inactive tab, preview tab (italic), dirty tab (dot),
focused group (accent rule on its active tab), tree selection + focus outline,
cut/clipboard row (50% opacity), git decorations (modified / untracked / ignored),
list view and grid view, multi-selection in a list, inactive selection in an
unfocused group, transfers in progress / queued / done.

`states.html`: drop zones (right half → split right, bottom half → split down,
full body → join group), tab reorder insertion bar with the source tab dimmed,
drag ghost incl. multi-item count, active sashes both axes, file context menu,
empty group, folder row as a move target.

## Deliberately out of scope

Interactivity (PRD Section 1 defers it), responsive/narrow layouts, light theme,
keyboard focus traversal, real file data, and the Angular implementation. When
this becomes an Angular feature, the split-grid state (tree of groups, sizes,
tab order, active group) is the state that belongs in a feature class per
`docs/ai/ANGULAR.md` — the markup here is written so a component tree maps onto
it 1:1: `Workbench > ActivityBar | Sidebar | EditorGrid > Group > TabBar + Body`.
