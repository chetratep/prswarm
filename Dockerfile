# Single container, single process — matches the project's "no service to
# stand up besides the app itself" stance (see CLAUDE.md > Tech stack).
# SQLite lives on a mounted volume at /app/data; no Postgres/Redis sidecar.

FROM node:22-slim AS build
WORKDIR /repo

RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile

COPY packages/shared-types packages/shared-types
COPY apps/api apps/api
COPY apps/web apps/web
RUN pnpm --filter @bulk-github-update-tool/shared-types run typecheck \
 && pnpm --filter @bulk-github-update-tool/api run build \
 && pnpm --filter @bulk-github-update-tool/web run build

# Prune devDependencies out of the api's node_modules for the runtime image.
RUN pnpm --filter @bulk-github-update-tool/api deploy --prod /out/api

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /out/api/dist ./dist
COPY --from=build /out/api/node_modules ./node_modules
COPY --from=build /repo/apps/web/dist ./public

# The API serves the built frontend as static files in production (see
# apps/api/src/index.ts's static-file registration) — no separate web
# container/process, one thing to run.
ENV PORT=3000
ENV DATABASE_PATH=/app/data/app.db
VOLUME ["/app/data"]
EXPOSE 3000

CMD ["node", "dist/index.js"]
