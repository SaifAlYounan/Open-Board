#!/bin/sh
set -e

# On Render (and similar PaaS), the platform provides the public URL and the port.
# Default the CORS allowlist to that URL so a one-click deploy needs no manual
# ALLOWED_ORIGIN. No-op everywhere else (RENDER_EXTERNAL_URL is unset).
if [ -z "$ALLOWED_ORIGIN" ] && [ -n "$RENDER_EXTERNAL_URL" ]; then
  export ALLOWED_ORIGIN="$RENDER_EXTERNAL_URL"
fi

# Apply the database schema before starting. `push-force` is non-interactive and
# idempotent when the schema already matches (this is what CI uses). The compose
# file gates startup on Postgres being healthy, so the DB is reachable here.
echo "[open-board] Applying database schema (drizzle-kit push)…"
pnpm --config.verify-deps-before-run=false --filter @workspace/db run push-force

echo "[open-board] Starting the server…"
# `seed()` runs on boot: idempotent migrations, and on a truly empty DB it creates
# one admin and logs a one-time password (change it immediately on first sign-in).
exec node /app/artifacts/api-server/dist/index.mjs
