<p align="center">
  <h1 align="center">✦ Open Board</h1>
  <p align="center"><strong>The open-source, AI-native board management platform.</strong></p>
  <p align="center">Upload a document. The AI proposes the next governance action. The Board Secretary approves.</p>
</p>

<p align="center">
  <a href="#what-is-this">What it is</a> •
  <a href="#how-it-works">How it works</a> •
  <a href="#quick-start">Quick start</a> •
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#configuration">Configuration</a> •
  <a href="#security">Security</a> •
  <a href="#roadmap">Roadmap</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## What is this?

Open Board is a self-hosted board-governance platform built by a governance professional, not a
software company. It replaces the traditional board portal — where administrators manually create
meetings, circulate documents, and track votes — with an AI-first approach: the system reads your
documents and **proposes** the next governance action, and a human approves it.

**The AI is not an add-on. It is the product.** But it never acts alone — every AI-proposed action
lands in the Secretary's approval queue, and nothing is created until a person approves it. This is
human-in-the-loop governance by design.

> **Beta.** It works and it's honest about its rough edges — see the [Roadmap](#roadmap) for what's
> still stubbed or unbuilt. Found something wrong? [Open an issue](https://github.com/SaifAlYounan/Open-Board/issues).

---

## How it works

```
Secretary uploads a document
        ↓
AI classifies it (minutes? resolution? evidence? agenda? …)
        ↓
AI proposes actions (create a meeting / a circulation vote / tasks / a workflow)
        ↓
Secretary reviews the queue → Approve / Edit / Reject
        ↓
The entity is created — visible to the right people
```

The AI recognizes several document types (draft minutes → tasks; resolutions → circulation votes;
agendas → meetings; evidence → task closure; legal opinions → flagged privileged; general → stored).
Each proposal carries a **verbatim source quote** for provenance, and is validated against a strict
schema both when it's queued and again when it executes. If AI is not configured, every manual
feature still works.

---

## Quick start

**Requirements:** Node 24 (20.12+ minimum — the server uses the built-in env-file loader), pnpm 9+,
and PostgreSQL 16 (a one-command Postgres is included via Docker).

```bash
git clone https://github.com/SaifAlYounan/Open-Board.git
cd Open-Board
pnpm install
cp .env.example .env      # then set SESSION_SECRET  (openssl rand -hex 32)
```

Start PostgreSQL (or point `DATABASE_URL` at your own instance):

```bash
docker compose up -d db   # Postgres 16 on localhost:5432 — matches .env.example
```

Create the schema and start everything:

```bash
pnpm db:push              # create the database tables
pnpm dev                  # starts the API (auto-seeds on first boot) + the frontend
```

- **API** → `http://localhost:3000` (`PORT`)
- **App** → `http://localhost:5173` (`WEB_PORT`) — **open this one.** The dev server proxies `/api`
  to the API, so the browser talks to one origin (no CORS in dev). Prefer separate terminals?
  Run `pnpm dev:api` and `pnpm dev:web`.

**First boot creates one admin account** with a randomly generated one-time password printed once to
the API log (`FIRST BOOT — admin account created. One-time password: …`). Sign in with `ADMIN_EMAIL`
(default `admin@openboard.local`) and that password; you'll be **required to set a new one immediately**.

> The `.env` file is loaded automatically by both the server and `pnpm db:push`. Every variable is
> documented in [`.env.example`](.env.example). Real environment variables set by your shell or
> container always take precedence.

### Demo dataset (optional)

To explore with a fully populated fictional board — "Meridian Energy Group", 20 users across 4 roles,
5 committees, and interlinked meetings/votes/minutes/tasks — set these in `.env` before `pnpm db:push`:

```bash
DEMO_MODE=true
SEED_PASSWORD=YourStrongDemoPassword123!
```

All demo users then share `SEED_PASSWORD`. **Never enable `DEMO_MODE` in production** — it seeds
login-capable accounts (including an admin) with one shared password.

---

## Features

### For the Board Secretary (admin)
- **AI document classification** — upload a PDF, DOCX, or TXT; the AI parses it and proposes actions.
- **Approval queue** — review, edit, or reject every AI-proposed action before anything is created.
- **Natural-language commands** — "Schedule a board meeting for June 15 with ESG Review on the agenda."
- **Full manual control** — create meetings, votes, minutes, and tasks without AI.
- **Minutes lifecycle** — Draft → Review → Signing → Signed, enforced as a state machine; content is
  frozen once signing begins, and minutes can't be marked signed with zero signatures.
- **Board Intelligence** — a searchable governance knowledge graph (D3 force-directed) with a project
  tracker and decision timeline.
- **Approval rules** — unanimous, simple majority, two-thirds, three-quarters, or custom, with an
  enforced **quorum** and **recusals** (recused members are excluded from quorum and tally).

### For Board Members
- **Vote in two clicks** — Approved / Approved with comments / Not approved / Not approved with comments.
- **Sign minutes** — SHA-256 signature hashes; only eligible members of the minutes' board may sign.
- **Verifiable vote certificates** — a certificate hash is recomputable from stored data; a
  `GET /api/votes/:id/certificate/verify` endpoint proves the record hasn't been altered.
- **Comment on minutes** during the review period.

### For Management
- **Task dashboard** with source links back to the originating minutes.
- **Evidence upload** — submit deliverables against your assigned tasks (assignee-only); the AI
  pre-reviews and the Secretary confirms closure.

### For Observers
- **Read-only** access to boards you're granted, with **per-document access control** so a director
  can be excluded from specific materials (conflict-of-interest recusal).
- **Secret ballots** — individual votes visible only to the Secretary and the voter.

### Not yet implemented (see [Roadmap](#roadmap))
- **Weighted voting** and **proxy voting** exist in the data model but are **not enforced** in tallying.
- **Email notifications / password-reset email** are **not wired** — the reset flow generates a token
  but there is no mail transport yet.
- **Real-time UI updates** — the Socket.IO server exists but the current SPA does not subscribe to it.

---

## Architecture

A pnpm monorepo (Node 24, PostgreSQL 16). Seven workspaces:

| Workspace | Path | What |
|---|---|---|
| `@workspace/api-server` | `artifacts/api-server` | Express 5 API + the Claude integration (`src/lib/ai.ts`), bundled with esbuild. |
| `@workspace/easyboard` | `artifacts/easyboard` | React 19 + Vite 7 + Tailwind 4 frontend. *(The package keeps the legacy name "easyboard"; the product is "Open Board".)* |
| `@workspace/db` | `lib/db` | Drizzle schema + `drizzle-kit` migrations (`db:push`). |
| `@workspace/api-spec` | `lib/api-spec` | OpenAPI spec + `orval` codegen. |
| `@workspace/api-zod` | `lib/api-zod` | Generated Zod schemas / types. |
| `@workspace/api-client-react` | `lib/api-client-react` | Generated TanStack-Query client. |
| `@workspace/scripts` | `scripts` | Workspace tooling. |

**Dev topology.** The API (Express, port `PORT`) and the frontend (Vite, port `WEB_PORT`) run as two
processes; the Vite dev server proxies `/api` and `/socket.io` to the API, so the browser sees one
origin. **In production the API is API-only — it does not serve the built SPA.** Build the frontend
(`pnpm --filter @workspace/easyboard build` → `dist/public`) and serve it from a static host or
reverse proxy that also forwards `/api` to the API server. (Single-process static serving is on the
[Roadmap](#roadmap), issue [#9](https://github.com/SaifAlYounan/Open-Board/issues/9).)

**Tech stack.**
- **Backend:** Node.js, Express 5, PostgreSQL + Drizzle ORM, `@anthropic-ai/sdk`, JWT (HttpOnly
  cookies) + bcryptjs, helmet, express-rate-limit, multer + pdf-parse + mammoth, sanitize-html, pino.
  A Socket.IO server exists for real-time rooms (authenticated), but the current frontend does not
  consume it.
- **Frontend:** React 19, Vite 7, Tailwind CSS 4, Radix UI, Wouter (routing), TanStack Query,
  D3 (Board Intelligence graph), TipTap (minutes editor), DOMPurify.
- **AI:** Anthropic Claude, two tiers — `AI_MODEL` (default `claude-opus-4-8`, with extended thinking)
  for classification and natural-language commands; `AI_LIGHT_MODEL` (default
  `claude-haiku-4-5-20251001`) for search, suggestions, and evidence review. Structured outputs via
  the SDK + Zod. Point `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` at an Anthropic-compatible gateway to
  self-host the endpoint. (Local / OpenAI-compatible models are **not** supported yet — issue
  [#15](https://github.com/SaifAlYounan/Open-Board/issues/15).)
- **Supply chain:** pnpm-only (enforced), `minimumReleaseAge` quarantines npm releases younger than
  1 day, and only an allowlist of packages may run install scripts.

### API surface

~85 REST routes under `/api`, grouped by resource: `auth`, `boards`, `people`, `meetings`, `votes`,
`minutes`, `documents`, `tasks`, `pending-actions`, `ai`, `dashboard`, `graph` (Board Intelligence),
`workflows` (multi-stage approvals — **AI-created, read-only over REST**; issue
[#13](https://github.com/SaifAlYounan/Open-Board/issues/13)), `audit`, and `system`
(`/organization`, `/system/export`, `/system/reset-data`). The OpenAPI spec in `lib/api-spec` covers
the core routes; ~25 are documented as known gaps (issue
[#12](https://github.com/SaifAlYounan/Open-Board/issues/12)) and a test blocks new routes from
shipping undocumented.

---

## Configuration

`.env` (repo root) is loaded automatically. Full template in [`.env.example`](.env.example).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | — | PostgreSQL connection string. |
| `SESSION_SECRET` | **Yes** | — | JWT signing secret (`openssl rand -hex 32`). Server refuses to start without it. |
| `PORT` | **Yes** | — | API server port (3000 by convention). |
| `ALLOWED_ORIGIN` | **In production** | localhost in dev | Comma-separated CORS origin allowlist. No wildcard fallback in prod. |
| `NODE_ENV` | No | — | `production` enables secure cookies and requires `ALLOWED_ORIGIN`. |
| `WEB_PORT` | No | `5173` | Vite dev/preview port. |
| `BASE_PATH` | No | `/` | Sub-path the SPA is served under. |
| `API_PROXY_TARGET` | No | `http://localhost:${PORT:-3000}` | Vite dev proxy target for `/api` + `/socket.io`. |
| `ANTHROPIC_API_KEY` | No | — | Enables AI. App works without it (AI features disabled). |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | No | — | Preferred key name; takes precedence over `ANTHROPIC_API_KEY`. |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | No | SDK default | Anthropic-compatible gateway URL. |
| `AI_MODEL` | No | `claude-opus-4-8` | Heavy model (classify, command). |
| `AI_LIGHT_MODEL` | No | `claude-haiku-4-5-20251001` | Light model (search, suggest, review). |
| `AI_DAILY_CALL_LIMIT` | No | `1000` | Daily AI-call ceiling (persisted, restart-safe). |
| `AI_DAILY_TOKEN_LIMIT` | No | off | Optional daily token ceiling. |
| `ADMIN_EMAIL` | No | `admin@openboard.local` | First-boot admin email. |
| `ORG_NAME` | No | `My Organization` | First-boot organization name. |
| `LOG_LEVEL` | No | `info` | pino log level. |
| `APP_VERSION` | No | `3.0.0` | Reported by `/organization` and the export bundle. |
| `DEMO_MODE` | No | off | `true` seeds the Meridian demo. **Never in production.** |
| `SEED_PASSWORD` | Demo only | — | Shared password for demo accounts (required when `DEMO_MODE=true`). |

### Production notes
- Terminate **TLS at your reverse proxy** and enable **SSL on your PostgreSQL connection** — the app
  does not do TLS or at-rest encryption itself (at-rest encryption is issue
  [#16](https://github.com/SaifAlYounan/Open-Board/issues/16)).
- Use a **managed PostgreSQL** instance and configure backups.
- Replace local `uploads/` with S3-compatible object storage for durability.
- Set `ALLOWED_ORIGIN` to your exact frontend origin(s).

---

## Security

Open Board is built for organizations that take data sovereignty seriously: self-hosted, no telemetry,
and (when self-hosted) no third-party vendor that a foreign government could compel to hand over your
board documents.

Highlights of what's actually implemented:
- **Human-in-the-loop** — every AI-proposed action requires Secretary approval; nothing auto-executes.
- **JWT in HttpOnly cookies** with `SameSite=Strict` and `Secure` in production; a per-user token
  version **revokes outstanding tokens** on password change, reset, or deactivation. (Plain logout
  clears the cookie but does not yet revoke — issue
  [#14](https://github.com/SaifAlYounan/Open-Board/issues/14).)
- **Tamper-evident audit trail** — each row carries a SHA-256 hash of the previous, binding every
  attributable field.
- **Object-level access control** on boards, votes, meetings, minutes, tasks, and per-document ACLs.
- **AI action validation** — one Zod contract validates every proposal at queue time and again at
  execution; unknown action types are rejected.
- **Input hardening** — sanitize-html + DOMPurify, 1 MB body cap, UUID validation on route params,
  multi-layer rate limiting, mandatory `SESSION_SECRET`, bcrypt (cost 10), 12-char minimum passwords.

Known limitation: account lockout is currently in-memory (per-process, resets on restart — issue
[#7](https://github.com/SaifAlYounan/Open-Board/issues/7)).

Full details and the private disclosure process are in [SECURITY.md](SECURITY.md). Complete your own
security review before using this with real board data.

---

## Roadmap

Honest list of what's stubbed or unbuilt, each tracked as an issue:

| # | Gap | Status |
|---|---|---|
| [#4](https://github.com/SaifAlYounan/Open-Board/issues/4) | Weighted voting | Schema only — tally ignores weights |
| [#5](https://github.com/SaifAlYounan/Open-Board/issues/5) | Proxy voting | Stored on attendance — not used in casting/quorum |
| [#6](https://github.com/SaifAlYounan/Open-Board/issues/6) | Password-reset email | Token generated; no mail transport |
| [#7](https://github.com/SaifAlYounan/Open-Board/issues/7) | Account lockout | In-memory only (per-process) |
| [#8](https://github.com/SaifAlYounan/Open-Board/issues/8) | Frontend real-time | Socket.IO server exists; SPA doesn't subscribe |
| [#9](https://github.com/SaifAlYounan/Open-Board/issues/9) | Production static serving | API doesn't serve the SPA |
| [#10](https://github.com/SaifAlYounan/Open-Board/issues/10) | `GET /meetings` N+1 | Not yet SQL-pushed/batched |
| [#11](https://github.com/SaifAlYounan/Open-Board/issues/11) | True soft-delete + restore | Only a retention snapshot exists |
| [#12](https://github.com/SaifAlYounan/Open-Board/issues/12) | Full OpenAPI coverage | ~25 routes undocumented (orval barrel blocker) |
| [#13](https://github.com/SaifAlYounan/Open-Board/issues/13) | Manual workflow management | Workflows are AI-created, read-only over REST |
| [#14](https://github.com/SaifAlYounan/Open-Board/issues/14) | Logout token revocation | Logout clears cookie only |
| [#15](https://github.com/SaifAlYounan/Open-Board/issues/15) | Local / OpenAI-compatible models | Anthropic-only today |
| [#16](https://github.com/SaifAlYounan/Open-Board/issues/16) | Encryption at rest | Not implemented in-app |

Longer-horizon ideas: Delegation-of-Authority engine, committee endorsement cascades, automated
board-pack PDF generation, calendar integration, multi-tenant deployment.

---

## Contributing

Contributions are welcome — especially from people who work in board administration, legal, compliance,
or corporate-secretarial roles. Domain feedback is as valuable as code. See
[CONTRIBUTING.md](CONTRIBUTING.md) for the dev setup and the checks CI runs. Report bugs and request
features via [issues](https://github.com/SaifAlYounan/Open-Board/issues); report vulnerabilities
privately per [SECURITY.md](SECURITY.md).

## License

MIT — see [LICENSE](LICENSE). © Alexios van der Slikke-Kirillov.

<p align="center"><em>Built by a governance professional. Shaped by the community.</em></p>
