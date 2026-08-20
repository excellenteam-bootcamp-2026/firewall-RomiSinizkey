# syntax=docker/dockerfile:1

# ---- deps: shared base with the full dependency tree (dev + prod) -----------------
# Used by both the "development" and "build" stages below, so `npm ci` only runs once
# and its layer is cached across both.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- development: hot reload via ts-node-dev ---------------------------------------
# Intended to run with the repository bind-mounted over /app (Issue #44's
# docker-compose.dev.yml), so the COPY below only seeds a self-contained image that
# also works standalone. No database credentials are set here — they arrive at
# container-start time via env_file (Issue #43/#44), never baked into the image.
FROM deps AS development
WORKDIR /app
ENV NODE_ENV=development
COPY . .
ARG PORT=3000
ENV PORT=${PORT}
EXPOSE ${PORT}
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["npm", "run", "dev"]

# ---- build: compiles TypeScript to dist/ -------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
RUN npm run build

# ---- production: only production dependencies + compiled output -------------------
# A fresh base (not derived from "deps"), so devDependencies such as drizzle-kit,
# typescript, ts-node-dev, and vitest are never present in this image.
FROM node:24-alpine AS production
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle

# Logger.ts writes to <CWD>/logs/app.log in production mode (winston File transport)
# and creates that directory itself on first write — it must already be owned by the
# non-root user below, or that mkdir fails with EACCES and logging silently falls
# back to console-only (caught by manual verification against a real database).
RUN addgroup -S app && adduser -S app -G app \
  && mkdir -p /app/logs && chown -R app:app /app
USER app

ARG PORT=3000
ENV PORT=${PORT}
EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Migrations run before the server starts (src/main/migrate.ts, compiled to
# dist/main/migrate.js) — not `npm run db:migrate`, which shells out to drizzle-kit
# and is unavailable in this image. `npm run start:container` chains the two with
# `&&`, so a failed migration stops the container before the server ever starts.
CMD ["npm", "run", "start:container"]
