# syntax=docker/dockerfile:1
#
# Build context is the pnpm workspace root (prj/), NOT frontend/.
#   build:
#     context: .
#     dockerfile: frontend/Dockerfile
#     target: development | production
#
# Two final stages are a contract with compose.dev.yaml / compose.prod.yaml:
#   development -> Angular dev server (ng serve) with the docker proxy config
#   production  -> static bundle served by nginx

# ---------------------------------------------------------------------------
# deps: full workspace install (incl. devDependencies), cached on manifests only
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
RUN corepack enable pnpm
WORKDIR /app

# Manifests first so a source edit does not invalidate the dependency layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
# Every workspace member's manifest must be present for `--frozen-lockfile` to
# resolve, even the ones this image never builds.
COPY desktop/package.json ./desktop/
COPY libs/ui/package.json ./libs/ui/
COPY libs/file-ui/package.json ./libs/file-ui/

# lmdb / msgpackr-extract have no musl prebuild and there is no compiler in the
# image; pnpm demotes those optional install scripts to warnings. Expected.
# Filtered, so the desktop shell's Electron binary (~230 MB) stays out of here.
RUN pnpm install --frozen-lockfile --filter "frontend..."

# ---------------------------------------------------------------------------
# development: dev server, sources bind-mounted over /app by compose
# ---------------------------------------------------------------------------
FROM deps AS development
WORKDIR /app
COPY tsconfig.base.json tsconfig.angular.json ./
COPY libs ./libs
COPY frontend ./frontend
WORKDIR /app/frontend
EXPOSE 4200
CMD ["pnpm", "exec", "ng", "serve", "--host", "0.0.0.0", "--port", "4200", "--proxy-config", "proxy.conf.docker.json"]

# ---------------------------------------------------------------------------
# build: produce the static browser bundle
# ---------------------------------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json tsconfig.angular.json ./
# The libraries (@tr-file/ui, …) are compiled from source by this build.
COPY libs ./libs
COPY frontend ./frontend
RUN pnpm --filter frontend build
# output: /app/frontend/dist/frontend/browser

# ---------------------------------------------------------------------------
# production: nginx serving the static bundle
# ---------------------------------------------------------------------------
FROM nginx:alpine AS production
COPY --from=build /app/frontend/dist/frontend/browser /usr/share/nginx/html

# Self-contained fallback config: plain SPA serving with a try_files fallback.
# compose.prod.yaml is expected to mount/copy prj/docker/nginx/default.conf
# over this (it adds the /api/ reverse proxy to backend:4310).
RUN printf '%s\n' \
  'server {' \
  '  listen 80;' \
  '  server_name _;' \
  '  root /usr/share/nginx/html;' \
  '  index index.html;' \
  '  location / {' \
  '    try_files $uri $uri/ /index.html;' \
  '  }' \
  '}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
