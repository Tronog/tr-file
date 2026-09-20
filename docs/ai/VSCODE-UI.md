# Tabler UI — AI Agent Reference (v1.5.1)

Ground truth for this file: `@tabler/core` npm package README/source (github.com/tabler/tabler, `master` branch), the compiled `tabler.min.css` (v1.5.1, 694KB, grepped directly), and `docs.tabler.io` MDX source files (`docs/content/ui/**/*.mdx`), which are the literal source of the rendered docs and of `https://docs.tabler.io/llms.txt`. Every class/attribute below was either found in the compiled CSS or copied verbatim from an official `.mdx`/`.astro` example. Anything not directly verified is marked **[UNVERIFIED]**.

Use this file instead of re-fetching docs. If a class you need isn't here, fetch `https://docs.tabler.io/ui/components/<name>.md` (plain markdown, no JS rendering).

---

## 1. Identity

- **What it is**: free, open-source dashboard/admin UI kit built on top of Bootstrap. Vendors its own fork of Bootstrap's SCSS and JS (`core/scss/_core.scss` `@forward`s `bootstrap/root`, `bootstrap/grid`, `bootstrap/dropdown`, etc.; JS in `core/js/src/bootstrap/*`) rather than depending on the `bootstrap` npm package.
- **Bootstrap base**: confirmed "built on Bootstrap" (`llms.txt` tagline). JS API uses `data-bs-*` attributes (Bootstrap 5 convention). No exact upstream Bootstrap version is pinned in `core/package.json` (only dependency: `@popperjs/core: ^2.11.8`) — the Bootstrap source is vendored/customized, not imported as-is.
- **Version**: 1.5.1 (CSS banner: `Tabler v1.5.1`, `core/package.json`, copyright 2018–2026).
- **License**: MIT (`core/package.json`, repo `LICENSE`).
- **Repo**: https://github.com/tabler/tabler (monorepo: `core/` = CSS/JS package, `docs/` = docs.tabler.io source, `preview/` = preview.tabler.io demos, `shared/` = components shared by both).
- **Docs**: https://docs.tabler.io — prefer the markdown mirror `https://docs.tabler.io/<page>.md` or the full index `https://docs.tabler.io/llms.txt` over the JS-rendered HTML.
- **Live demo**: https://preview.tabler.io

---

## 2. Install

### CDN (jsDelivr, no build step)

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/core@1.5.1/dist/css/tabler.min.css" />
<script src="https://cdn.jsdelivr.net/npm/@tabler/core@1.5.1/dist/js/tabler.min.js"></script>
```

CSS in `<head>`, `tabler.min.js` at the end of `<body>` (contains dropdown, modal, tab, toast, tooltip, popover, offcanvas, collapse, carousel, alert-dismiss, scrollspy, plus Tabler's `sidebar.ts`/`datepicker.ts` etc.).

Other CDN CSS bundles in `dist/css/` (confirmed via jsDelivr file listing for `@tabler/core@1.5.1`):

| File | Purpose |
|---|---|
| `tabler.min.css` | Core (what you almost always want) |
| `tabler.rtl.min.css` | Core, RTL direction |
| `tabler-themes.min.css` | Extra color-theme palettes |
| `tabler-props.min.css` | CSS custom-property declarations only (no rules) |
| `tabler-flags.min.css` | Country flag icons |
| `tabler-marketing.min.css` | Marketing/landing-page extras |
| `tabler-payments.min.css` | Payment-brand icons (Visa, etc.) |
| `tabler-socials.min.css` | Social-brand colors/icons |
| `tabler-vendors.min.css` | 3rd-party vendor icon marks |

Each has a `.rtl.min.css` counterpart. Load a plugin CSS the same way as core, e.g. `.../dist/css/tabler-flags.min.css`.

JS files in `dist/js/`: `tabler.min.js` (ESM: `tabler.esm.min.js`) and `tabler-theme.min.js` (ESM: `tabler-theme.esm.min.js`). **No separate `bootstrap.bundle.js` needed** — `tabler.min.js` already contains the vendored Bootstrap JS components.

### npm

```bash
npm install @tabler/core
```

```js
import '@tabler/core/dist/css/tabler.min.css';
import '@tabler/core/dist/js/tabler.min.js'; // or tabler.esm.js for ESM
```

3rd-party libs used by some plugins (charts, input masks, calendars, etc.) are **not** bundled as dependencies of `@tabler/core` — install them yourself per `core/libs.json` if you need those plugins.

### Icons

Tabler ships **no icon font and no SVG sprite** in `@tabler/core` 1.5.1. The documented method: copy the raw inline `<svg class="icon">...</svg>` markup per icon from https://tabler.io/icons and paste it into your HTML. Icons are a separate MIT-licensed project, **Tabler Icons** (5000+ icons), also distributed as npm `@tabler/icons` (confirmed on the npm registry, v3.47.0; React components) and reportedly `@tabler/icons-webfont`/`@tabler/icons-sprite` **[UNVERIFIED — package names not individually re-checked this session]**. For static no-JS/no-build HTML, inline SVG copy-paste is the only ground-truth-confirmed approach.

```html
<!-- copy exact <svg> from tabler.io/icons, add class="icon" -->
<svg xmlns="http://www.w3.org/2000/svg" class="icon" width="24" height="24" viewBox="0 0 24 24"
     fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
  <path d="M10 14a3.5 3.5 0 0 0 5 0l4 -4a3.5 3.5 0 0 0 -5 -5l-.5 .5" />
  <path d="M14 10a3.5 3.5 0 0 0 -5 0l-4 4a3.5 3.5 0 0 0 5 5l.5 -.5" />
</svg>
```

Icon utility classes (grep-confirmed and from `components/icon.mdx` frontmatter): `.icon` (base, applied to the `<svg>`), `.icon-filled` (fill with currentColor — for "filled" variant SVGs only), `.icon-inline` (aligns with text baseline), `.icon-sm` (1rem), `.icon-md` (1.5rem, thinner stroke), `.icon-lg` (2.5rem), `.icon-pulse`, `.icon-tada`, `.icon-rotate` (animations). Color with a `text-{color}` utility on the icon or its parent.

---

## 3. Page shell / layout system

### Core class chain

`.page` (outermost flex container) → one or two navbars as **direct children** → `.page-wrapper` (everything else) → `.page-header` (optional title bar) + `main.page-body` (content) → optional `footer.footer`.

Grep-confirmed classes in `tabler.min.css`: `page`, `page-wrapper`, `page-wrapper-full`, `page-header`, `page-body`, `page-title`, `page-pretitle`, `page-subtitle`, `navbar`, `navbar-vertical`, `navbar-expand-{sm,md,lg,xl}`, `navbar-collapse`, `navbar-nav`, `navbar-brand`, `navbar-brand-autodark`, `navbar-toggler`, `navbar-side`, `navbar-folded`, `navbar-folded-hover`, `nav-section-title`, `container-xl`, `container-fluid`, `container-narrow`, `container-tight`, `row-deck`, `row-cards`.

### Container widths

- `.container-xl` — default page content width (most common; matches Bootstrap breakpoints up to `xl`).
- `.container-fluid` — full width, used inside the navbar/sidebar shell itself.
- `.container-narrow` / `.container-tight` — narrower reading-width variants (login pages, forms).

### Layout A — Horizontal navbar (Bootstrap-default top nav)

Source: `docs/content/ui/layout/page-layouts.mdx` "Sample layout" (verbatim structure, trimmed to essentials):

```html
<div class="page">
  <header class="navbar navbar-expand-sm d-print-none">
    <div class="container-xl">
      <h1 class="navbar-brand navbar-brand-autodark pe-0 pe-md-3">
        <a href="."><img src="/static/logo.svg" width="110" height="32" alt="Tabler" class="navbar-brand-image" /></a>
      </h1>
      <div class="navbar-nav flex-row order-md-last">
        <div class="nav-item">
          <a href="#" class="nav-link d-flex lh-1 text-reset p-0">
            <span class="avatar avatar-sm" style="background-image: url(/static/avatars/002m.jpg)"></span>
          </a>
        </div>
      </div>
    </div>
  </header>
  <div class="page-wrapper">
    <main class="page-body">
      <div class="container-xl">
        <div class="row row-deck row-cards">
          <div class="col-4"><div class="card"><div class="card-body" style="height: 10rem"></div></div></div>
          <div class="col-12"><div class="card"><div class="card-body" style="height: 10rem"></div></div></div>
        </div>
      </div>
    </main>
  </div>
</div>
```

### Layout B — Vertical navbar (sidebar), full menu + page-header — COMPLETE COPY-PASTE SKELETON

This is the pattern to default to for a dashboard app. Source: `docs/content/ui/layout/page-layouts.mdx` "Sidebar layout", merged with the page-header pattern from `docs/content/ui/layout/page-headers.mdx`-equivalent (`PageHeader.astro`), plus install tags. This is a complete, working static HTML page:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>My App</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@tabler/core@1.5.1/dist/css/tabler.min.css" />
</head>
<body>
  <div class="page">
    <!-- Vertical navbar (sidebar) -->
    <aside class="navbar navbar-vertical navbar-expand-lg" data-bs-theme="dark">
      <div class="container-fluid">
        <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#sidebar-menu"
                aria-controls="sidebar-menu" aria-expanded="false" aria-label="Toggle navigation">
          <span class="navbar-toggler-icon"></span>
        </button>
        <h1 class="navbar-brand navbar-brand-autodark">
          <a href=".">My App</a>
        </h1>
        <div class="collapse navbar-collapse" id="sidebar-menu">
          <ul class="navbar-nav pt-lg-3">
            <li class="nav-item active">
              <a class="nav-link" href="#" aria-current="page">
                <span class="nav-link-title">Home</span>
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="#">
                <span class="nav-link-title">Projects</span>
              </a>
            </li>
            <li class="nav-item">
              <a class="nav-link" href="#">
                <span class="nav-link-title">Settings</span>
              </a>
            </li>
          </ul>
        </div>
      </div>
    </aside>

    <div class="page-wrapper">
      <!-- Page header -->
      <div class="page-header d-print-none">
        <div class="container-xl">
          <div class="row g-2 align-items-center">
            <div class="col">
              <div class="page-pretitle">Overview</div>
              <h2 class="page-title">Dashboard</h2>
            </div>
            <div class="col-auto ms-auto d-print-none">
              <a href="#" class="btn btn-primary">New item</a>
            </div>
          </div>
        </div>
      </div>

      <!-- Page body -->
      <main class="page-body">
        <div class="container-xl">
          <div class="row row-deck row-cards">
            <div class="col-sm-6 col-lg-3">
              <div class="card"><div class="card-body" style="height: 10rem"></div></div>
            </div>
            <div class="col-sm-6 col-lg-3">
              <div class="card"><div class="card-body" style="height: 10rem"></div></div>
            </div>
          </div>
        </div>
      </main>

      <!-- Footer -->
      <footer class="footer footer-transparent d-print-none">
        <div class="container-xl">
          <div class="row text-center align-items-center flex-row-reverse">
            <div class="col-lg-auto ms-lg-auto">
              <ul class="list-inline list-inline-dots mb-0">
                <li class="list-inline-item"><a href="#" class="link-secondary">Documentation</a></li>
              </ul>
            </div>
            <div class="col-12 col-lg-auto mt-3 mt-lg-0">
              <ul class="list-inline list-inline-dots mb-0">
                <li class="list-inline-item">Copyright &copy; 2026 <a href="#" class="link-secondary">My Company</a>. All rights reserved.</li>
              </ul>
            </div>
          </div>
        </div>
      </footer>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@tabler/core@1.5.1/dist/js/tabler.min.js"></script>
</body>
</html>
```

Notes:
- `navbar-vertical` turns a navbar into the fixed left sidebar; `navbar-expand-lg` sets the breakpoint above which it's always visible (below it, collapses behind the toggler).
- The `.navbar-toggler` + `.collapse.navbar-collapse` pairing is Bootstrap's collapse plugin — **requires `tabler.min.js`** on mobile; without JS the menu stays hidden below the breakpoint (degraded, not broken).
- `data-bs-theme="dark"` directly on an element scopes dark mode to that subtree only — common on a sidebar to darken just the nav while the page stays light.
- Section labels in a sidebar menu: `<li class="nav-section-title">Overview</li>` before a group of `<li class="nav-item">` (vertical navbars only).
- Trailing/bottom group: `<div class="navbar-side"><ul class="navbar-nav">...</ul></div>` after the main menu `<ul>`, inside the same `.navbar-collapse`.
- Fixed footer/user-block: `<div class="navbar-footer">` as a third child of `.container-fluid`, after the brand and collapse nav.

### Layout C — Combined (both navbars, switchable via attribute)

Render **both** navigations as direct children of `.page` (vertical `<aside>` first, then horizontal `<header>`); `data-bs-navbar-position="vertical"|"horizontal"` on `<html>` shows one and hides the other via CSS. Only works with **both** navbars present — a single-navbar page always keeps it regardless of the attribute (safety mechanism, confirmed in `page-layouts.mdx`).

```html
<div class="page">
  <aside class="navbar navbar-vertical navbar-expand-lg">...</aside>
  <header class="navbar navbar-expand-md">...</header>
  <div class="page-wrapper">...</div>
</div>
```

### Layout D — Condensed navbar

A single-row horizontal navbar (brand + menu links inline, no second `.collapse.navbar-collapse` row) — Tabler's demo calls this "condensed" (`navbarCondensed` prop in `DefaultLayout.astro`) but **[UNVERIFIED: no dedicated `.navbar-condensed` class found in `tabler.min.css`]** — treat it as a markup arrangement, not a class to add.

### Container width / boxed layout (attribute-driven)

```html
<html data-bs-layout="fluid">   <!-- all containers full-width -->
<html data-bs-layout="boxed">   <!-- whole page centered in a frame -->
<!-- static (no-JS) equivalent: -->
<body class="layout-fluid">
<body class="layout-boxed">
```

### Folded (icon-only) sidebar

Add `navbar-folded` (static) or `navbar-folded-hover` (unfolds on hover/focus) to the vertical `<aside class="navbar navbar-vertical ...">`. Works only above the navbar's `navbar-expand-*` breakpoint. Runtime toggle: `data-bs-sidebar="folded"|"folded-hover"|"default"` on `<html>` (see §5).

---

## 4. Component catalog

Format: `class | modifiers/variants | note`. All rows grep-confirmed in `tabler.min.css` and/or copied from official `.mdx` frontmatter (`classnames:` block, which is Tabler's own machine-readable class registry).

### Cards

| Class | Variants | Note |
|---|---|---|
| `card` | — | Container |
| `card-header` | — | Title bar |
| `card-title` | — | Heading, in header or body |
| `card-subtitle` | — | Small label above title |
| `card-body` | `card-body-scrollable` | Content area |
| `card-footer` | — | Bottom row |
| `card-meta` | — | Muted secondary line |
| `card-actions` | — | Trailing controls in header |
| `card-btn` | — | Full-width action along bottom edge |
| `card-img-top` | `card-img-end` | Image above body |
| `card-img-overlay` | `card-img-overlay-dark` | Content over an image |
| `card-cover` | `card-cover-blurred` | Header with bg photo |
| `card-stamp` | `card-stamp-icon`, `card-stamp-lg` | Decorative corner mark |
| `card-status-top` | `-bottom`, `-start` | Colored edge bar (combine with `bg-{color}`) |
| `card-progress` | — | Progress bar on card edge |
| `card-tabs` / `card-header-tabs` | `card-header-pills` | Tabbed card header |
| `card-table` | — | Flush table inside card |
| `card-code` | — | Code block body, no padding |
| `card-list-group` | — | Flush list-group inside card |
| `card-borderless` / `card-transparent` / `card-dashed` | — | Style variants |
| `card-stacked` | — | Draws a second card behind |
| `card-rotate-start` | `-end`,`-left`,`-right` | Tilt effect |
| `card-active` / `card-inactive` | — | Selected / dimmed state |
| `card-link` | `card-link-pop`, `card-link-rotate` | Whole card is a link + hover fx |
| `card-sm` / `card-md` / `card-lg` | — | Padding sizes |

### Tables

| Class | Variants | Note |
|---|---|---|
| `table` | — | Base (Bootstrap) |
| `table-striped` / `table-bordered` / `table-borderless` / `table-transparent` | — | Style |
| `table-responsive` | `table-responsive-{bp}` | Horizontal scroll |
| `table-mobile-{bp}` | — | Stacks rows into blocks below breakpoint, uses `data-label` per `<td>` |
| `table-vcenter` / `table-center` / `table-nowrap` | — | Alignment |
| `table-hover` | — | Row highlight on hover (pure CSS) |
| `table-selectable` | — | Checkbox rows, highlighted when checked |
| `table-sort` | — | Sortable header cell (visual only — sorting logic is your JS) |
| `table-{color}` | — | Tints a row/cell |
| `table-sm` | — | Tight padding |
| `td-truncate` | — | Ellipsis-truncated cell |
| `card-table` | — | Use inside `.card .card-body` for a flush table |

### Datagrid (label/value grid — not a data table)

```html
<div class="datagrid">
  <div class="datagrid-item">
    <div class="datagrid-title">Registrar</div>
    <div class="datagrid-content">Third Party</div>
  </div>
</div>
```
`datagrid` (CSS grid, `auto-fit`, no breakpoints needed) / `datagrid-item` (pair wrapper) / `datagrid-title` (label) / `datagrid-content` (value — text, avatar, status, form control). Tune via `--tblr-datagrid-item-width` (`15rem`) and `--tblr-datagrid-padding` (`1.5rem`). Accessible variant: `dl.datagrid` > `div.datagrid-item` > `dt.datagrid-title` + `dd.datagrid-content`.

### Forms

| Class | Variants | Note |
|---|---|---|
| `form-label` | `required` (adds asterisk via CSS) | Label |
| `form-control` | `form-control-rounded`, `form-control-flush`, `form-control-sm/lg` | Text input/textarea |
| `form-select` | — | `<select>` |
| `form-check` | `form-switch` | Checkbox/radio wrapper — pattern is `<label class="form-check"><input class="form-check-input">...<span class="form-check-label">...` |
| `form-fieldset` | — | Put on `<fieldset>`; pair with `<legend class="form-label">` as first child |
| `form-footer` | — | Actions row at bottom of a form |
| `input-icon` / `input-icon-addon` | — | Icon inside an input (wrap input + icon span) |
| `input-group` | — | Bootstrap input group (prefix/suffix addons) |
| `row g-2` / `col-*` | — | Standard Bootstrap grid for multi-column form layout |

### Buttons

| Class | Variants | Note |
|---|---|---|
| `btn` | `btn-primary`, `btn-outline-*`, `btn-ghost-*`, `btn-{color}` | Base Bootstrap+Tabler button |
| `btn-list` | — | Wraps multiple buttons with consistent gap/wrap |
| `btn-icon` | — | Square icon-only button |
| `btn-sm` / `btn-lg` | — | Size |
| `btn-action` | — | Small icon button used in toolbars/navbar |
| `btn-loading` **[UNVERIFIED exact name — check `button.mdx`]** | — | Loading-state spinner |

### Badges / chips

| Class | Variants | Note |
|---|---|---|
| `badge` | `bg-{color}` | Base |
| `badge-outline` | — | Transparent fill, colored border |
| `badge-pill` | — | Fully round ends |
| `badge-dot` | — | Dot only, no text (status marker) |
| `badge-icononly` | — | Square, icon only |
| `badge-notification` | — | Positions over parent's corner (e.g. on an avatar or icon) |
| `badge-list` | — | Row of spaced badges |
| `badge-blink` | — | Pulsing animation |
| `badge-sm` / `badge-lg` | — | Size |

### Avatars

| Class | Variants | Note |
|---|---|---|
| `avatar` | `bg-{color}` for initials bg | Base, set `style="background-image:url(...)"` for photo, or put initials/icon as text content |
| `avatar-square` / `avatar-rounded` (default) | — | Shape |
| `avatar-upload` | `avatar-upload-text` | Empty dashed upload slot |
| `avatar-cover` | — | Overlaps element above, with ring |
| `avatar-brand` | — | Small brand mark in corner |
| `avatar-xxs` … `avatar-2xl` | — | Sizes |
| `avatar-list` | `avatar-list-stacked`, `avatar-list-{size}` | Row of avatars; stacked = overlapped |

### Status indicators

| Class | Variants | Note |
|---|---|---|
| `status` | `status-{color}` (any palette color + brand colors like `status-github`) | Label with marker, e.g. `<span class="status status-green">Active</span>` |
| `status-dot` | `status-dot-animated` | Small dot, nest inside `.status` |
| `status-indicator` | `status-indicator-circle`, `status-indicator-animated` | Larger standalone marker |
| `status-lite` | — | Transparent bg style |

### Steps

```html
<div class="steps">
  <a href="#" class="step-item">Step 1</a>
  <a href="#" class="step-item active">Step 2</a>
  <span class="step-item">Step 3</span>
</div>
```
`steps` (container) / `step-item` (mark current with class `active` AND `aria-current="step"`) / `steps-counter` (numbers instead of titles) / `steps-vertical` (stack) / `steps-{color}` and `steps-{color}-lt` (completed-step color). Tooltips on steps need `data-bs-toggle="tooltip"` (**JS required** for tooltip popup; the step markup itself is pure CSS).

### Timeline

```html
<ul class="timeline">
  <li class="timeline-event">
    <div class="timeline-event-icon"><!-- icon --></div>
    <div class="card timeline-event-card">
      <div class="card-body">...</div>
    </div>
  </li>
</ul>
```
`timeline` (ul) / `timeline-event` (li, draws connecting line) / `timeline-event-icon` (marker) / `timeline-event-card` (on a `.card` for the content box) / `timeline-simple` (drops cards+line, plain list).

### Empty states

```html
<div class="empty">
  <div class="empty-icon"><!-- svg icon --></div>
  <p class="empty-title">No results found</p>
  <p class="empty-subtitle text-secondary">Try adjusting your search or filter.</p>
  <div class="empty-action">
    <a href="#" class="btn btn-primary">Search again</a>
  </div>
</div>
```
`empty` (container) / `empty-header` (big muted text, e.g. "404", instead of icon) / `empty-img` (illustration slot, alt to icon) / `empty-icon` / `empty-title` / `empty-subtitle` / `empty-action` / `empty-bordered` (dashed border around whole block).

### Ribbons

```html
<div class="card">
  <div class="card-body">...</div>
  <div class="ribbon ribbon-top ribbon-start bg-red"><!-- icon --></div>
</div>
```
`ribbon` (position over parent — parent needs `position: relative`, which `.card` already has) / `ribbon-bookmark` (notched shape) / `ribbon-top` / `ribbon-bottom` / `ribbon-start` / `ribbon-end` (position) / color via `bg-{color}` utility, not a `ribbon-*` color class.

### Alerts

| Class | Variants | Note |
|---|---|---|
| `alert` | `alert-{color}` | Base |
| `alert-heading` | — | Title line |
| `alert-description` | — | Secondary text |
| `alert-icon` | — | Icon slot |
| `alert-link` | — | Inline link matched to alert color |
| `alert-action` | — | Underlined "next step" link |
| `alert-list` | — | List with default margin removed |
| `alert-important` | — | Solid fill, white text |
| `alert-minor` | — | No tint, plain border only |
| `alert-dismissible` | — | Reserves room for close button — **needs `.btn-close` + `data-bs-dismiss="alert"` and JS to actually dismiss** |

### Modals — **requires JS**

`modal` (root, hidden by default — needs `tabler.min.js`/Bootstrap Modal to show) / `modal-dialog` (`modal-dialog-centered`, `modal-dialog-scrollable`, `modal-sm/lg/xl`, `modal-fullscreen`, `modal-full-width`) / `modal-content` / `modal-header` / `modal-title` / `modal-body` / `modal-footer` / `modal-status` (colored top bar via `bg-{color}`) / `modal-blur` (blurs page behind). Trigger: `data-bs-toggle="modal" data-bs-target="#id"`.

### Dropdowns — **requires JS**

`dropdown` (wrapper) / `dropdown-toggle` (trigger, `data-bs-toggle="dropdown"`) / `dropdown-menu` (`dropdown-menu-end`, `dropdown-menu-arrow`, `dropdown-menu-dark`, `dropdown-menu-columns`, `dropdown-menu-card`, `dropdown-menu-scrollable`) / `dropdown-item` (`dropdown-item-icon`, `dropdown-item-indicator`, `dropdown-item-text`) / `dropdown-header` / `dropdown-divider` / `dropdown-toggle-split` / `dropend` (submenu to the side). Without JS the menu never opens (it's `display:none` until Bootstrap toggles a class) — see §8.

### Navs / Tabs

`nav-tabs` (apply with `.nav`) / `nav-link` (needs `role="tab"` + `aria-controls` for real tabs) / `tab-content` / `tab-pane` (needs `role="tabpanel"`) / `nav-underline` / `nav-bordered` / `nav-fill` / `nav-pills` (Bootstrap base class, confirmed present). **Tab switching needs JS** (`data-bs-toggle="tab"`); the visual styling of the nav itself is pure CSS.

### Progress

`progress` (track) / `progress-bar` (fill — set `style="width:X%"` and ARIA `aria-valuenow` yourself) / `progress-bar-striped` / `progress-bar-animated` (CSS animation, no JS) / `progress-bar-indeterminate` / `progress-stacked` / `progress-separated` / `progress-sm/lg/xl`.

### Offcanvas — **requires JS**

`offcanvas` (hidden until toggled) / `offcanvas-header` / `offcanvas-title` / `offcanvas-body` / `offcanvas-footer` / `offcanvas-narrow` / `offcanvas-start/end/top/bottom` (slide direction) / `offcanvas-{bp}` (responsive: normal content above breakpoint). Trigger: `data-bs-toggle="offcanvas" data-bs-target="#id"`.

### Toasts — **requires JS to auto-show/hide**

`toast` (root) / `toast-container` (positions toasts, e.g. `position-fixed bottom-0 end-0 p-3`) / `toast-header` / `toast-body` / `toast-{color}`. Bootstrap's `Toast` JS component controls show/hide/autohide; a toast with no JS just sits static with `display` per its classes (usually you'd need `.show` class present to render it visible without JS).

---

## 5. Theming

### Confirmed attributes

`tabler.min.css` ships selectors only for the **color-mode/navbar** attributes (grep-confirmed): `[data-bs-theme=light]`, `[data-bs-theme=dark]`, `[data-theme=light]`/`[data-theme=dark]` (legacy scoped form, still present), `html[data-bs-navbar-position=vertical]`, `html[data-bs-navbar-theme=dark]`, `html[data-bs-navbar-theme=primary]`.

`data-bs-theme-primary`, `data-bs-theme-base`, `data-bs-theme-font`, `data-bs-theme-radius` selectors were **not** found in `tabler.min.css` — implemented via `tabler-theme.js` writing CSS custom properties / swapping in `tabler-themes.min.css` / `tabler-props.min.css`, not core-stylesheet attribute selectors. For runtime primary-color/base/font/radius switching, also load `tabler-themes.min.css` (or `tabler-props.min.css`).

Full attribute table (from `core/js/src/theme-config.ts`, the canonical switcher source):

| Setting | Attribute | Default | Allowed values |
|---|---|---|---|
| Color mode | `data-bs-theme` | `auto` | `light`, `dark`, `auto` |
| Base gray shade | `data-bs-theme-base` | `gray`(1) | `slate`, `gray`, `zinc`, `neutral`, `stone`, `pink` (`pink` confirmed in `tabler-themes.min.css`) |
| Font family | `data-bs-theme-font` | `sans-serif` | `sans-serif`, `serif`, `monospace`, `comic` |
| Primary color | `data-bs-theme-primary` | `blue` | `blue`, `azure`, `indigo`, `purple`, `pink`, `red`, `orange`, `yellow`, `lime`, `green`, `teal`, `cyan`, `inverted` |
| Corner radius | `data-bs-theme-radius` | `1` | `0`, `0.5`, `1`, `1.5`, `2` |
| Navigation position | `data-bs-navbar-position` | `horizontal` | `horizontal`, `vertical` |
| Container width | `data-bs-layout` | `default` | `default`, `fluid`, `boxed` |
| Navbar behavior | `data-bs-navbar` | `default` | `default`, `sticky` |
| Navigation theme | `data-bs-navbar-theme` | `default` | `default`, `dark`, `primary` |
| Sidebar | `data-bs-sidebar` | `default` | `default`, `folded`, `folded-hover` |

(1) **[NOTE: minor discrepancy]** — `themeDefaults['theme-base']` in the fetched JS source literally reads `'neutral'`, while the `color-modes.mdx` docs table lists `gray` as the default. Set `data-bs-theme-base` explicitly if the default matters.

Legacy/scoped selector `[data-theme=light]`/`[data-theme=dark]` (no `bs-` prefix) also exists in the compiled CSS — scopes a light/dark subtree on an element other than `<html>` (e.g. `<span data-theme="light">` inside a dark card).

### Switch theme with zero JavaScript

Set the attribute on `<html>` at render time — no script needed:

```html
<html lang="en" data-bs-theme="dark">
<html lang="en" data-bs-theme="dark" data-bs-navbar-position="vertical" data-bs-layout="boxed">
```

Static class equivalents exist for layout-only settings: `<body class="layout-fluid">`, `<body class="layout-boxed">`. No static-class equivalent is documented for color mode — use the attribute.

### What `tabler-theme.min.js` adds

Load it as the **first thing in `<body>`**, un-deferred, to avoid FOUC:
```html
<body>
  <script src="https://cdn.jsdelivr.net/npm/@tabler/core@1.5.1/dist/js/tabler-theme.min.js"></script>
  ...
</body>
```
It reads each `themeDefaults` key (URL query param → `localStorage` → server-rendered `<html>` attribute, in priority order), writes it as `data-bs-<key>` on `<html>` before first paint, persists URL-param overrides to `localStorage['tabler-<key>']`, and resolves `theme=auto` via `prefers-color-scheme` live.

**Verified by reading the v1.5.1 minified source** (while building `mockup/explore-3`): the whole script is 1.3 KB and the exact key list is `theme` (`auto`), `theme-base` (`gray`), `theme-font` (`sans-serif`), `theme-primary` (`blue`), `theme-radius` (`1`), `layout` (`default`), `navbar` (`default`), `navbar-position` (`horizontal`), `navbar-theme` (`default`), `sidebar` (`default`). Three behaviours worth knowing:

- **A value equal to the default REMOVES the attribute** rather than writing it (`m!==defaults[k] ? setAttribute : removeAttribute`). So `?theme-radius=1` yields no `data-bs-theme-radius` at all — correct, but surprising if you are asserting on the DOM.
- **`localStorage` outranks the server-rendered attribute.** A value stored from an earlier click wins over what you hardcode on `<html>`, which is what makes a setting follow the user across pages.
- No `tabler:sidebar-folded` event is dispatched by this script in 1.5.1 — the only listener it adds is for `prefers-color-scheme` changes. **[Corrected: an earlier draft of this file claimed such an event.]**

A link-driven switcher therefore needs no custom JS at all — `<a href="?theme=dark">`, `<a href="?layout=boxed">` and so on are enough (see `mockup/explore-3/settings.html` for a worked panel covering all ten keys).

A pure-link dark-mode toggle needs no custom JS: `<a href="?theme=dark">Dark mode</a>` works because the theme script reads query params. For a mockup that never switches, prefer server-rendered `data-bs-theme` on `<html>` and skip the script entirely; to make switching work (as `mockup/explore-3` does), load the stock script and keep the switcher link-based.

---

## 6. CSS variable (`--tblr-*`) families

1064 unique `--tblr-*` custom properties exist in the compiled CSS. Key families (defaults from `:root,[data-bs-theme=light]`):

- **Colors** — every palette color has: `--tblr-{color}`, `-rgb`, `-lt` (light tint via `color-mix`), `-lt-rgb`, `-fg` (text-on-color), `-darken`, `-200`. Palette: `blue azure indigo purple pink red orange yellow lime green teal cyan` + neutrals `black white gray` + brand colors (`github twitter facebook google instagram youtube linkedin ...`). Also `-bg-subtle`/`-border-subtle`/`-text-emphasis` using `light-dark()` for automatic light/dark swap.
- **Surface/background**: `--tblr-bg-surface(-dark|-inverted|-primary|-secondary|-tertiary)`, `--tblr-bg-forms(-disabled)`, `--tblr-body-bg`, `--tblr-body-color`.
- **Border radius**: `--tblr-border-radius` (`6px`), `-sm`(`4px`) `-md`(`6px`) `-lg`(`8px`) `-xl`(`1rem`) `-xxl`(`2rem`) `-pill`(`100rem`) `-xs`(`2px`) — each `calc({base} * var(--tblr-border-radius-scale, 1))`, so `--tblr-border-radius-scale` (what `data-bs-theme-radius` drives) rescales all of them at once.
- **Font**: `--tblr-font-{sans-serif,serif,monospace,comic}` (the 4 families `data-bs-theme-font` switches), plus `--tblr-font-weight-{light,normal,medium,semibold,bold}` and `-headings` (aliases `-semibold`).
- **Component-scoped tokens**: nearly every component has its own namespace — `--tblr-card-*`, `--tblr-btn-*`, `--tblr-badge-*`, `--tblr-alert-*`, `--tblr-avatar-*`, `--tblr-modal-*`, `--tblr-accordion-*`, `--tblr-datagrid-item-width`/`-padding` (§4), `--tblr-sidebar-width`, `--tblr-sidebar-folded-width`, `--tblr-navbar-*`. Prefer overriding a component's own var over the global one.

---

## 7. Utilities

Tabler inherits the full Bootstrap 5 utility/grid system unmodified: `.row`, `.col-{1-12}`, `.col-{sm,md,lg,xl,xxl}-{1-12}`, `.d-flex`, `.d-none`, `.d-{bp}-block`, `.gap-*`, `.g-*`, `.p-*`/`.m-*`, `.text-{color}`, `.bg-{color}`, `.fw-*`, `.fs-*`, `.rounded*`, `.shadow*`, `.border*`, `.align-items-*`, `.justify-content-*`, `.position-*`, `.w-*`/`.h-*`, `.visually-hidden(-focusable)`.

Tabler-specific additions confirmed in CSS/docs:
- `.row-deck` + `.row-cards` — equal-height cards in a row with card-appropriate gutter (combine on the `.row` wrapping `.col-*` > `.card`).
- `.text-secondary` — Tabler's muted-text token (subtitles/descriptions everywhere).
- `.page-pretitle` — small caps label above a page title. `.link-secondary` — muted link color.
- `.list-inline-dots` — adds a `·` separator between `.list-inline-item`s.
- `.card-stamp`, `.avatar-list`, `.status-dot`, `.datagrid` — see §4. `.icon-*` size/animation — see §2.
- `.font-sans-serif`/`-serif`/`-monospace`/`-comic` — per-element font override mirroring `data-bs-theme-font`'s 4 values.
- `.hide-theme-dark`/`.hide-theme-light` — hides an element in the given resolved color mode.
- `.skip-link` (+ `.visually-hidden-focusable`) — accessible skip-to-content link: `<a href="#content" class="visually-hidden-focusable skip-link">Skip to main content</a>`.

---

## 8. JS dependency map

This repo builds **static, no-JS HTML mockups** — treat this table as the authoritative "what silently breaks" list.

| Needs `tabler.min.js` (Bootstrap components) | Degrades to (no JS) |
|---|---|
| Dropdowns (`data-bs-toggle="dropdown"`) | Menu never opens (`display:none` forever) |
| Modals (`data-bs-toggle="modal"`) | Dialog never shows |
| Tabs (`data-bs-toggle="tab"`) | Only the pane with `.active`/`.show` on load is visible; pick one active tab in markup, don't rely on switching |
| Tooltips / Popovers | `title`/`data-bs-content` sit inertly, nothing renders |
| Offcanvas (`data-bs-toggle="offcanvas"`) | Panel never slides in |
| Toasts | Never auto-appears/hides; hardcode `.show` to display at all |
| Alert dismiss (`.btn-close[data-bs-dismiss="alert"]`) | Close button renders but does nothing |
| Collapse (mobile navbar toggler) | Nav stays collapsed below breakpoint (or stays open if you hardcode `.show`) |
| Carousel | First slide only, no auto-advance/controls |
| `tabler-theme.min.js` | Loses runtime switching/persistence/URL params — **not required** if you hardcode `data-bs-*` on `<html>` (see §5) |

**Pure CSS, no JS required**: page/navbar/sidebar structure (once "open" state is hardcoded), cards, tables (styling only), badges, avatars, status dots, steps (visual; step tooltips need JS), timeline, empty states, ribbons, alerts (visual), progress bars (striped/animated are CSS `@keyframes`), datagrid, all grid/utility classes, dark/light mode via server-rendered `data-bs-theme`.

**Practical rule for this repo**: for any interactive-looking component, render the "open"/"active" state directly in the markup (`.show`, `.active`, `aria-expanded="true"`) rather than relying on a click — the mockup should look right without interaction.

---

## 9. Gotchas

1. **`data-bs-theme-primary/base/font/radius` need `tabler-themes.min.css` or `tabler-props.min.css` too** — absent from `tabler.min.css` alone. With just core CSS, only `data-bs-theme`, `data-bs-navbar-position`, `data-bs-navbar-theme`, `data-bs-navbar`, `data-bs-layout` do anything.
2. **`data-bs-navbar-position` requires both navbars in the DOM** as direct children of `.page` — with only one navbar present, it's a no-op by design.
3. **Dropdown/modal/offcanvas markup is inert without JS** — see §8. Don't assume `.dropdown-menu` shows on hover/click in a static export.
4. **`.card-table` flush tables**: put `card-table` class on the `<table>` directly inside `.card-body`, not as a sibling.
5. **`avatar` photos use inline `style="background-image:url(...)"`**, not `<img>`/`src` — confirmed in every official example.
6. **Datagrid vs Table**: `.datagrid` is label/value pairs (detail panels), not tabular data — use `.table` for rows/columns.
7. **Ribbon color is a `bg-{color}` utility, not a `ribbon-{color}` class** — no such class family exists.
8. **Steps active state needs both**: the `active` class (visual) AND `aria-current="step"` (semantic).
9. **`navbar-expand-{bp}` breakpoint matters** — the point above which the menu is always uncollapsed. Sidebars commonly use `-lg`; horizontal top navs `-md`/`-sm`. Keep the toggler's `data-bs-target` consistent with it.
   **In a no-JS page this is a trap** (hit while building `mockup/explore-3`): below the breakpoint the menu needs Bootstrap's collapse plugin to open, so a collapsed menu can never be opened, while hard-coding `.collapse.show` makes the nav expand into a tall stacked block that pushes the whole page down — it reads as "the menu bar is covering the body". Fixes that need no JS: use `navbar-expand` (no suffix) for a top nav so it never collapses, and drop the sidebar to `navbar-expand-sm` so it stays a real sidebar from 576px up. Do **not** give a vertical sidebar plain `navbar-expand` — the `data-bs-sidebar=folded`/`folded-hover` rules only target `.navbar-vertical.navbar-expand-{sm,md,lg,xl,xxl}`, so the folded setting would silently stop working.
10. **RTL needs a different CSS file** (`tabler.rtl.min.css`) — not driven by `dir="rtl"` on the default stylesheet.
11. **Icons are copy-pasted inline SVG per instance** — no `<i class="ti ti-heart">` webfont shorthand in `@tabler/core` 1.5.1. Don't invent `ti-*` classes.
12. **`font-weight-medium` does not exist in 1.5.1** — Tabler's older utility name is gone from the compiled CSS; use Bootstrap's `fw-medium`. (Verified by grepping `tabler.min.css` while building `mockup/explore-3`.)
13. **`.datagrid-item` / `.datagrid-content` have no CSS rules** — only `.datagrid` (the grid) and `.datagrid-title` are styled. The two are still the documented markup (an item is simply a grid child), so keep them, but don't expect them to do anything on their own.
14. **No separate `bootstrap.bundle.min.js` needed** — `tabler.min.js` already vendors every Bootstrap JS component; loading both risks conflicts.
15. **`theme-base` default has a source discrepancy** (`neutral` in JS source vs `gray` in docs table) — set `data-bs-theme-base` explicitly if it matters.

---

## 10. Copy-paste patterns

### A. Stat card row

```html
<div class="row row-deck row-cards">
  <div class="col-sm-6 col-lg-3">
    <div class="card card-sm">
      <div class="card-body">
        <div class="row align-items-center">
          <div class="col-auto">
            <span class="bg-primary text-white avatar"><!-- icon svg --></span>
          </div>
          <div class="col">
            <div class="fw-medium">1,204</div>
            <div class="text-secondary">New members</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="col-sm-6 col-lg-3">
    <div class="card card-sm">
      <div class="card-body">
        <div class="row align-items-center">
          <div class="col-auto">
            <span class="bg-green text-white avatar"><!-- icon svg --></span>
          </div>
          <div class="col">
            <div class="fw-medium">89%</div>
            <div class="text-secondary">Completion rate</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
```

### B. Data table page (card + table)

```html
<div class="card">
  <div class="card-header">
    <h3 class="card-title">Projects</h3>
    <div class="card-actions">
      <a href="#" class="btn btn-primary">New project</a>
    </div>
  </div>
  <div class="table-responsive">
    <table class="table card-table table-vcenter">
      <thead>
        <tr>
          <th>Name</th>
          <th>Owner</th>
          <th>Status</th>
          <th class="w-1"></th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>Website redesign</td>
          <td>
            <div class="d-flex align-items-center">
              <span class="avatar avatar-xs me-2" style="background-image: url(/static/avatars/001m.jpg)"></span>
              Jane Doe
            </div>
          </td>
          <td><span class="status status-green"><span class="status-dot"></span> Active</span></td>
          <td>
            <a href="#" class="btn btn-icon btn-ghost-secondary" aria-label="Edit"><!-- icon --></a>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
```

### C. Kanban-ish card (board column item)

```html
<div class="card mb-3">
  <div class="card-status-top bg-orange"></div>
  <div class="card-body">
    <div class="d-flex align-items-center mb-2">
      <span class="badge bg-orange-lt me-auto">In progress</span>
      <div class="dropdown">
        <a href="#" class="btn-action" data-bs-toggle="dropdown" aria-label="Open card menu"><!-- kebab icon --></a>
        <div class="dropdown-menu dropdown-menu-end">
          <a class="dropdown-item" href="#">Edit</a>
          <a class="dropdown-item" href="#">Archive</a>
        </div>
      </div>
    </div>
    <h4 class="card-title mb-1">Fix login redirect bug</h4>
    <p class="text-secondary mb-3">Users are redirected to the wrong page after SSO login.</p>
    <div class="d-flex align-items-center">
      <div class="avatar-list avatar-list-stacked me-auto">
        <span class="avatar avatar-xs rounded" style="background-image: url(/static/avatars/004m.jpg)"></span>
        <span class="avatar avatar-xs rounded">+2</span>
      </div>
      <span class="text-secondary"><!-- comment icon --> 3</span>
    </div>
  </div>
</div>
```

### D. Form layout (fieldset + grid)

```html
<form>
  <div class="card">
    <div class="card-body">
      <fieldset class="form-fieldset">
        <legend class="form-label">Project details</legend>
        <div class="row">
          <div class="col-md-8 mb-3">
            <label class="form-label required" for="project-name">Project name</label>
            <input type="text" id="project-name" class="form-control" required />
          </div>
          <div class="col-md-4 mb-3">
            <label class="form-label" for="project-status">Status</label>
            <select id="project-status" class="form-select">
              <option>Planning</option>
              <option>Active</option>
              <option>Done</option>
            </select>
          </div>
        </div>
        <div class="mb-3">
          <label class="form-label">Description</label>
          <textarea class="form-control" rows="3"></textarea>
        </div>
        <label class="form-check">
          <input type="checkbox" class="form-check-input" />
          <span class="form-check-label">Notify team members</span>
        </label>
      </fieldset>
    </div>
    <div class="card-footer text-end">
      <div class="btn-list">
        <a href="#" class="btn">Cancel</a>
        <button type="submit" class="btn btn-primary">Save project</button>
      </div>
    </div>
  </div>
</form>
```

### E. Empty state

```html
<div class="card">
  <div class="card-body">
    <div class="empty">
      <div class="empty-icon"><!-- e.g. "folder" or "mood-sad" icon svg --></div>
      <p class="empty-title">No projects yet</p>
      <p class="empty-subtitle text-secondary">Create your first project to start tracking work.</p>
      <div class="empty-action">
        <a href="#" class="btn btn-primary"><!-- plus icon --> New project</a>
      </div>
    </div>
  </div>
</div>
```

---

## Sources fetched this session (for traceability)

`tabler.min.css` v1.5.1 (local, grepped) · `core/package.json`, `core/scss/_core.scss`, `core/js/src/bootstrap.ts`, `core/js/src/theme-config.ts` · `docs/content/ui/layout/{page-layouts,navbars,page-headers}.mdx` · `docs/content/ui/getting-started/{installation,download,color-modes,llms}.mdx` · `docs/content/ui/components/{datagrid,empty,card,status,step,timeline,ribbon,avatar,badge,table,toast,modal,dropdown,offcanvas,tab,alert,progress,icon}.mdx` · `docs/content/ui/forms/{elements,fieldset}.mdx` · `shared/layouts/DefaultLayout.astro`, `shared/lib/theme-config.ts`, `shared/components/navbar/Navbar.astro` · `docs/lib/cdn-snippets.ts`, `shared/lib/site.ts` · `https://docs.tabler.io/llms.txt` · jsDelivr file listing for `@tabler/core@1.5.1` · npm registry lookup for `@tabler/icons` (v3.47.0). All from github.com/tabler/tabler `master` branch via raw.githubusercontent.com.
