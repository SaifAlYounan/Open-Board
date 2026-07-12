# LQGovernance — Board Management Portal

A **self-hosted platform for running a board's governance**: circulation and meeting votes with real
quorum rules, minutes with cryptographic signatures, tasks with evidence, documents with per-member
access control — and an optional AI layer that reads what you upload and *proposes* the next
governance action for a human to approve. **Nothing is ever created without a person signing off**,
and because it is self-hosted, your board's records stay on infrastructure you control.

> **Beta, and honest about it.** It runs, it is tested (300+ tests, integration suites against a real
> Postgres), and its limitations are written down rather than glossed over — including the ones found
> by people reviewing it adversarially. Read [SECURITY.md](SECURITY.md), including its **known
> limitations**, before you put real board data in it.

## The arc (read this before trusting anything below)

This README describes the code as it stands after four rounds of scrutiny, and the honest lesson of
those rounds is that **this project's documentation has repeatedly promised more than the code did**.
The sequence: built and donated to LegalQuants → audited (F1–F12; the headline was that minutes
signatures were decorative) → hardened to the bar (per-user Ed25519 signing, mandatory TOTP,
fail-closed audit, injection fencing) → **externally reviewed**, which showed the integrity features
were internally consistent rather than tamper-evident, and the governance model wrong where a
corporate secretary looks first: no abstain, quorum measured over ballots instead of attendance,
deadline behaviors that never fired, a vote certificate whose verification was circular.

All of it was fixed, with tests watched failing first, and the fixes are what this document now
describes. The recurring "stored, displayed, never consulted" bug class is hunted mechanically in CI
(`check-dead-config.mjs` — its first run caught a fourth live instance: workflow stages promised an
approval type their votes never applied). Every claim below is re-derived from the code; if you find
one that is not, that is a bug — report it.

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

1. **Upload.** A document lands in the portal. Its text is extracted and persisted.
2. **Propose.** If an AI provider is configured, the AI classifies the document and drafts a
   *proposed* action — never an executed one — validated against a strict schema when queued and
   again when it runs.
3. **Approve — with the facts on the table.** The proposal sits in the secretariat's queue showing
   whether the AI's quoted passage was actually **found in the document**, and whether *you* have
   opened the source. A missing quote blocks approval unless you override with a reason; the
   override, the check result, and whether you viewed the source all land on the audit trail.
4. **Act & record.** The approved vote/task/meeting goes live, members are notified in real time,
   every step is written to an HMAC-keyed audit chain, and a closed vote gets an Ed25519-signed
   certificate.

Everything the AI can propose can also be created **manually** through the same validated contract —
the platform is fully usable with the AI off.

---

## What it does

**Voting — with the governance semantics a secretary will check**
- **Five ballot options** including **Abstain**: an abstention is a cast ballot — it counts toward
  quorum and closing, never toward approval, and drops out of the default majority denominator
  (majority of votes cast for-or-against, the Robert's Rules reading).
- **Quorum measured where it attaches**: meeting votes over **attendance** (present + proxy weight),
  circulation votes over ballots cast. Configurable per rule; the certificate records which basis
  decided the outcome.
- **Approval rules** — majority / two-thirds / three-quarters / unanimous / custom threshold, with
  configurable quorum and denominator bases. Unanimity defaults to the written-consent reading (all
  eligible members; an abstention defeats it).
- **Recusals are recorded facts**: who was excluded for a conflict of interest, and why, appears on
  the vote and its certificate — even for secret ballots. Distinct from abstention, and the UI says so.
- **Deadlines fire**: lapse (close over ballots received, certificate minted), extend once by a
  configurable window, or notify the secretary — enforced on every touch of an expired vote plus an
  hourly sweep, idempotent under concurrency.
- **Weighted voting** and **attributed proxy voting** (the ballot is recorded against the principal,
  stamped with who cast it; a principal casting in person supersedes their proxy).
- **Signed certificates (v3)**: a payload frozen at close — ballots, tally, bases, recusals,
  attendance snapshot — Ed25519-signed by the server key. Verification is **not circular**: it checks
  the stored hash, the signature, and the live rows independently, so flipping ballots in the
  database and re-hashing no longer passes. Legacy certificates still verify, labeled unsigned.

**Minutes & signatures**
- Draft, comment, sign. Each signer holds a **personal Ed25519 key** wrapped by a passphrase typed at
  signing and never stored — the server *cannot* sign for a director. Verify in-app or fully offline.
  eIDAS *advanced*, not *qualified* — [docs/SIGNING.md](docs/SIGNING.md) states the exact limits.

**Documents, meetings, tasks**
- Upload, classify, download board materials with **per-document access control** under one model:
  membership OR explicit grant, MINUS explicit deny — deny (recusal) always wins, everywhere,
  including the knowledge graph and search.
- Meetings with agendas and attendance (which the vote tally actually consults); tasks with
  assignees, evidence submission, and review.

**Platform**
- Real-time updates (Socket.IO), scoped to the affected board's members.
- **HMAC-keyed audit chain** with fail-closed writes: a mutation that cannot be audited rolls back;
  the chain is tamper-evident against database write access (see SECURITY.md for the exact boundary).
- Soft delete with retention snapshots; people who have acted in the record can be deactivated but
  never hard-deleted.
- Full-record export; optional SMTP for resets/invites; versioned SQL migrations applied at boot.

---

## Quick start (Docker)

Prerequisites: **Docker** (Desktop or Engine, both include Compose) and **Git**.

```bash
git clone https://github.com/LegalQuants/LQGovernance-OpenBoard.git
cd LQGovernance-OpenBoard
cp .env.example .env
```

Set the two secrets in `.env` (generate each with `openssl rand -hex 32`):

```
SESSION_SECRET=...            # signs login sessions — the server refuses to start without it
SERVER_SIGNING_SECRET=...     # keys the audit chain + signs vote certificates (required in production)
```

Keep `SERVER_SIGNING_SECRET` out of the database and its backups — the tamper-evidence story rests on
that separation. Then:

```bash
docker compose up -d --build
```

Open **http://localhost:3000**. First boot prints a one-time admin password to the log:

```bash
docker compose logs app | grep "One-time password"
```

Sign in as **`admin@openboard.local`** (override with `ADMIN_EMAIL`) and set a new password. Also
grab the **server signing key fingerprint** from the log and record it somewhere outside the system.

> Ports taken? Set `APP_PORT` / `DB_PORT` in `.env`. Want demo data? `DEMO_MODE=true` +
> `SEED_PASSWORD` before first boot — never in production.

---

## Turn on AI (optional)

Two paths, added to `.env`:

**Anthropic** — document text leaves your deployment, so it takes the key AND an explicit egress
acknowledgement (without it the path stays disabled even with a key present):

```
ANTHROPIC_API_KEY=sk-ant-...
AI_ALLOW_EXTERNAL_PROVIDER=true
```

**Local / OpenAI-compatible** (Ollama, vLLM, LM Studio, …) — text never leaves your network:

```
AI_PROVIDER=openai-compatible
AI_BASE_URL=http://localhost:11434/v1
AI_MODEL=llama3.1:70b
```

What the AI actually does, stated plainly: it classifies uploads against keyword-heuristic
descriptions (works on well-formed English board packs, degrades on unusual or multilingual ones),
proposes actions for human approval, and answers search questions over **excerpts of the persisted
document text** — fenced as untrusted data, matched by substring, not semantic retrieval. Every
proposal is schema-validated and quote-checked. Prompt injection is **mitigated, not solved** — the
approval queue and the human reading the rendered document are the real control (SECURITY.md).

---

## Deploy to production

Ships as a single Docker image + Compose. Turnkey HTTPS via the bundled Caddy:

```
NODE_ENV=production
DOMAIN=board.yourcompany.com
ACME_EMAIL=you@yourcompany.com
ALLOWED_ORIGIN=https://board.yourcompany.com
SERVER_SIGNING_SECRET=...   # production refuses to boot without it
```

```bash
docker compose --profile production up -d --build
```

Or one-click on Render ([`render.yaml`](render.yaml)), or bring your own proxy (forward `/api` +
`/socket.io` to port 3000; one proxy hop). Backups, upgrades, and operator-level encryption at rest:
**[DEPLOY.md](DEPLOY.md)**.

---

## Local development

Node 20.12+ (24 recommended), pnpm 11, Docker for the database.

```bash
pnpm install
cp .env.example .env        # set SESSION_SECRET; SERVER_SIGNING_SECRET optional in dev
docker compose up -d db
pnpm db:migrate
pnpm dev                    # API :3000 + frontend :5173 with hot reload
```

`pnpm typecheck`, `pnpm -r test` (integration suites need `DATABASE_URL`), `pnpm db:generate` after a
schema change, `node artifacts/api-server/scripts/check-dead-config.mjs` for the dead-config check
CI runs. Full workflow: [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Configuration

Everything is documented in [`.env.example`](.env.example). The load-bearing ones:

| Variable | Required | Purpose |
|---|---|---|
| `SESSION_SECRET` | **Yes** | Signs login sessions. The app will not start without it. |
| `SERVER_SIGNING_SECRET` | **Production** | Keys the audit chain (HMAC) + wraps the certificate-signing key. Dev runs without it in legacy-unsigned mode; production refuses to boot. Keep out of the DB and backups. |
| `DATABASE_URL` | Defaulted | PostgreSQL connection string. |
| `ANTHROPIC_API_KEY` + `AI_ALLOW_EXTERNAL_PROVIDER=true` | No | The external AI path — both required together, because document text leaves the deployment. |
| `AI_PROVIDER` / `AI_BASE_URL` / `AI_MODEL` | No | Local OpenAI-compatible inference instead. |
| `MFA_FRESHNESS_SECONDS` | No | How recently the second factor must be proven before signing/approving/exporting (default 900). |
| `NODE_ENV` / `ALLOWED_ORIGIN` / `DOMAIN` / `ACME_EMAIL` | Production | Secure cookies, CORS allowlist, automatic HTTPS. |
| `SMTP_*` / `APP_BASE_URL` | No | Outbound email for resets/invites; without it, links are logged. |
| `DEMO_MODE` / `SEED_PASSWORD` | No | Fictional demo org. Never in production. |

---

## Architecture

A pnpm monorepo building into one Docker image (Express serves the API, Socket.IO, and the SPA):

- `artifacts/easyboard` — React SPA (Vite).
- `artifacts/api-server` — Express API; `lib/` holds the tally math, the access model, signing,
  the audit chain, deadline enforcement; `scripts/` holds the independent offline verifiers.
- `lib/db` — Drizzle schema + versioned SQL migrations, applied at boot behind an advisory lock.
- `lib/api-spec` → `lib/api-zod` / `lib/api-client-react` — OpenAPI as the single contract; CI fails
  on codegen drift.

PostgreSQL, single organization per deployment; per-board membership is the isolation boundary.

---

## Security

The short version — the long one with the attacker models is **[SECURITY.md](SECURITY.md)**:

- Mandatory **TOTP 2FA**, re-proven before binding actions; bcrypt-12; durable lockout; revocable
  HttpOnly sessions.
- **Two signing identities**: per-user Ed25519 on minutes (the server cannot forge a director's
  signature), the server key on vote certificates (machine attestation the database alone cannot
  forge).
- **HMAC-keyed, fail-closed audit chain** — tamper-evident against database compromise; **not**
  against an actor who also owns the app server's environment. No external anchor yet.
- One access model with deny-wins recusals, enforced through the entity routes, the graph, and search.
- AI proposals channel-fenced, schema-validated, quote-checked at approval, always human-approved.
  Injection mitigated, not solved.
- **No application-level encryption at rest** (plan exists, not built). No independent professional
  audit yet — the reviews so far are documented in SECURITY.md's arc section.

Report vulnerabilities via a private
[GitHub Security Advisory](https://github.com/LegalQuants/LQGovernance-OpenBoard/security/advisories/new).

---

## Roadmap, contributing, license

- **Roadmap** — [open issues](https://github.com/LegalQuants/LQGovernance-OpenBoard/issues) track
  what's planned; [CHANGELOG.md](CHANGELOG.md) records what shipped.
- **Contributing** — welcome, especially from board administrators, corporate secretaries, and
  lawyers: the remaining open questions are governance-semantics defaults, and domain feedback is
  worth more than code. Start with [CONTRIBUTING.md](CONTRIBUTING.md).
- **License** — [MIT](LICENSE). No warranty; see SECURITY.md's assurance note.
