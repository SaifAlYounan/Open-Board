# Deploying Open Board

Open Board ships as a **single Docker image** that serves both the API and the web app, plus a
`docker-compose.yml` that adds PostgreSQL and (optionally) automatic HTTPS. Pick the path that fits.

- [Turnkey with automatic HTTPS](#turnkey-with-automatic-https) — one command, your domain, real cert.
- [Local / no domain](#local--no-domain) — try it on `http://localhost:3000`.
- [One-click on Render](#one-click-on-render) — no server to manage.
- [Bring your own proxy](#bring-your-own-proxy) — run the container, add your own TLS.

On **first boot** the app creates one admin account and prints a one-time password to the logs
(`docker compose logs app`). Sign in with `ADMIN_EMAIL` (default `admin@openboard.local`) and that
password; you'll be required to set a new one immediately.

---

## Turnkey with automatic HTTPS

Requirements: a server with Docker, a domain pointed at it (an `A` record), and ports 80 + 443 open.

```bash
git clone https://github.com/SaifAlYounan/Open-Board.git
cd Open-Board
cp .env.example .env
```

Edit `.env` and set:

```bash
SESSION_SECRET=<openssl rand -hex 32>
NODE_ENV=production
DOMAIN=board.yourcompany.com
ACME_EMAIL=you@yourcompany.com
ALLOWED_ORIGIN=https://board.yourcompany.com
# ANTHROPIC_API_KEY=sk-ant-...   # optional — enables the AI features
```

Then:

```bash
docker compose --profile production up -d
```

That builds the image, starts PostgreSQL and the app, and runs **Caddy**, which obtains and renews a
Let's Encrypt certificate for your domain automatically. Open `https://board.yourcompany.com`.

---

## Local / no domain

```bash
cp .env.example .env      # set SESSION_SECRET (openssl rand -hex 32)
docker compose up -d      # builds + starts db and app
```

Open `http://localhost:3000`. (No Caddy, plain http — for evaluation, not production.)

---

## One-click on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/SaifAlYounan/Open-Board)

The repo includes a [`render.yaml`](render.yaml) blueprint. In Render → **New → Blueprint**, pick your
fork of this repo. Render builds the Dockerfile, provisions a managed PostgreSQL, generates
`SESSION_SECRET`, serves the app over HTTPS, and wires `ALLOWED_ORIGIN` to your Render URL
automatically. Add `ANTHROPIC_API_KEY` in the dashboard to enable AI. (Railway works the same way —
point it at the repo and it builds the same `Dockerfile`.)

---

## Bring your own proxy

Run the container on a port and put your existing reverse proxy / load balancer (nginx, Traefik, a
cloud LB) in front for TLS:

```bash
cp .env.example .env      # SESSION_SECRET, NODE_ENV=production, ALLOWED_ORIGIN=https://your-domain
docker compose up -d      # app on ${APP_PORT:-3000}
```

Your proxy should terminate TLS and forward all traffic (including `/api` and `/socket.io`) to the app
on port 3000. The app trusts one proxy hop (`trust proxy = 1`).

---

## Configuration

Every variable is documented in [`.env.example`](.env.example). The essentials:

| Variable | Notes |
|---|---|
| `SESSION_SECRET` | **Required.** `openssl rand -hex 32`. |
| `NODE_ENV` | `production` enables secure cookies and requires `ALLOWED_ORIGIN`. |
| `DOMAIN` / `ACME_EMAIL` | Used by the `production` compose profile for automatic HTTPS. |
| `ALLOWED_ORIGIN` | Your public origin, e.g. `https://board.yourcompany.com` (auto-set on Render). |
| `ANTHROPIC_API_KEY` | Optional — enables document classification, search, and suggestions. |
| `POSTGRES_PASSWORD` | Optional — override the default database password. |

Uploaded files persist in the `uploads` Docker volume; database data in the `db-data` volume.

## Encryption at rest

Open Board deliberately does **not** encrypt database fields or uploaded files itself —
encryption at rest is **provided by the operator at the storage layer**. That is a decision, not
an oversight: storage-layer encryption protects everything (database, uploads, temp files, WAL,
backups) uniformly, keeps key management with your infrastructure, and avoids the false comfort of
app-level crypto whose keys would sit on the same host anyway.

What that means in practice — pick what matches your deployment:

- **Encrypted disks/volumes.** Put the Docker volumes (`db-data`, `uploads`) on encrypted storage:
  LUKS/dm-crypt on your own Linux server, or your cloud provider's encrypted block storage
  (AWS EBS encryption, GCP persistent-disk encryption, Azure disk encryption, Hetzner/DO
  encrypted volumes). Cloud block storage is usually a checkbox at volume creation — turn it on.
- **Encrypted managed Postgres.** If you point `DATABASE_URL` at a managed database (RDS, Cloud
  SQL, Azure Database, Render/Railway/Neon), enable its encryption-at-rest option — on most of
  these it is on by default. Keep TLS to the database on too (`sslmode=require`).
- **Encrypted backups.** Snapshots of an encrypted volume/instance are encrypted by the provider.
  If you dump manually, encrypt the artifact before it leaves the host, e.g.
  `pg_dump ... | gpg --symmetric` (or `age`), and store keys separately from the backups.
- **Full-disk encryption** on the host (or the hypervisor layer of your VPS provider) covers
  everything else — swap, logs, container layers.

The pre-production checklist in [SECURITY.md](SECURITY.md) includes verifying this is in place.

## Upgrading

Pull the new code and rebuild:

```bash
git pull
docker compose --profile production up -d --build   # (or without the profile for local)
```

The container applies the schema on start with `drizzle-kit push --force`. This is safe for the normal
case, but **back up your database before upgrading** — a schema change could otherwise drop a column.
A move to versioned, non-destructive migrations is tracked in the issues.
