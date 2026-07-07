# Open Board

<p align="center">
  <h1 align="center">✦ Open Board</h1>
  <p align="center"><strong>The open-source, AI-native board management platform.</strong></p>
  <p align="center">Upload a document. The AI does the rest. You just approve.</p>
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> •
  <a href="#how-it-works">How It Works</a> •
  <a href="#features">Features</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#deployment">Deployment</a> •
  <a href="#security">Security</a> •
  <a href="#changelog">Changelog</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## What Is This?

Open Board is a board management platform built by a governance professional, not a software company. It replaces the traditional board portal model — where administrators manually create meetings, circulate documents, and track votes — with an AI-first approach where the system reads your documents and proposes the next actions.

**The AI is not an add-on. It is the product.**

Upload draft minutes → the AI extracts action items and proposes creating tasks with assignees and deadlines. Upload a board resolution → the AI proposes a circulation vote with the correct board and quorum rules. The Board Secretary reviews and approves. Everything else follows.

Every proposed action goes through the Secretary's approval queue. Nothing executes without human approval. This is human-in-the-loop governance by design.

> **⚠️ This is a beta.** It works. It has rough edges. Features are missing. Bugs exist. It's released early because governance tools need to step up their game. [Open an issue](https://github.com/SaifAlYounan/Open-Board/issues), break things, tell us what's wrong.

---

## Quick Start

**Requirements:** Node 24+, pnpm 9+, and PostgreSQL 16 (a one-command Postgres is included via Docker).

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
- **App** → `http://localhost:5173` (`WEB_PORT`) — **open this one.** The dev server proxies `/api` to the API, so the browser only talks to one origin (no CORS in dev).

Prefer separate terminals? Run `pnpm dev:api` and `pnpm dev:web`.

**First boot creates one admin account** with a **randomly generated one-time password
printed once to the API log** (`FIRST BOOT — admin account created. One-time password: …`).
Sign in with `ADMIN_EMAIL` (default `admin@openboard.local`) and that password; you'll be
**required to set a new password immediately**.

> The `.env` file is loaded automatically by both the server and `pnpm db:push`. Every variable
> is documented in [`.env.example`](.env.example). Real environment variables set by your shell or
> container always take precedence.

### Demo dataset (optional)

To explore with the fictional "Meridian Energy Group" board (20 people, 5 committees, sample
documents), set these in your `.env` before `pnpm db:push` / `pnpm dev`:

```bash
DEMO_MODE=true
SEED_PASSWORD=YourStrongDemoPassword123!
```

All demo users then share `SEED_PASSWORD`. **Never enable `DEMO_MODE` in production** — it seeds
login-capable accounts (including an admin) with a shared password.

> **Note:** The app works without an Anthropic API key. AI features show an info banner prompting
> you to configure one in Settings; all manual features work normally.

---

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│   Secretary uploads a document                      │
│          ↓                                          │
│   AI classifies it (minutes? resolution? evidence?) │
│          ↓                                          │
│   AI proposes actions (create meeting, task, vote)  │
│          ↓                                          │
│   Secretary reviews → Approve / Edit / Reject       │
│          ↓                                          │
│   Entity created → visible to the right people      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

The AI recognizes 7 document types:

- **Draft Minutes** — Extracts action items, attendees, resolutions. Proposes tasks with assignees and deadlines.
- **Resolution** — Extracts resolution text. Proposes a circulation or meeting vote with the correct board.
- **Financial Report** — Extracts key figures. Proposes attaching to the next relevant meeting.
- **Evidence / Deliverable** — Matches against open tasks. Proposes closing the task with reasoning.
- **Meeting Agenda** — Extracts all agenda items with types. Proposes creating the meeting with full agenda.
- **Legal Opinion** — Extracts conclusions. Flags as privileged. Links to relevant agenda items.
- **General** — Extracts summary and key topics. Stores without proposing actions.

Every proposed action goes through the Secretary's approval queue. Nothing executes without human approval.

---

## Features

### For the Board Secretary
- **AI Document Classification** — upload any PDF, DOCX, or TXT and let the AI parse it
- **Approval Queue** — review, edit, or reject every AI-proposed action before execution
- **Natural Language Commands** — "Schedule a BoD meeting for June 15 with ESG Review on the agenda"
- **Full Manual Control** — create meetings, votes, minutes, and tasks without AI
- **Minutes Lifecycle** — Draft → Review → Signing → Signed with paragraph-level comments
- **Board Intelligence** — searchable knowledge graph across all governance data. Type a project name and see every related vote, meeting, document, task, and person. Project Tracker shows governance status at a glance. Decision Timeline plots every vote chronologically. Quick filters for open votes, overdue tasks, and recent decisions
- **Custom Approval Rules** — unanimous, majority, two-thirds, quorum, recusals

### For Board Members
- **Zero-Friction Dashboard** — pending votes, minutes to sign, next meeting at a glance
- **AI Search** — "When did we discuss Kazakhstan?" → answer with source links
- **Vote in 2 Clicks** — 4 options: Approved, Approved with Comments, Not Approved, Not Approved with Comments
- **Sign in 1 Click** — SHA-256 integrity hashes for vote and minutes verification
- **Comment on Minutes** — paragraph-level comments during review period

### For Management
- **Task Dashboard** — assigned tasks with source links back to board minutes
- **Evidence Upload** — submit deliverables; AI reviews against task requirements
- **Board Decisions View** — read-only access to decisions that affect your work

### For Observers
- **Read-Only Access** — view meetings, votes, and documents you're granted access to
- **Per-Document Access Control** — Secretary can exclude individual members from specific documents (conflict-of-interest recusal)
- **Secret Ballot** — votes can be marked as secret; individual votes visible only to the Secretary and the voter themselves
- **Comment on Minutes** — participate in the review process
- **AI Search** — search within your access scope

---

## Architecture

```
Layer 0 — Document Brain         (invisible — AI classification engine)
Layer 1 — Secretary Interface    (AI copilot + approval queue)
Layer 2 — Board Member Interface (zero friction — vote, sign, search)
Layer 3 — Management Interface    (tasks + evidence upload)
Layer 4 — Observer Interface      (read-only + comments)
```

### Tech Stack

- **Backend:** Node.js, Express 5
- **Database:** PostgreSQL + Drizzle ORM
- **Frontend:** React 18, Vite, Tailwind CSS, Radix UI
- **Routing:** Wouter (frontend), Express Router (backend)
- **AI:** Anthropic Claude Opus 4 (via @anthropic-ai/sdk)
- **Auth:** JWT (jsonwebtoken) + bcryptjs — tokens in HttpOnly secure cookies (not localStorage) + `cookie-parser` middleware
- **Real-time:** Socket.io (authenticate-on-handshake, board membership-verified room joins)
- **Documents:** multer, pdf-parse, mammoth
- **Signatures:** SHA-256 (Node.js crypto)
- **Validation:** Zod schemas, custom `pick()` utility for field allowlisting, UUID format validation on all route parameters
- **Security:** Helmet (CSP, HSTS, X-Frame-Options, etc.), sanitize-html (backend), DOMPurify (frontend)
- **Package Manager:** pnpm monorepo (6 workspaces)

### Database

20+ tables covering organizations, boards, people, board memberships, meetings, agenda items, votes, vote records, minutes, minutes signatures, minutes suggestions, tasks, task evidence, documents, access control, approval rules, approval workflows, pending actions, attendance, audit trail, and password reset tokens.

Full schema in `lib/db/src/schema/`.

---

## Accounts

**On a real (non-demo) first boot**, the seed creates a **single Board Secretary (admin)** account. Its email is `ADMIN_EMAIL` (default `admin@openboard.local`) and its password is a **random one-time password printed once to the server log**:

```
FIRST BOOT — admin account created. One-time password: <random> — log in and change it immediately.
```

Log in with that, and you'll be prompted to set a real password. Create the rest of your board from the Admin panel.

### Demo dataset (opt-in)

Set `DEMO_MODE=true` **and** `SEED_PASSWORD=<something>` before seeding to load the fictional demo below. **Never enable `DEMO_MODE` in production** — it creates login-capable accounts (including an admin) that all share `SEED_PASSWORD`.

The demo is a fictional company (**Meridian Energy Group** — $4.2B renewable energy, Abu Dhabi) with 20 users across 4 roles and 5 boards, plus rich demo data telling the story of 3 interconnected projects:

- **Project Zephyr** (Kazakhstan 1GW Wind Farm) — devex approval → EPC shortlist → FID at $1.2B → steel cost overrun → revised FID at $1.4B → forensic procurement investigation
- **Project Aurora** (SolarTech Acquisition) — market scan → LOI → due diligence reveals IP dispute + customer concentration → binding offer at $280M
- **ESG & Compliance** (Project Lighthouse) — regulator-appointed observer flags emissions data discrepancy → independent audit → CEO bonus reduction → whistleblower policy adopted

20 meetings across 5 committees, 18 votes (including secret ballots and open votes), 28 documents, 25 tasks, and 14 sets of minutes — all cross-linked. The Board Intelligence page visualizes these relationships as a searchable knowledge graph.

**Secretary:**
- Ahmed Al-Rashid — a.alrashid@meridian-energy.com — Board Secretary

**Board Members (7):**
- Nadia Petrov — n.petrov@meridian-energy.com — Chairperson
- Sarah Chen — s.chen@meridian-energy.com — Independent Director
- Dr. Klaus Weber — k.weber@meridian-energy.com — Independent Director
- Fatima Al-Hosani — f.alhosani@meridian-energy.com — Non-Executive Director
- James O'Brien — j.obrien@meridian-energy.com — Independent Director
- Yuki Tanaka — y.tanaka@meridian-energy.com — Independent Director
- Maria Santos — m.santos@meridian-energy.com — Non-Executive Director

**Observers (4):**
- David Park — d.park@meridian-energy.com — External Legal Counsel
- Amira Khalil — a.khalil@meridian-energy.com — External Auditor
- Thomas Henderson — t.henderson@meridian-energy.com — Regulatory Advisor
- Laura Martinez — l.martinez@meridian-energy.com — External Tax Counsel

**Management (8):**
- Robert Taylor — r.taylor@meridian-energy.com — CFO
- Priya Sharma — p.sharma@meridian-energy.com — General Counsel
- Li Wei — l.wei@meridian-energy.com — VP Strategy
- Omar Mansour — o.mansour@meridian-energy.com — VP Operations
- Elena Rossi — e.rossi@meridian-energy.com — Head of Compliance
- Jun Kim — j.kim@meridian-energy.com — Head of HR
- Sophie Blanc — s.blanc@meridian-energy.com — Head of ESG
- Raj Nair — r.nair@meridian-energy.com — CTO

**All demo passwords:** whatever you set as `SEED_PASSWORD` when seeding with `DEMO_MODE=true`.

**5 Boards:** Board of Directors (BoD), Finance & Audit Committee (FAC), Strategy & Investment Committee (SIC), Nomination & Remuneration Committee (NRC), Technical & Projects Committee (TPC).

---

## Security

Open Board is designed for organizations that take data sovereignty seriously.

- **Self-hosted** — your data stays on your servers, in your jurisdiction
- **Zero external dependencies at runtime** — fonts bundled locally, no CDN calls, no telemetry
- **AI is pluggable** — use Anthropic's API, or swap in a local model. Your documents, your choice
- **Mandatory JWT secret** — app refuses to start without `SESSION_SECRET`; no hardcoded fallbacks

### Authentication & Sessions
- **HttpOnly JWT cookies** — tokens stored exclusively in HttpOnly secure cookies, never in localStorage. `Secure` and `SameSite=Strict` are set in production; terminate TLS at your reverse proxy.
- API accepts `Authorization: Bearer <token>` header for programmatic access
- JWT refresh endpoint (`/api/auth/refresh`) for session renewal without re-authentication
- Session restoration endpoint (`/api/auth/me`) for cookie-based session lookups
- 7-day token expiry; environment-aware cookie settings (secure + strict in production, lax in development)
- **Limitation:** Logout clears the cookie client-side but does not invalidate the JWT server-side. A stolen token remains valid until expiry. Server-side token revocation is planned.


### Input Sanitization
- **Backend:** `sanitize-html` on all text inputs — two modes: plain text (all HTML stripped) and rich HTML (restricted allowlist: `b`, `i`, `u`, `strong`, `em`, `p`, `br`, `ul`, `ol`, `li`, `h1`–`h4`, `a`, `blockquote`, tables)
- **Frontend:** `DOMPurify` sanitizes all rendered HTML content (e.g., minutes paragraph blocks) before display

### Request Hardening
- **1 MB JSON/URL-encoded body size limit** on all API endpoints
- **10 MB maximum file upload size** (PDF, DOCX, TXT only — MIME type + extension validated)
- **UUID format validation** on all route parameters — invalid UUIDs return 400 immediately
- **`pick()` utility** on all mutation endpoints strips unknown fields from request bodies, preventing mass-assignment attacks

### Path Traversal Protection
- All file paths resolved and validated to be within the `uploads/` directory before any read operation

### Account Security
- **Password complexity:** minimum 12 characters enforced on all password creation and reset flows
- **bcrypt** password hashing (cost factor 10)
- **Account lockout:** 30 failed login attempts → 24-hour automatic lockout (Secretary can reset)
- **Password reset:** SHA-256-hashed one-time token (1-hour expiry); new password hashed with bcrypt before storage; no email service — Secretary relays reset link manually

### Rate Limiting (multi-layer)
- **Auth endpoints:** 10 attempts/15 min per IP + 10 attempts/15 min per email address (independent limits)
- **AI endpoints:** 20 requests/min per authenticated user
- **Write endpoints:** 30 requests/min per authenticated user

### Access Control
- **Per-entity access control** — every meeting, vote, document, and task has explicit access grants with DB-level uniqueness constraints
- **Composite index** `access_control_entity_lookup` on `(entityType, entityId)` for fast permission lookups
- **Board membership verification** on all sensitive operations; admins always pass

### WebSocket Security (Socket.io)
- Connections authenticated at **handshake** via HttpOnly cookie — unauthenticated connections rejected before any event is processed
- Room join events (`join:board`, `join:vote`, `join:minutes`) verified against board membership or access control; no membership = no join
- Join rate limit: 10 room joins per minute per socket connection

### Security Headers
- **Helmet** middleware enables Content Security Policy, HSTS, X-Frame-Options, MIME type sniffing protection, and other OWASP-recommended HTTP headers

### Data Integrity
- **Full audit trail** — every login, logout, password action, document event, and data reset logged with actor ID, entity, timestamp, and client IP
- **SHA-256 integrity hashes** — checksums on vote results and minutes for change detection
- **CORS protection** — strict origin validation. In development it accepts `localhost` only; in production `ALLOWED_ORIGIN` is **required** (comma-separated allowlist, e.g. `ALLOWED_ORIGIN=https://board.yourcompany.com`) and there is no wildcard fallback.
- **System reset** requires admin + `{ confirm: "RESET" }` in request body + wrapped in a database transaction (FK-safe delete order)
- **No CLOUD Act exposure** — when self-hosted, no foreign government can compel a vendor to produce your board documents

For a detailed comparison of open-source vs. proprietary board portal security, see [SECURITY.md](SECURITY.md).

---

## Deployment

### Environment Variables

- `DATABASE_URL` (required) — PostgreSQL connection string
- `SESSION_SECRET` (required) — Random 64-character hex string for JWT signing. App refuses to start without it.
- `ANTHROPIC_API_KEY` (optional) — Enables AI features. App works without it.
- `ALLOWED_ORIGIN` — CORS origin allowlist (comma-separated). **Required in production**; development defaults to `localhost`.
- `SEED_PASSWORD` (optional) — Override default demo password.
- `PORT` (optional) — Default: 3000

### Production Considerations

- **Database:** Use a managed PostgreSQL instance (Neon, Supabase, RDS). Schema is standard PostgreSQL.
- **File Storage:** Replace `/uploads/` with S3-compatible object storage for production.
- **Auth:** HttpOnly secure cookies with mandatory `SESSION_SECRET`. JWTs support refresh and session restoration endpoints. Consider short expiry (15 min access + 7 day refresh) for higher security.
- **Rate Limiting:** Built in — per-IP and per-email limits on auth, per-user limits on AI and write endpoints.
- **CORS:** Set `ALLOWED_ORIGIN` to your production domain.
- **Seed Password:** Set `SEED_PASSWORD` env var for production demos. Change passwords after first login.

---

## Security Audit Status

> ⚠️ **Open Board is a working beta.** It demonstrates the AI-native governance pattern and is suitable for evaluation, demos, and feedback. Complete your own security review before using it with real board data.

Open Board has undergone thirteen rounds of security auditing. Rounds 1–10 used automated AI agents (MiniMax M2.7 via OpenClaw); Round 11 was a full static audit by Claude Opus 4.6; Round 12 verified those fixes; **Round 13 (Claude Fable 5) was a three-agent audit — backend security, AI pipeline, and product/UX — followed by a full remediation pass**, and is the current state of the codebase.

### Round 13 — Multi-agent audit + remediation (Claude Fable 5)

A three-lens audit (security / AI pipeline / UX) followed by fixes. Highlights of what changed:

- **Seeding (critical):** demo users are no longer created in production. Demo data (20 users sharing one password) is gated behind `DEMO_MODE=true`; a real first boot creates a single admin with a random one-time password and forces a reset. The committed `SEED_PASSWORD="0000"` and the `migrateUpdatePasswords` restart-wipe were removed.
- **Session revocation:** a per-user token version invalidates every outstanding JWT the moment a password is changed or an account is deactivated. Deactivated users lose access immediately (was: valid until 7-day expiry). Sockets re-check role/active from the DB, not the token.
- **Authorization:** `GET /people/:id` is scoped to the requester's shared boards with trimmed fields (was: any user could enumerate everyone).
- **AI action validation:** every AI-proposed action is validated against a strict Zod schema **before it is queued and again before it executes**; unknown action types are rejected (closes the mass-assignment sink). Execution is now transactional, resolution/task numbering is race-free (Postgres sequences), and each proposal carries a verbatim source quote for provenance.
- **Governance integrity:** the pending-action reject endpoint is idempotent; admins can no longer force a vote to approved/rejected (outcomes come from the votes cast); confidentiality flagging is implemented.
- **Audit trail:** writes are awaited for security-relevant mutations and **hash-chained** (each row carries a SHA-256 of the previous), with the real client IP (`req.ip`) instead of the spoofable `X-Forwarded-For`.
- **Transport / AI cost:** `ALLOWED_ORIGIN` is required in production (dev default is localhost-only, no wildcard); a daily AI-call budget cap; input length limits + null-byte stripping.
- **Engineering:** the entire monorepo now **type-checks, unit-tests (Vitest), and builds** — none of which passed before — with a GitHub Actions CI pipeline (typecheck + spec-drift check + tests + build) and structured outputs on Claude Opus 4.8.

### Prior posture (Rounds 1–12)

**Rounds 1–10** (automated agents, 3 per round): identified and fixed 70+ endpoint-level vulnerabilities including authentication bypasses, access control gaps, input validation failures, and broken workflows. All endpoint-level findings from rounds 1–10 have been fixed and regression-verified.

**Round 11** (multi-model review): The codebase was independently reviewed by Claude Opus 4.6 (full static audit) and MiniMax M2.7 (3 agents: security, code review, E2E). Opus identified 4 catastrophic, 11 critical, and 23 high-severity architectural issues. MiniMax agents found 0 issues in the same codebase — demonstrating that endpoint-level automated testing cannot catch architectural and design-level flaws. Manual source code verification confirmed all 4 catastrophic and most critical findings as real. Partial fixes applied in v2.8.

**Round 12** (post-fix verification): 4 MiniMax M2.7 agents verified v2.8 fixes. 10 of 12 applied fixes confirmed working. 2 fixes did not land as intended (reject idempotency missing, admin force-approve still possible). See v2.8 changelog for details.

### Audit History

**Rounds 1–4:** Found and fixed all endpoint-level auth/authz issues (WebSocket auth, board IDOR, CORS, JWT in localStorage, seed password, AI search scope).
**Rounds 5–7:** Found and fixed validation gaps (enum mismatches, missing rate limits, pagination, UUID validation, workflow triggers).
**Round 8** (verification): All 61 regression items verified fixed. Zero new endpoint-level findings.
**Round 9** (adversarial red team): 0 critical, 0 high, 2 medium, 4 low. Documented as known limitations.
**Round 10** (post-launch): Verified secret ballot, document access, auto-attach, task retry. Found and fixed 2 issues (certificate endpoint filter, AI destructuring).
**Round 11** (multi-model review): Opus 4.6 flagged 4 catastrophic, 11 critical, 23 high. MiniMax M2.7 (3 agents) found 0 new issues in the same codebase — a significant methodology gap. Manual verification confirmed all 4 catastrophic and most critical findings as real. v2.8 addresses 8 of the 15 most-severe items fully, 2 partially, with 5 still open.
**Round 12** (post-fix verification): 4 MiniMax M2.7 agents re-tested after v2.8. Confirmed 10 of 12 applied fixes are working correctly. Identified 2 fixes that did not land as described (reject idempotency, admin force-approve).

### What Was Wrong (and fixed)

These vulnerabilities existed in earlier versions. They have been found and fixed across rounds 1–4:

- **WebSocket had zero authentication.** Any visitor could connect and listen to live board events (vote closures, minute signatures, comments) without logging in. *Fixed: authenticate at handshake, verify board membership on room joins.*
- **Any user could read any board's data.** No access control on board detail, vote detail, meeting detail, minutes comments, document metadata, or task endpoints. An observer on one board could read every other board's membership, votes, and documents. *Fixed: board membership checks on all endpoints.*
- **Vote certificates were publicly accessible.** Who voted how, accessible to anyone with the URL. *Fixed: access control on certificate endpoint.*
- **CORS was wide open.** `origin: "*"` — any website could make authenticated API requests. *Fixed: strict origin validation with allowlist.*
- **JWT tokens were in localStorage.** Readable by any XSS. *Fixed: HttpOnly secure cookies.*
- **JWT token was returned in login response body.** XSS could read the response. *Fixed: login response now only contains user data; token is exclusively in the HttpOnly cookie.*
- **No request body size limits.** Unlimited JSON payloads accepted. *Fixed: 1MB limit.*
- **System reset had no confirmation.** One POST and all data gone. *Fixed: requires admin + `{ confirm: "RESET" }` + database transaction.*
- **AI search exposed the entire database.** Any user's AI query got context from ALL boards, ALL people, ALL meetings — regardless of access. *Fixed: scoped to user's accessible entities.*
- **Seed script had a hardcoded fallback password.** If `SEED_PASSWORD` wasn't set, it silently used a default. *Fixed: fail-fast if env var missing.*
- **Error handlers were silently swallowing errors.** `.catch(() => {})` on workflow triggers. *Fixed: proper error logging.*
- **Minutes signing workflow was completely broken.** Frontend and backend used different status names. The sign endpoint required a status that could never be reached. *Fixed: aligned status enums across frontend, backend, and database.*
- **Management users bypassed meeting access control.** The meeting detail endpoint explicitly exempted management from board membership checks. *Fixed: management users now subject to the same board membership checks as other roles.*
- **Observer minutes navigation was a dead link.** Observers clicking published minutes got a 404. *Fixed: observer-accessible minutes route added.*
- **Multiple PATCH/POST endpoints accepted arbitrary strings** for status, type, and role fields. *Fixed: enum validation on all status, type, and role fields across votes, meetings, minutes, tasks, people, and agenda items.*
- **No pagination on list endpoints.** All records returned with no limit. *Fixed: pagination with configurable limit (max 200) on all list endpoints.*
- **No rate limiting on read endpoints.** Mass enumeration possible. *Fixed: global read rate limiter applied.*
- **Password reset tokens logged in plaintext.** *Fixed: only token hash logged for audit trail.*
- **Password reset token was returned in API response body.** *Fixed: response no longer contains the token.*
- **Task number race condition under concurrent load.** *Fixed: retry logic on unique constraint violation.*
- **Missing UUID validation on documents and workflows routes.** *Fixed: UUID validation applied to all routes.*
- **Workflows endpoints missing write rate limiter and pagination.** *Fixed: writeLimiter and pagination added.*
- **AI-proposed vote type not validated in pending actions.** *Fixed: validated against enum before execution.*
- **`roleInBoard` accepted arbitrary strings.** *Fixed: validated against allowed roles.*
- **Management users could read any minutes via direct ID.** List was scoped but detail endpoint bypassed board membership. *Fixed: board membership check on both list and detail.*
- **Document filenames stored unsanitized.** *Fixed: special characters stripped on upload.*
- **Vote type enum mismatch.** Backend used `["simple","resolution","election","special"]` but frontend sends `"circulation"` and `"meeting"`. *Fixed: enum includes all valid types.*
- **Body size limit returned wrong HTTP status.** Payloads over 1MB returned 500 instead of 413. *Fixed: proper error handler for Express 4 and 5.*
- **Source maps generated in production build.** *Fixed: disabled in build configuration.*
- **Board role dropdown used wrong values.** Frontend sent `"chair"` but backend expected `"chairperson"`. *Fixed: dropdown values aligned with backend.*

### Known Limitations & Open Issues

Documented for transparency.

**Fixed in Round 13 (removed from Known Limitations):**
- ~~AI action approval lacks transaction wrapping~~ → `executeAction` runs in a DB transaction; the approve also writes an audit entry.
- ~~AI executor trusts action data without schema validation~~ → strict Zod validation at queue time **and** approve time; unknown action types rejected.
- ~~Admin can force vote status via PATCH~~ → direct admin transitions to approved/rejected are blocked; outcomes come from the votes cast.
- ~~Reject endpoint has no idempotency check~~ → returns 409 on an already-resolved action.
- ~~Confidentiality flagging is a silent stub~~ → implemented (marks the document confidential + audit entry).
- ~~`migrateUpdatePasswords` restart password-wipe + committed `SEED_PASSWORD="0000"`~~ → both removed; demo seeding is gated behind `DEMO_MODE=true`.
- ~~No server-side JWT invalidation~~ → per-user token version revokes all outstanding JWTs on password change / deactivation.
- ~~CORS allows any `*.replit.app` subdomain~~ → the shared-suffix wildcard fallback was removed; `ALLOWED_ORIGIN` is required in production and dev accepts localhost only.
- ~~Audit log records proxy IP, not client IP~~ → uses `req.ip` (resolved under `trust proxy`), which can't be spoofed via `X-Forwarded-For`.
- ~~No character limit on titles / null bytes return 500~~ → text inputs are length-capped (500) and control characters stripped.

**Fixed earlier (Rounds 1–12):**
- ~~Certificate hash covers summary only~~ → includes sorted vote records.
- ~~Vote cast ignores per-entity access control~~ → `hasAccess()` check added.
- ~~Login timing reveals email existence~~ → dummy bcrypt compare (~400ms both paths).
- ~~AI search leaks all minutes for users with no access records~~ → returns empty results.
- ~~AI classifier auto-grants board access without approval~~ → removed; goes through pending actions.

**Still open:**
- **Weighted voting and proxy voting** are in the database schema but not implemented in application logic — they are stubs that silently do nothing.
- **Password-reset email delivery is not wired in.** The reset-token flow generates single-use, hashed, 1-hour tokens, but there is no mail transport — an operator must relay the token out of band (or an admin creates a fresh account). Wire up email for production.
- **Account lockout is in-memory.** A server restart resets the per-account lockout counters (the password-wipe that used to compound this is gone).
- **Open ballots are the default.** Votes are visible to board members unless the Secretary enables "Secret Ballot" on creation.
- **Vite has flagged npm audit warnings.** All are in Vite, the build tool — it never runs in production. Run `pnpm update` to resolve.

---

## Self-Hosting Guide

Open Board is designed to run on your own infrastructure. Before deploying to production, make these changes:

### 1. Environment Variables (Required)

Set these in your server environment. **Do not commit them to source control.**

| Variable | Purpose | Example |
|----------|---------|---------|
| `SESSION_SECRET` | **Required.** Signs JWT tokens. Server refuses to start without it. | `openssl rand -hex 64` |
| `DATABASE_URL` | **Required.** PostgreSQL connection string. | `postgresql://user:pass@host:5432/openboard` |
| `ALLOWED_ORIGIN` | **Required in production.** Comma-separated allowlist of frontend origins for CORS. | `https://board.yourcompany.com` |
| `NODE_ENV` | Set to `production` for secure cookies + to require `ALLOWED_ORIGIN`. | `production` |
| `PORT` | **Required.** API server port. | `3000` |
| `WEB_PORT` | *(Dev)* Vite dev/preview server port. Defaults to `5173`. | `5173` |
| `BASE_PATH` | *(Optional)* Sub-path the SPA is served under. Defaults to `/`. | `/` |
| `ANTHROPIC_API_KEY` | *(Optional)* Enables AI features. App works without it. | `sk-ant-...` |
| `AI_MODEL` | *(Optional)* Which Claude model the AI uses. | `claude-opus-4-8` (default) |
| `AI_DAILY_CALL_LIMIT` | *(Optional)* Daily ceiling on AI calls (cost guard). | `1000` (default) |
| `AI_INTEGRATIONS_ANTHROPIC_API_KEY` | *(Optional)* Preferred key name (takes precedence over `ANTHROPIC_API_KEY`). | `sk-ant-...` |
| `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` | *(Optional)* Point at an Anthropic-compatible gateway to self-host the model. | `https://…` |
| `ADMIN_EMAIL` | *(Optional)* Email for the first-boot admin account. | `secretary@example.com` |
| `ORG_NAME` | *(Optional)* Organization name shown in the UI. | `Your Organization` |
| `LOG_LEVEL` | *(Optional)* Log verbosity: `trace`\|`debug`\|`info`\|`warn`\|`error`. Defaults to `info`. | `info` |
| `DEMO_MODE` | *(Optional)* `true` seeds the Meridian demo dataset. **Never `true` in production.** | *(unset)* |
| `SEED_PASSWORD` | *(Demo only)* Shared password for demo accounts when `DEMO_MODE=true`. | `YourStrongPassword123!` |

### 2. First-Boot Admin & Real Users

On a fresh database with `DEMO_MODE` unset, the first boot creates **one admin** (`ADMIN_EMAIL`) with a random one-time password logged once to the console. Log in, change the password when prompted, then add your real board from the Admin panel. Don't set `DEMO_MODE` in production.

### 3. The Data-Reset Tab

The Admin → System tab has a "Reset All Data" action. The server (`POST /api/system/reset-data`) requires admin authentication **and re-verifies the admin's own password** server-side before wiping transactional data. For production you may still prefer to remove the System Reset tab entirely (`artifacts/easyboard/src/pages/secretary/admin.tsx`) — production boards rarely need a "wipe everything" button.

### 4. Configure CORS

In production, `ALLOWED_ORIGIN` is **required** — set it to your exact frontend origin(s):
```
ALLOWED_ORIGIN=https://board.yourcompany.com
```
Outside production, the app accepts `localhost` only.

### 5. Enable Trust Proxy

If running behind a reverse proxy (nginx, Cloudflare, AWS ALB), add this line to `artifacts/api-server/src/app.ts`:

```typescript
app.set('trust proxy', 1);
```

This ensures audit logs record the real client IP instead of the proxy's IP.

### 6. Database

Open Board uses PostgreSQL. For production:

- Use a managed PostgreSQL instance (AWS RDS, Google Cloud SQL, etc.) or a hardened self-hosted install
- Enable SSL connections
- Set up automated backups
- Push the schema: `pnpm db:push`

### 7. AI Features (Optional)

AI features (document classification, semantic search, task suggestions) require an Anthropic API key. If you don't set `ANTHROPIC_API_KEY`, the app works normally — AI features are simply disabled.

If you do use AI: your documents are sent to Anthropic's API for processing. Review Anthropic's data policy and ensure it meets your governance requirements.

### 8. Security Checklist Before Go-Live

- [ ] `SESSION_SECRET` is a random 64+ character string (not `"secret"` or `"password"`)
- [ ] `SEED_PASSWORD` is strong or demo accounts are removed
- [ ] `ALLOWED_ORIGIN` is set to your exact domain (not wildcard)
- [ ] `NODE_ENV=production` is set
- [ ] System Reset tab is removed or password is changed
- [ ] Database is on a private network with SSL enabled
- [ ] HTTPS is enforced (via reverse proxy or platform)
- [ ] Backups are configured and tested
- [ ] Run `pnpm audit` and resolve any flagged vulnerabilities

---

## Changelog

### v3.0 — Round 13 audit + remediation (Claude Fable 5)

A three-agent audit (backend security, AI pipeline, product/UX) and a full remediation pass.

**Security**
- Demo seeding gated behind `DEMO_MODE=true`; real first boot creates one admin with a random one-time password (forced reset). Removed committed `SEED_PASSWORD="0000"` and the `migrateUpdatePasswords` restart-wipe.
- Per-user token version invalidates all outstanding JWTs on password change / deactivation; deactivated users lose access immediately; sockets re-check role/active from the DB.
- `GET /people/:id` scoped to shared boards with trimmed fields; board-membership inputs validated.
- Hash-chained audit trail with real client IP; audit events added on approve/reject, people, and membership changes.
- `ALLOWED_ORIGIN` required in production; vote-doc download path-containment; generic client error messages; daily AI-call budget cap; input length limits + null-byte stripping.

**AI pipeline**
- Upgraded to Claude Opus 4.8 (`AI_MODEL`-overridable) with structured outputs; one Zod contract validates every AI action at queue time and approve time (unknown types rejected).
- Evidence review now uses real text extraction (was reading PDFs as raw bytes); extraction failures surfaced with Retry; source-quote citations on proposals; transactional execution; race-free numbering; adaptive thinking + prompt caching.

**Governance & UX**
- Reject-endpoint idempotency; admins can no longer force a vote outcome; confidentiality flagging implemented.
- Fixed the board vote-certificate field bug and the secret-ballot leak in the certificate PDF; corrected the vote tally; timezone-safe dates app-wide.
- Mobile-responsive secretary sidebar (drawer) and grids; consistent error/loading states; accessible AI-search modal with role-aware source links; destructive-action confirmations; honest AI/marketing copy; de-hardcoded org identity.

**Engineering**
- The entire monorepo now type-checks, unit-tests (Vitest), and builds — none did before — with a GitHub Actions CI pipeline (typecheck + OpenAPI spec-drift check + tests + build).

### v2.9 — Board Intelligence & Rich Demo Data (April 11, 2026)

- **Board Intelligence page** — new `/secretary/intelligence` route with searchable governance knowledge graph. Default view shows a summary dashboard with stat cards, project tracker, and decision timeline. Search or click a quick filter to see a focused D3.js force-directed graph showing only relevant entities and their connections. Detail sidebar shows all connected entities for any selected node.
- **Project Tracker** — groups governance entities by project (detected via title keywords). Each project card shows meeting count, vote count, document count, task status, and latest activity. Status indicators: ⚠️ Under Investigation, 🟡 In Progress, 🔧 Remediation Underway.
- **Decision Timeline** — horizontal chronological view of all board votes, color-coded by outcome (approved, rejected, open), filterable by board.
- **Quick filters** — one-click filters for Project Zephyr, Project Aurora, ESG & Compliance, Open Votes, Overdue Tasks, Recent Decisions.
- **Rich demo data** — seed script now creates 3 interconnected project narratives (Kazakhstan wind farm, SolarTech acquisition, ESG compliance investigation) spanning 20 meetings, 18 votes, 28 documents, 25 tasks, and 14 minutes sets across 5 committees. Replaces generic placeholder data.
- **Test account cleanup** — removed 10 leftover accounts from security testing rounds. Fixed observer role assignment.

### v2.8 — Partial Security Fixes (April 9, 2026)

Addresses some findings from Round 11 multi-model review (Opus 4.6). Of the 15 most-severe findings, 8 are fully fixed, 2 partially fixed, 4 untouched, and 1 fix attempted but not yet landed. Architectural items (transaction wrapping, schema validation, JWT revocation, multi-tenant) remain open — they require a validation-layer refactor estimated at 1–2 days.

**Fully fixed (8):**
- **Fixed undefined `res` reference** in AI action executor — invalid vote type errors now throw properly instead of crashing the process.
- **Added idempotency check on approve** — AI action approval now verifies the action is still "pending" before executing. Prevents duplicate entity creation. *(Note: the reject endpoint does not yet have this check.)*
- **Expanded certificate hash** — SHA-256 now covers sorted individual vote records `{personId, decision}`, not just the summary. Tampering with vote records invalidates the hash. *(Note: this is a hash, not a digital signature — a database-level attacker could recompute it.)*
- **Fixed AI search data leak** — users with no access records now see nothing (was: all non-draft minutes).
- **Added access control to vote document upload** — only admin or board members with vote access can upload.
- **Recusal enforcement on cast** — `hasAccess()` check added to vote cast endpoint.
- **Fixed path traversal check** — download endpoint now uses trailing separator in `startsWith`.
- **Document board assignment requires approval** — AI classification no longer auto-grants board access; goes through pending actions.

**Partially fixed (2):**
- **`migrateUpdatePasswords` gated but not removed.** Added `NODE_ENV === "production"` guard — the function no longer runs in production. However, it still exists in the code and still runs in development, staging, and any environment where `NODE_ENV` is not explicitly set to `"production"`. The `.replit` file still hardcodes `SEED_PASSWORD (set in Replit Secrets)`. Self-hosters who forget to set `NODE_ENV` will still have all passwords wiped on every restart. Full removal is the correct fix.
- **Login timing equalized** — dummy bcrypt compare when email not found. Timing is now ~400ms for both existing and non-existing emails. *(Note: account lockout counters are still in-memory and reset on server restart.)*

**Not yet fixed (5):**
- **Admin can still force-approve votes via PATCH.** The status guard added in this version only blocks transitions on already-closed votes. An admin can still PATCH an open vote to `"approved"` with zero votes cast, and the expanded certificate hash now covers the empty record set — lending false cryptographic credibility to the forgery. Fix pending.
- **AI action executor has no transaction wrapping, no audit log on approve/reject, and accepts unvalidated fields via mass assignment.** The idempotency check was added, but the core `executeAction` function remains architecturally unchanged.
- **Reject endpoint has no idempotency check.** An already-approved action can be overwritten to "rejected."
- **Weighted voting, proxy voting, and confidentiality flagging** remain in the schema and code as stubs. They are not implemented. *(See Known Limitations.)*
- **CORS still allows any `*.replit.app` subdomain with credentials.** Any Replit-hosted page can make authenticated API requests to the demo.

### v2.7 — Secret Ballot & Stability Fixes (April 9, 2026)

- **Secret ballot** — votes can now be marked as secret. When enabled, board members can only see their own vote and aggregate results. Individual votes are visible only to the Secretary. Certificates for secret ballots show counts without names. Toggle available on vote creation form.
- **Task number collision fix** — approving AI-proposed tasks no longer crashes when the suggested task number already exists. Automatic retry with incremented numbers (up to 5 attempts).
- **Document access auto-grant** — uploaded documents now automatically grant access to all board members once AI classification identifies the target board. Previously, only the uploading admin had access.
- **Workflow document attachment** — auto-attach now works for AI-created workflows (attaches source document to the first workflow vote), not just standalone votes and meetings.
- **Trust proxy** — Express now reads real client IPs from `X-Forwarded-For` behind reverse proxies. Audit logs show actual user IPs instead of proxy IP.

### v2.6 — Document Management & Access Control (April 9, 2026)

New features and improvements following public launch:

- **Document download route** — `GET /api/documents/:id/download` now serves files with proper Content-Type, Content-Disposition, path traversal protection, access control checks, and audit logging. Previously returned "Cannot GET."
- **Per-document access control** — Secretary can now toggle access for individual board members on any document via a new UI panel. Enables conflict-of-interest recusal: exclude a director from seeing specific materials while keeping their access to everything else on the board.
- **Auto-attach documents to AI-created entities** — when the AI proposes a meeting or vote from an uploaded document and the Secretary approves, the source document is automatically linked to the created entity. Board members can now see and download the supporting document directly from the board room.

### v2.5 — Final Polish (April 9, 2026)

Addresses all findings from Rounds 6–7. Verified clean by Round 8 (zero findings across 3 independent agents).

- **Body size error handler** — Express 5 compatibility fix. Payloads over 1MB now correctly return 413 instead of 500.
- **Source maps disabled** — production builds no longer generate `.map` files.
- **Board role dropdown aligned** — frontend values now match backend's `VALID_BOARD_ROLES`.
- **Certificate page navigation** — replaced `navigate(-1)` with proper route.
- **Accessibility** — aria-labels added to all icon-only buttons.

### v2.4 — Access Control & Validation Hardening (April 9, 2026)

Addresses all findings from Rounds 5–6. Verified by Round 7 regression check (53/56 confirmed fixed, remaining 3 addressed in v2.5).

- **Vote type enum fixed** — backend now accepts `"circulation"` and `"meeting"` alongside other types, matching frontend.
- **Management minutes access control** — board membership checks on both list AND detail endpoints. No more IDOR via direct ID access.
- **Password reset token removed from response body** — token no longer exposed in API response.
- **Task number retry logic** — concurrent creation handled gracefully instead of 500.
- **UUID validation on all routes** — documents and workflows routes now validate like all others.
- **Workflows rate limiting and pagination** — write limiter and pagination caps added.
- **AI-proposed vote type validated** — pending actions check type against enum before execution.
- **`roleInBoard` validation** — returns 400 on invalid values instead of 500.
- **Document filename sanitization** — special characters stripped on upload.
- **`pendingActions` rate limiting** — approve/reject endpoints now have write rate limiter.

### v2.3 — Validation & Workflow Fixes (April 9, 2026)

Addresses all findings from Round 4 security audit, static code review, and E2E functional testing. Verified by Round 5 comprehensive regression check (37/38 items confirmed fixed).

**Critical fixes:**
- **Minutes signing workflow was broken** — frontend and backend used different status enums. Aligned to `draft → review → signing → signed` across frontend, backend, and database schema.
- **JWT token removed from login response body** — was being sent in JSON alongside HttpOnly cookie, defeating the purpose. Now only in the cookie.

**High fixes:**
- **Management meeting access bypass removed** — management users now subject to board membership checks like all other roles.
- **Observer minutes navigation fixed** — observer-accessible minutes route added.
- **Read rate limiter added** — global rate limit on all GET endpoints prevents mass enumeration.
- **Enum validation on all status/type/role fields** — votes, meetings, minutes, tasks, people, agenda items.

**Medium fixes:**
- **Pagination added to all list endpoints** — configurable limit, max 200.
- **Password reset tokens no longer logged in plaintext** — only token hash logged.
- **Minutes PATCH now sanitizes content** — was missing on PATCH while POST had it.
- **Vote cast comments now sanitized** — was storing raw input.
- **Email format validated on user creation** — was accepting malformed addresses.
- **`pick()` applied to people routes** — strips unknown fields from request body.
- **UUID validation on boards route** — was returning 500 on invalid UUID.
- **Sub-parameter UUID validation** — `:personId`, `:docId` now validated.
- **Content-Disposition header sanitized** in file downloads.
- **Secretary settings route fixed** — no longer a dead link.

### v2.2 — Security Hardening (April 8, 2026)

Addresses critical security vulnerabilities found in Round 1–3 security audits. See [Security Audit Status](#security-audit-status) for full details.

**What was broken and is now fixed:**

- **CORS was wide open** — `origin: "*"` replaced with strict origin validation. Only `*.replit.dev`, `*.replit.app`, and `localhost` accepted. `ALLOWED_ORIGIN` env var for production.
- **JWT was in localStorage** — migrated to HttpOnly secure cookies with `cookie-parser`. SameSite=Strict in production.
- **WebSocket was unauthenticated** — Socket.io now authenticates at handshake via cookie. Room joins verified against board membership.
- **No access control on most GET endpoints** — board membership checks added to boards, votes, meetings, minutes, documents, tasks. Observers and members now only see what they have access to.
- **AI search leaked entire database** — `getDatabaseContext()` now scoped to the requesting user's accessible entities.
- **System reset was dangerous** — now requires admin role + `{ confirm: "RESET" }` + wrapped in a database transaction.
- **Seed password had hardcoded fallback** — now fails fast if `SEED_PASSWORD` env var is not set.
- **No input sanitization** — added `sanitize-html` on backend (all text inputs), `DOMPurify` on frontend (rendered HTML).
- **No request hardening** — added 1MB body limit, UUID validation on route parameters, `pick()` to strip unknown fields.
- **Error handlers swallowed errors** — replaced `.catch(() => {})` with proper `logger.error()`.

**New security features:**

- Helmet middleware (CSP, HSTS, X-Frame-Options, X-Content-Type-Options)
- Rate limiting: login (10/15min per IP + per email), AI (20/min), writes (30/min), reads (100/min)
- Password complexity (12+ chars), bcrypt hashing
- Account lockout (30 failures → 24h)
- Password reset flow (SHA-256 token, 1h expiry)
- JWT refresh endpoint
- Path traversal protection on file downloads
- Composite DB index on access control table
- Full audit trail logging

**Documentation:**

- Removed hardcoded credentials from `replit.md`
- Admin panel no longer pre-fills default password
- This changelog now documents what was wrong, not just what was added

### v2.1 — Security Hardening (2026-04-07)
- **Fixed:** JWT secret now mandatory — app refuses to start without `SESSION_SECRET`
- **Fixed:** `close_task` action now correctly matches by task number (was closing wrong task)
- **Fixed:** Meetings table status column added (was crashing on status updates)
- **Fixed:** Access control uniqueness enforced at DB level
- **Fixed:** Vote status enum now includes "cancelled"
- **Fixed:** File type validation consistent across all upload endpoints (PDF, DOCX, TXT only)
- **Added:** Rate limiting on AI endpoints (20/min), auth endpoints (10/15min per IP + 10/15min per email), and write endpoints (30/min)
- **Added:** AI error logging in document and task processing
- **Added:** Configurable CORS origin via `ALLOWED_ORIGIN`
- **Added:** Configurable seed password via `SEED_PASSWORD`

### v2.0 — AI-Native Rebuild (2026-04-05)
- Complete rebuild as 4-layer AI-first architecture
- Document Brain: AI classifies uploaded documents and proposes actions
- Secretary approval queue: human-in-the-loop for all AI actions
- 5 AI modes: CLASSIFY, COMMAND, SEARCH, REVIEW, SUGGEST
- Natural language command bar for Secretary
- Minutes lifecycle with SHA-256 integrity hashes
- Voting with 4 options, custom approval rules, quorum enforcement
- Role-based access control (Secretary, Board Member, Management, Observer)
- Real-time updates via Socket.io
- 20-person seed with 5 boards for Meridian Energy Group

### v1.0 — Initial Release (2026-03-30)
- Traditional board portal with manual workflows
- Meeting management, document storage, basic voting
- Superseded by v2.0

---

## Roadmap

- [ ] Email notifications
- [ ] Delegation of Authority engine
- [ ] Committee endorsement cascades
- [ ] Board pack generation (automated PDF compilation)
- [ ] Calendar integration
- [ ] Mobile-responsive views
- [ ] Local LLM support (Ollama / vLLM)
- [ ] Multi-tenant deployment

---

## Contributing

This project was built by a governance professional to solve real governance problems. Contributions from people who work in board administration, legal, compliance, or corporate secretarial roles are especially welcome.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/committee-cascades`)
3. Commit your changes
4. Open a Pull Request with a description of what problem it solves

**Bug reports:** Open an issue. Include what you expected, what happened, and steps to reproduce.

**Feature requests:** Open an issue. Describe the governance workflow you need. The more specific, the better.

---

## License

MIT License. Use it, fork it, deploy it, sell support for it. Attribution appreciated but not required.

---

## Author

**Alexios van der Slikke-Kirillov**

---

<p align="center">
  <strong>Built by a governance professional. Shaped by the community.</strong><br>
  <em>If you work in board governance and want to test this, <a href="https://github.com/SaifAlYounan/Open-Board/issues">open an issue</a> or reach out.</em>
</p>
