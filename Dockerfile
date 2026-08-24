# Single container, single process — matches the project's "no service to
# stand up besides the app itself" stance (see CLAUDE.md > Tech stack).
# SQLite lives on a mounted volume at /app/data; no Postgres/Redis sidecar.
#
# Bun workspace layout note (verified in this worktree, not assumed): unlike
# pnpm, Bun does NOT hoist workspace-package symlinks into the root
# node_modules/. The real package contents live in a content-addressed store
# at node_modules/.bun/<pkg>@<version>/node_modules/<pkg>, and each
# *consuming* workspace gets its own node_modules/ full of symlinks pointing
# back into that root store (e.g. apps/api/node_modules/fastify ->
# ../../../node_modules/.bun/fastify@.../node_modules/fastify) plus a
# symlink straight to the sibling workspace source
# (apps/api/node_modules/@prswarm/shared-types ->
# ../../../../packages/shared-types). So the runtime image needs BOTH the
# root node_modules (the actual store the symlinks resolve into) AND
# apps/api's own node_modules (the symlinks themselves) AND
# packages/shared-types (the workspace symlink's target) — copying
# apps/api wholesale brings its node_modules along, but only works if the
# other two are also present at the same relative depth so every relative
# symlink target still resolves inside the image.

FROM oven/bun:1 AS build
WORKDIR /repo

COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

COPY packages/shared-types packages/shared-types
COPY apps/api apps/api
COPY apps/web apps/web
RUN bun run --filter '@prswarm/shared-types' typecheck \
 && bun run --filter '@prswarm/api' typecheck \
 && bun run --filter '@prswarm/web' build

FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Root node_modules (the .bun content-addressed store) must land at the same
# relative depth as it was in the build stage, since apps/api/node_modules's
# symlinks are relative paths computed at install time.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared-types ./packages/shared-types
COPY --from=build /repo/apps/api ./apps/api
COPY --from=build /repo/apps/web/dist ./apps/api/public

# The API serves the built frontend as static files in production (see
# apps/api/src/index.ts's static-file registration, which resolves
# `../public` relative to its own file at apps/api/src/index.ts — so the
# public dir has to sit at apps/api/public, not the image root) — no
# separate web container/process, one thing to run.
ENV API_PORT=3000
ENV DATABASE_PATH=/app/data/app.db
# If ENCRYPTION_KEY isn't passed in, secrets.ts falls back to a generated key
# persisted under defaultDataDir() (apps/api/src/paths.ts), which on Linux
# means $XDG_DATA_HOME/prswarm. Without this, that lands in
# the container's ephemeral filesystem (root's default ~/.local/share) and
# is lost on container replacement — the volume only covers DATABASE_PATH's
# directory. Pointing XDG_DATA_HOME at the same mounted volume keeps a
# generated key alongside the database, surviving container replacement.
ENV XDG_DATA_HOME=/app/data
VOLUME ["/app/data"]
EXPOSE 3000

CMD ["bun", "apps/api/src/index.ts"]
