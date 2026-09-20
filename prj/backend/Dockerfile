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
    PORT=3000
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
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# prod-deps — production dependency tree for the backend only
# ---------------------------------------------------------------------------
FROM base AS prod-deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
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
EXPOSE 3000
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
USER node
WORKDIR /app/backend
EXPOSE 3000
CMD ["node", "dist/main.js"]
