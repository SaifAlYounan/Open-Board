# LQGovernance — Board Management Portal

An **AI-native, self-hosted platform for running a board's governance**. You upload a document —
a resolution, a report, a piece of correspondence — and the AI reads it and proposes the next
governance action: a task, a circulation vote, or a meeting. A human on the board secretariat then
approves or rejects that proposal. **Nothing is ever created without a person signing off.** Because
it is self-hosted, your board's documents stay on infrastructure you control.

The AI is optional and pluggable. It runs against **Anthropic** or **any OpenAI-compatible / local
model** (Ollama, vLLM, LM Studio, llama.cpp, …), and only when you configure a key or an endpoint.
Without one, the AI features are simply switched off and **every other part of the app works exactly
the same** — you drive the governance workflows by hand.

> **Beta, and honest about it.** It runs, it is tested, and its limitations are written down rather
> than glossed over. Read [SECURITY.md](SECURITY.md) and do your own review before you put real board
> data in it. Issues and known gaps live in the open at
> [github.com/LegalQuants/LQGovernance-OpenBoard](https://github.com/LegalQuants/LQGovernance-OpenBoard).

---

## Contents

- [How it works](#how-it-works)
- [What it does](#what-it-does)
- [Quick start (Docker)](#quick-start-docker)
- [Turn on AI (optional)](#turn-on-ai-optional)
- [Deploy to production](#deploy-to-production)
- [Local development](#local-development)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Security](#security)
- [Roadmap, contributing, license](#roadmap-contributing-license)

---

## How it works

The human-in-the-loop is the whole point:

1. **Upload.** A document lands in the portal (a resolution to circulate, a management report, an
   email).
2. **Propose.** If an AI provider is configured, the AI classifies the document and drafts a
   *proposed* governance action — never an executed one. Every proposal is validated against a strict
   schema both when it is queued and again when it runs; anything unknown is rejected.
3. **Approve.** The proposal sits in the secretariat's pending-actions queue. An admin (acting as the
   board secretary) reviews it and approves or rejects. Only on approval does anything real get
   created.
4. **Act & record.** The approved task/vote/meeting goes live, members are notified in real time, and
   every step is written to a hash-chained audit trail (see SECURITY.md for what that does and does
   not defend against).

Every action the AI can propose can also be created **manually** through the same validated contract,
so the platform is fully usable with the AI turned off.

---

## What it does

**Boards & people**
- Multiple boards per organization, each with its own membership.
- Global account roles: **admin**, **management**, **member**, **observer**. Admins run the
  secretariat and approve actions; management can be assigned tasks and submit evidence; members vote;
  observers are read-only and are blocked from every mutating action. A per-board **secretary**
  membership role records who serves as secretary on a given board.
- New accounts (including the first-boot admin) are issued a one-time password and are **forced to
  reset it on first sign-in**.

**Voting**
- **Circulation votes** with an outcome decided against a configurable **approval rule** (threshold,
  quorum, and behavior).
- **Weighted voting** — each membership carries a voting weight, and outcome and quorum are decided
  over total weight, not a raw head count.
- **Proxy voting** — per-vote grants let one member cast an **attributed** ballot on behalf of
  another (the ballot is recorded against the principal, stamped with who cast it).
- The **same tally logic** drives both casting and display, and eligible-voter totals exclude
  observers and non-voting roles consistently.

**Minutes & signatures**
- Draft, comment on, and **sign** minutes, with object-level checks on who may sign.
- **Cryptographic minutes signatures**: each signer enrolls a personal **Ed25519** key whose private
  half is wrapped by a passphrase entered at signing and never stored — so the server cannot sign for
  a director. Verify in-app (`GET /api/minutes/:id/signature/verify`) or **offline** from an exported
  bundle (`GET /api/minutes/:id/export` + `artifacts/api-server/scripts/verify-minutes.mjs`). Old
  signatures report `legacy_unverifiable`. See [docs/SIGNING.md](docs/SIGNING.md).
- **Verifiable vote certificates**: the certificate hash is computed entirely from persisted data and
  can be re-checked at `GET /api/votes/:id/certificate/verify`.

**Documents**
- Upload, classify, download, and reclassify board materials.
- **Per-document access control** — an allow-list: a document is visible only to members explicitly
  granted access (plus admins). Note: on upload only the uploader is granted, so board-wide sharing
  is not automatic, and exclusion-based recusal is not yet implemented (see SECURITY.md limitations).

**Meetings & tasks**
- Meetings with agendas and attendance; tasks with assignees and evidence submission/review.
- Manual create/edit/cancel flows with validated state transitions (a closed vote, a completed task,
  or a cancelled meeting can't be silently mutated). Cancel is distinct from delete.

**Platform**
- **Real-time updates** over Socket.IO — mutations invalidate the right views for the members of the
  affected board only.
- **Soft delete with snapshots** — governance records are copied into a retention log before deletion
  and are included in the export.
- **System data export** for backup / portability.
- **Optional email** (SMTP) for password-reset and account-invite delivery. With SMTP unconfigured,
  reset links are written to the server log instead and the app runs normally. (The first-boot admin
  one-time password is always log-only.)
- **Hash-chained audit trail** — a SHA-256 hash chain binding actor, entity, details, IP, and time
  (detects casual edits; not resistant to an actor with DB write access — see SECURITY.md).

There is **no** SCIM / directory-sync integration; accounts are managed in-app.

---

## Quick start (Docker)

The only prerequisite is **Docker** (Docker Desktop on macOS/Windows, or Docker Engine on Linux —
both include Compose) and **Git**. You do not need Node, pnpm, or a separate database; the image
bundles the app and Compose runs PostgreSQL for you.

**1. Get the code**

```bash
git clone https://github.com/LegalQuants/LQGovernance-OpenBoard.git
cd LQGovernance-OpenBoard
```

**2. Create your config**

```bash
cp .env.example .env
```

There is exactly one value you must set — `SESSION_SECRET`, which signs login sessions (the server
refuses to start without it). Generate one and paste it into `.env`:

```bash
openssl rand -hex 32
```

```
SESSION_SECRET=paste-the-long-random-string-here
```

Leave everything else at its default.

**3. Start it**

```bash
docker compose up -d --build
```

Compose builds the image, starts PostgreSQL and the app, applies the **versioned SQL migrations** at
boot, and seeds a single admin account. The first build takes a few minutes; later starts take
seconds.

**4. Sign in**

Open **http://localhost:3000**. On the very first boot the app prints a one-time admin password to
the log:

```bash
docker compose logs app | grep "One-time password"
# FIRST BOOT — admin account created. One-time password: xxxxxxxxxxxxxxxx — log in and change it immediately.
```

Sign in with email **`admin@openboard.local`** (override with `ADMIN_EMAIL`) and that password. You
are required to set a new password immediately.

> **Port already taken?** If 3000 (app) or 5432 (database) are in use, set `APP_PORT=` and/or
> `DB_PORT=` in `.env` to free ports, then `docker compose up -d` and open the new app port.

> **Just want a demo dataset?** Set `DEMO_MODE=true` (and a `SEED_PASSWORD`) in `.env` before first
> boot to seed a fictional organization. Never enable it in production — see the safety notes in
> [`.env.example`](.env.example).

---

## Turn on AI (optional)

Add a provider to `.env` and restart (`docker compose up -d`). Two paths:

**Anthropic (default provider)** — sends document text off your deployment, so it takes **two**
settings: the key, and an explicit egress acknowledgement. Without the acknowledgement the Anthropic
path stays disabled even with a key present.

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
AI_ALLOW_EXTERNAL_PROVIDER=true   # you accept that extracted document text leaves this deployment
```

**Local / OpenAI-compatible** — anything that speaks `/v1/chat/completions`, so documents never leave
your network:

```
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://localhost:11434/v1   # your server's OpenAI-compatible root
AI_MODEL=llama3.1:70b                   # a model your server hosts
AI_LIGHT_MODEL=llama3.1:8b              # used for the low-stakes modes
# AI_API_KEY=...                        # only if your server requires a bearer token
```

Structured replies are requested via JSON-schema `response_format` when the server supports it and
fall back to prompt-guided JSON when it doesn't; either way the response is validated locally against
the same strict schemas before it can reach the approval queue. With no provider configured, the AI
features are disabled and everything else keeps working.

---

## Deploy to production

LQGovernance ships as a **single Docker image** plus a Compose file that adds PostgreSQL and,
optionally, automatic HTTPS. The common paths:

**Turnkey HTTPS (Caddy).** Point your domain's DNS at the server, open ports 80 and 443, then set in
`.env`:

```
NODE_ENV=production
DOMAIN=board.yourcompany.com
ACME_EMAIL=you@yourcompany.com
ALLOWED_ORIGIN=https://board.yourcompany.com
```

```bash
docker compose --profile production up -d --build
```

The bundled **Caddy** reverse proxy obtains and renews a Let's Encrypt certificate automatically.

**One-click on Render.** The repo ships a [`render.yaml`](render.yaml) blueprint that provisions a
managed Postgres, generates `SESSION_SECRET`, wires `ALLOWED_ORIGIN` to your Render URL, and serves
over HTTPS.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/LegalQuants/LQGovernance-OpenBoard)

**Bring your own proxy.** Run the container and terminate TLS at your own nginx/Traefik/LB, forwarding
`/api` and `/socket.io` to the app on port 3000 (it trusts one proxy hop).

The full production guide — backups, upgrades, the one-time baseline for pre-migration deployments,
and operator-provided **encryption at rest** — is in **[DEPLOY.md](DEPLOY.md)**.

---

## Local development

Only needed to change the code. Requirements: **Node 20.12+** (24 recommended), **pnpm 11**, and
Docker for the database.

```bash
git clone https://github.com/LegalQuants/LQGovernance-OpenBoard.git
cd LQGovernance-OpenBoard
pnpm install
cp .env.example .env        # set SESSION_SECRET (openssl rand -hex 32)
docker compose up -d db     # just PostgreSQL, on localhost:5432
pnpm db:migrate             # apply the versioned migrations
pnpm dev                    # API + frontend with hot reload
```

The frontend runs on **http://localhost:5173** and proxies `/api` to the server on port 3000. Useful
scripts: `pnpm typecheck`, `pnpm -r test`, `pnpm -r build`, `pnpm db:generate` (author a migration
after a schema change). See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow, including the
OpenAPI-codegen drift check that CI enforces.

---

## Configuration

Every setting is documented in [`.env.example`](.env.example). The ones you are most likely to touch:

| Variable | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | **Yes** | Signs login sessions. `openssl rand -hex 32`. The app will not start without it. |
| `DATABASE_URL` | Yes (defaulted) | PostgreSQL connection string. Preset to match the bundled database. |
| `APP_PORT` / `DB_PORT` | No | Host ports if 3000 / 5432 are taken. |
| `APP_BIND` | No | App host bind address. Loopback (`127.0.0.1`) by default; set `0.0.0.0` only to expose it directly. |
| `ANTHROPIC_API_KEY` | No | The Anthropic key. Enables AI **only together with** `AI_ALLOW_EXTERNAL_PROVIDER=true`. Omit to run without AI. |
| `AI_ALLOW_EXTERNAL_PROVIDER` | With Anthropic | Must be `true` to allow the Anthropic path (document text leaves the deployment). The local provider does not need it. |
| `MFA_FRESHNESS_SECONDS` | No | How recently the second factor must be proven before signing/approving/exporting. Default `900` (15 min). |
| `AI_PROVIDER` | No | `anthropic` (default) or `openai-compatible` for local inference. |
| `AI_BASE_URL` | With `openai-compatible` | The OpenAI-compatible root, e.g. `http://localhost:11434/v1`. |
| `AI_API_KEY` | No | Bearer token for the OpenAI-compatible server, if it needs one. |
| `AI_MODEL` / `AI_LIGHT_MODEL` | No | Which models to use (Claude names by default; your server's names on `openai-compatible`). |
| `AI_DAILY_CALL_LIMIT` | No | Daily ceiling on AI calls (cost guard, restart-safe). |
| `NODE_ENV` | No | `production` enables secure cookies and requires `ALLOWED_ORIGIN`. |
| `ALLOWED_ORIGIN` | Production | Allowed browser origin(s) for the API (no wildcard in production). |
| `DOMAIN` / `ACME_EMAIL` | Production | Domain and account email for automatic HTTPS via Caddy. |
| `ADMIN_EMAIL` / `ORG_NAME` | No | First-boot admin email and organization name. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | No | Outbound email for password resets and invites. Without `SMTP_HOST`, reset links are logged only. |
| `APP_BASE_URL` | With SMTP | Public frontend URL used to build reset links inside emails. |
| `POSTGRES_PASSWORD` | No | Override the dev-grade default database password (required in production). |
| `DEMO_MODE` / `SEED_PASSWORD` | No | Seed a fictional demo organization. Never enable in production. |

Uploaded files persist in the `uploads` Docker volume and database data in `db-data`; both survive
restarts and are removed only by `docker compose down -v`.

---

## Architecture

A pnpm monorepo (Node 24) that builds into one Docker image serving the SPA and the API from a single
Express process:

- `artifacts/easyboard` — the React single-page app (Vite).
- `artifacts/api-server` — the Express API + Socket.IO server, and the static-file host for the SPA.
- `lib/db` — the Drizzle schema and **versioned SQL migrations** (`lib/db/migrations`), applied at
  boot behind a Postgres advisory lock.
- `lib/api-spec` — the OpenAPI spec (`openapi.yaml`), the single source of truth for the HTTP contract.
- `lib/api-zod`, `lib/api-client-react` — generated from the spec (orval); CI fails if they drift.
- `scripts` — build and maintenance tooling.

Data lives in **PostgreSQL**. The store is single-organization per deployment — the per-board
membership is the isolation boundary (there is no multi-tenant separation).

---

## Security

LQGovernance handles minutes, resolutions, votes, and confidential documents, so security is a
first-class concern: **mandatory TOTP two-factor** for admins and board members (re-verified before
signing, approving, or exporting), **per-user Ed25519 minutes signing** the server cannot forge,
**fail-closed audit writes** (a mutation rolls back if it cannot be audited) on a verifiable
hash chain, JWTs in HttpOnly cookies with server-side revocation, bcrypt-cost-12 passwords with
forced first-login reset, object-level and per-document authorization, a durable Postgres-backed
account lockout, and AI proposals that are channel-fenced, schema-validated, and always require human
approval. Prompt injection is **mitigated, not solved**, and there is no application-level encryption
at rest yet — read the **candid known limitations** in SECURITY.md before using this with real board
data.

The details, the **candid known limitations**, and a pre-production checklist are in
**[SECURITY.md](SECURITY.md)**. To report a vulnerability, open a private
[GitHub Security Advisory](https://github.com/LegalQuants/LQGovernance-OpenBoard/security/advisories/new)
rather than a public issue. Do your own security review before using this with real board data.

---

## Roadmap, contributing, license

- **Roadmap** — this is beta; [open issues](https://github.com/LegalQuants/LQGovernance-OpenBoard/issues)
  track what's planned and known, and [CHANGELOG.md](CHANGELOG.md) records what has shipped.
- **Contributing** — welcome, especially from people in board administration, legal, compliance, or
  corporate-secretarial roles. Domain feedback is as valuable as code. Start with
  [CONTRIBUTING.md](CONTRIBUTING.md).
- **License** — [MIT](LICENSE).
</content>
</invoke>
