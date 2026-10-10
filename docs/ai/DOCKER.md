# Docker / Compose conventions

`prj/` is the pnpm workspace root. Everything Docker-related lives inside it —
the git repo root stays clean (only `.git`, `CLAUDE.md`, `docs/`).

Two environments, one file each at the workspace root (`prj/`). There is no
`compose.yaml` default — always pass `-f` (the `pnpm docker:*` scripts do this
for you).

| File | Purpose |
| --- | --- |
| `prj/compose.dev.yaml` | development — source bind-mounted, ports published directly |
| `prj/compose.prod.yaml` | production — only nginx is published, backend stays internal |

Production requires an account (PRD 003, §2): `pnpm docker:prod` fails at once
unless `AUTH_USERNAME` is set, together with `AUTH_PASSWORD_HASH` (preferred —
`pnpm --filter backend hash-password`) or `AUTH_PASSWORD`, e.g. in `prj/.env`.
Development runs without a login unless both `AUTH_USERNAME` and
`AUTH_PASSWORD` are set. nginx forwards `Host` as `$http_host` (port included),
which the backend's CSRF check relies on.

## Build context

Both Dockerfiles are built **from the workspace root (`prj/`)**, not from their
package directory:

```yaml
build:
  context: .            # resolved relative to prj/, where the compose file lives
  dockerfile: backend/Dockerfile
```

This is required, not stylistic: `prj/*/tsconfig.json` extends
`../tsconfig.base.json`, and `pnpm-lock.yaml` / `pnpm-workspace.yaml` /
`package.json` live at `prj/`. A package-local context cannot see any of them.

## Stage names are a contract

Every Dockerfile exposes exactly two final targets, and the compose files
select between them with `target:`:

- `development` — full workspace install including devDependencies, runs the
  watch-mode dev command.
- `production` — no devDependencies, no source, no TypeScript; runs as a
  non-root user.

Do not rename these without updating both compose files.

## Dependency installation

Images enable pnpm through Corepack (`corepack enable pnpm`), which honours the
root `packageManager` pin. Copy the manifests (`package.json`,
`pnpm-workspace.yaml`, `pnpm-lock.yaml`, and each package's `package.json`)
and run `pnpm install --frozen-lockfile` *before* copying sources, so a source
edit does not invalidate the dependency layer. **Every** workspace member's
manifest must be copied, including `desktop/` and `demo/`, which no image builds,
and both libraries (`libs/ui/`, `libs/file-ui/`) — with one missing,
`--frozen-lockfile` cannot resolve. The frontend build compiles the libraries
from their sources (`paths`), so no image runs ng-packagr; it needs
`tsconfig.base.json` and `tsconfig.angular.json` beside them. The install is then narrowed with
`--filter "<package>..."` so the desktop shell's Electron binary (~230 MB) never
reaches these images.

`pnpm-workspace.yaml` carries an `allowBuilds:` map (esbuild, electron, lmdb,
`@parcel/watcher`, `msgpackr-extract`); keep it in sync with any new native
dependency. Electron is on it for the desktop shell, which runs on the host and
never in a container; the filtered installs above keep its download out of the
images. On the Alpine base the images use, only esbuild (a statically
linked Go binary) and `@parcel/watcher` (ships a `-musl` prebuild) actually
resolve. `lmdb` and `msgpackr-extract` publish no musl prebuild and there is no
compiler in the image, so their install scripts fail — pnpm demotes that to a
warning because both are optional, and the Angular build succeeds without them,
losing only lmdb's persistent cache. A noisy install log here is expected, not
a fault.

## Bind mounts hide node_modules

In `compose.dev.yaml` the workspace root (`prj/`) is bind-mounted at `/app`,
which would otherwise mask the dependencies installed into the image. Named
volumes are layered over `/app/node_modules`, `/app/backend/node_modules`,
`/app/frontend/node_modules`, `/app/libs/ui/node_modules`,
`/app/libs/file-ui/node_modules` and `/app/frontend/.angular` to preserve them.
Add a matching volume for any new workspace package.

These are **named** volumes, and Docker seeds a volume from the image only
while the volume is still empty. They therefore survive `docker compose down`
and `up --build`, so after changing any `package.json` or `pnpm-lock.yaml` the
containers keep mounting the *old* dependency tree with no warning. Recreate
them explicitly:

```bash
pnpm docker:dev:down && pnpm docker:dev    # down passes -v
```

## Proxy configuration

`prj/frontend/proxy.conf.json` targets `http://localhost:4311` and is for
running on the host. The dev container uses
`prj/frontend/proxy.conf.docker.json`, which targets `http://backend:4311` —
the Compose service name. Keep the two in sync.

In production there is no Angular dev server: `prj/docker/nginx/default.conf`
serves the static bundle with an SPA `try_files` fallback and reverse-proxies
`/api/` to `backend:4311`.
