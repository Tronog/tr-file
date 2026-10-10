# syntax=docker/dockerfile:1

# Build context is the pnpm workspace root (prj/), not this directory:
#   build: { context: ., dockerfile: backend/Dockerfile }
# The workspace manifests and tsconfig.base.json are only visible that way.

# ---------------------------------------------------------------------------
# base — common runtime with pnpm enabled through Corepack
# ---------------------------------------------------------------------------
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HOST=0.0.0.0 \
    PORT=4311
RUN corepack enable pnpm
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — full workspace install including devDependencies.
# Manifests only, so editing sources does not invalidate this layer.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
# Every workspace member's manifest must be present for --frozen-lockfile to
# resolve, even the ones this image never builds.
COPY desktop/package.json desktop/package.json
COPY libs/ui/package.json libs/ui/package.json
COPY libs/file-ui/package.json libs/file-ui/package.json
COPY demo/package.json demo/package.json
# Filtered, so the desktop shell's Electron binary (~230 MB) stays out of here.
RUN pnpm install --frozen-lockfile --filter "@tr-file/backend..."

# ---------------------------------------------------------------------------
# prod-deps — production dependency tree for the backend only
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
COPY desktop/package.json desktop/package.json
COPY libs/ui/package.json libs/ui/package.json
COPY libs/file-ui/package.json libs/file-ui/package.json
COPY demo/package.json demo/package.json
RUN pnpm install --frozen-lockfile --prod --filter "@tr-file/backend..."

# ---------------------------------------------------------------------------
# build — compile TypeScript to dist/
# ---------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./tsconfig.base.json
COPY backend/ backend/
RUN pnpm --filter "@tr-file/backend" build

# ---------------------------------------------------------------------------
# development — watch mode; sources are bind-mounted over /app by compose.dev
# ---------------------------------------------------------------------------
FROM deps AS development
ENV NODE_ENV=development
COPY tsconfig.base.json ./tsconfig.base.json
COPY backend/ backend/
WORKDIR /app/backend
EXPOSE 4311
CMD ["pnpm", "dev"]

# ---------------------------------------------------------------------------
# production — no devDependencies, no sources, no TypeScript, non-root
# ---------------------------------------------------------------------------
FROM base AS production
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /app/package.json ./package.json
COPY --from=prod-deps --chown=node:node /app/backend/node_modules ./backend/node_modules
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist

# FILES_ROOT is a named volume in compose. Creating it in the image owned by the
# runtime user makes Docker initialise that volume with the same ownership,
# which is what lets uploads (PRD 001 §7) write as a non-root process.
RUN mkdir -p /data && chown node:node /data

USER node
WORKDIR /app/backend
EXPOSE 4311
CMD ["node", "dist/main.js"]
