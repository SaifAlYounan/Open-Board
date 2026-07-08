# syntax=docker/dockerfile:1

# ---- Builder: install everything and build the API bundle + the SPA ----------
FROM node:24-bookworm AS builder
WORKDIR /app

# Activate the same pnpm the lockfile was written with.
RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

COPY . .
# The root package.json has a `preinstall` guard that blocks non-pnpm installs by
# checking npm_config_user_agent. That check misfires under some container/CI pnpm
# setups (the agent isn't reported as pnpm/*). We ARE using pnpm here, so drop the
# guard for the image build only (it doesn't affect the built artifacts).
RUN npm pkg delete scripts.preinstall
RUN pnpm install --frozen-lockfile
# Build the artifacts (API esbuild bundle + frontend Vite build). We don't run
# the typecheck here — esbuild/vite bundle straight from source, and CI already
# enforces `pnpm run typecheck` on every change. (The root `build` script also
# runs a composite tsc that needs a build-order the container doesn't have.)
RUN pnpm -r --if-present run build

# ---- Runtime: slim image that serves the API + the built frontend ------------
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

# poppler-utils gives `pdftotext` — the preferred PDF text path (pdf-parse is the fallback).
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*

# Bake pnpm into the image (the entrypoint uses it to apply the schema). A global
# npm install is user-agnostic — no corepack fetch at container start.
RUN npm install -g pnpm@11.0.9

ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/artifacts/easyboard/dist/public

# Bring over the whole built workspace (API bundle, SPA build, node_modules, and
# drizzle-kit + the db package needed to apply the schema on first boot). This is
# the simplest correct image; a slimmer one (generated SQL migrations, no
# drizzle-kit at runtime) is a documented follow-up.
COPY --from=builder /app /app
COPY docker-entrypoint.sh /usr/local/bin/open-board-entrypoint.sh

# Install the entrypoint, create a non-root user, and give it the app tree
# (uploads land under the working dir — mount a volume there). All as root.
RUN chmod +x /usr/local/bin/open-board-entrypoint.sh \
  && useradd --create-home --uid 10001 app \
  && mkdir -p /app/uploads \
  && chown -R app:app /app

USER app
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/open-board-entrypoint.sh"]
