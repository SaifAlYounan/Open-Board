#!/bin/sh
set -e

# On Render (and similar PaaS), the platform provides the public URL and the port.
# Default the CORS allowlist to that URL so a one-click deploy needs no manual
# ALLOWED_ORIGIN. No-op everywhere else (RENDER_EXTERNAL_URL is unset).
if [ -z "$ALLOWED_ORIGIN" ] && [ -n "$RENDER_EXTERNAL_URL" ]; then
  export ALLOWED_ORIGIN="$RENDER_EXTERNAL_URL"
fi

# Schema is applied by the server itself at boot: versioned SQL migrations
# (lib/db/migrations) run through drizzle's journaled migrate(), serialized
# across replicas with a Postgres advisory lock — safe when several containers
# start at once. The compose file gates startup on Postgres being healthy, so
# the DB is reachable here. NOTE for deployments created before v3.1 (schema
# was push-created): run the one-time baseline first — see DEPLOY.md "Upgrading
# an existing deployment to versioned migrations".
echo "[open-board] Starting the server (migrations run at boot)…"
# `seed()` runs after listen: on a truly empty DB it creates one admin and logs
# a one-time password (change it immediately on first sign-in).
exec node /app/artifacts/api-server/dist/index.mjs
