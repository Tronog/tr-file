# Overview
This is a TypeScript NodeJS monorepo pnpm workspace.
It is a full stack application consisting of
* Angular frontend - `prj/frontend`
* Express TypeScript backend - `prj/backend`
* docker compose
  * development - ports directly exposed
  * production - behind nginx proxy
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
holding shared state, feature classes holding the rest, and `MockData*` services holding all data
until the backend serves it.

# Backend
Refer to `docs/ai/EXPRESS.md`. The file-system API lives at `/api/fs`
(listing, details, download, upload) — see `prj/backend/README.md` for the
endpoint reference, the error codes and the `FILES_ROOT` confinement rules. Its
frontend client is `prj/frontend/src/app/file-system/`.

# Docker
Refer to `docs/ai/DOCKER.md`. Two Compose environments live at the workspace root:
`prj/compose.dev.yaml` (ports exposed directly) and `prj/compose.prod.yaml` (behind nginx).
Both build with `context: .` relative to `prj/`.
