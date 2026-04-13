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

Every proposed action goes through the Secretary's approval queue. Nothing executes without human approval. This is [human-in-the-loop governance](https://human-loop-guide.replit.app) by design.

> **⚠️ This is a beta.** It works. It has rough edges. Features are missing. Bugs exist. It's released early because governance tools need to step up their game. [Open an issue](https://github.com/SaifAlYounan/Open Board/issues), break things, tell us what's wrong.

---

## Quick Start

### Option 1: Run on Replit

[![Run on Replit](https://replit.com/badge/github/SaifAlYounan/Open Board)](https://replit.com/@SaifAlYounan/Open Board)

1. Fork the repo on Replit
2. Add environment variables (see [Deployment](#deployment))
3. Click Run

### Option 2: Self-Hosted

```bash
git clone https://github.com/SaifAlYounan/Open Board.git
cd Open Board
pnpm install
```

Set environment variables:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/openboard
SESSION_SECRET=$(openssl rand -hex 32)
ANTHROPIC_API_KEY=sk-ant-...   # Optional — app works without it
PORT=3000
```

Initialize the database and start:

```bash
pnpm run seed    # Creates org, boards, demo users
pnpm run dev     # Starts the dev server
```

Open `http://localhost:3000`. Log in as the Board Secretary:

```
Email: a.alrashid@meridian-energy.com
Password: 0000
```

> **Note:** The app works without an Anthropic API key. AI features will show an info banner prompting you to configure it in Settings. All manual features work normally.

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

## Demo Credentials

The seed script creates a fictional company (**Meridian Energy Group** — $4.2B renewable energy, Abu Dhabi) with 20 users across 4 roles and 5 boards, plus rich demo data telling the story of 3 interconnected projects:

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

**All passwords:** `0000`

**5 Boards:** Board of Directors (BoD), Finance & Audit Committee (FAC), Strategy & Investment Committee (SIC), Nomination & Remuneration Committee (NRC), Technology & Projects Committee (TPC).

---

## Security

Open Board is designed for organizations that take data sovereignty seriously.

- **Self-hosted** — your data stays on your servers, in your jurisdiction
- **Zero external dependencies at runtime** — fonts bundled locally, no CDN calls, no telemetry
- **AI is pluggable** — use Anthropic's API, or swap in a local model. Your documents, your choice
- **Mandatory JWT secret** — app refuses to start without `SESSION_SECRET`; no hardcoded fallbacks

### Authentication & Sessions
- **HttpOnly JWT cookies** — tokens stored exclusively in HttpOnly secure cookies, never in localStorage. **Note:** When deployed on Replit, Replit's platform proxy may rename and strip cookie security flags. The app code sets the flags correctly; this is a Replit platform limitation. Self-hosted deployments are unaffected.
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
- **CORS protection** — strict origin validation. Defaults to `*.replit.dev`, `*.replit.app`, and `localhost` (for the Replit template). **For self-hosted or production deployments, set `ALLOWED_ORIGIN` to your actual domain** (e.g., `ALLOWED_ORIGIN=https://board.yourcompany.com`). The Replit defaults do not apply when `ALLOWED_ORIGIN` is set.
- **System reset** requires admin + `{ confirm: "RESET" }` in request body + wrapped in a database transaction (FK-safe delete order)
- **No CLOUD Act exposure** — when self-hosted, no foreign government can compel a vendor to produce your board documents

For a detailed comparison of open-source vs. proprietary board portal security, see [SECURITY.md](SECURITY.md).

---

## Deployment

### Environment Variables

- `DATABASE_URL` (required) — PostgreSQL connection string
- `SESSION_SECRET` (required) — Random 64-character hex string for JWT signing. App refuses to start without it.
- `ANTHROPIC_API_KEY` (optional) — Enables AI features. App works without it.
- `ALLOWED_ORIGIN` (optional) — CORS origin whitelist (comma-separated). Defaults to `*.replit.dev`, `*.replit.app`, `localhost`.
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

> ⚠️ **Open Board is a working beta.** It demonstrates the AI-native governance pattern and is suitable for evaluation, demos, and feedback. It has not been audited to production security standards. Do not use with real board data without completing the fixes described below and conducting your own security review.

Open Board has undergone twelve rounds of security auditing. Rounds 1–10 used automated AI agents (MiniMax M2.7 via OpenClaw) running three parallel checks per round: static code review, live API security testing, and end-to-end functional testing. Round 11 was a full static audit by Claude Opus 4.6 reading the complete source code, which identified architectural and design-level issues that endpoint-level testing missed.

### Current Posture: BETA (as of April 9, 2026)

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

Documented for transparency. Items marked **(v2.8)** are under manual verification and will be fixed if confirmed.

**Architecture (Round 11 findings — partially addressed in v2.8):**
- **AI action approval lacks transaction wrapping.** Approving an AI-proposed action can leave partial state if the operation fails midway. Idempotency check added on approve in v2.8, but no transaction wrapping and no audit log on approve/reject.
- **AI executor trusts action data without schema validation.** Fields from AI classification are passed to database inserts with minimal validation. The core `executeAction` function remains a mass-assignment sink. Fixing this requires a schema validation layer — estimated 1–2 day refactor.
- **Admin can force vote status via PATCH.** An admin can set a vote to "approved" without any votes being cast. The v2.8 guard only blocks re-transitions on already-closed votes — it does not prevent force-approving open votes. Fix pending.
- **Reject endpoint has no idempotency check.** An already-approved action can be overwritten to "rejected" status. Fix pending.
- **Weighted voting, proxy voting, and confidentiality flagging** are in the database schema but not implemented in application logic. They are stubs that silently do nothing.
- **Account lockout is in-memory.** Server restart resets lockout counters. Combined with the `migrateUpdatePasswords` issue (see v2.8 changelog), a restart in non-production environments resets both lockouts and passwords.
- **CORS allows any `*.replit.app` subdomain** with credentials. Any Replit-hosted page can make authenticated cross-origin requests to the demo.

**Fixed in v2.8 (removed from Known Limitations):**
- ~~Certificate hash covers summary only~~ → Now includes sorted vote records.
- ~~Vote cast ignores per-entity access control~~ → `hasAccess()` check added.
- ~~Login timing reveals email existence~~ → Dummy bcrypt compare added (~400ms both paths).
- ~~AI search leaks all minutes for users with no access records~~ → Now returns empty results.
- ~~AI classifier auto-grants board access without approval~~ → Removed; goes through pending actions.

**Platform & Deployment:**
- **Replit proxy strips cookie security flags.** The app correctly sets HttpOnly/Secure/SameSite, but Replit's platform proxy renames the cookie and strips these flags. Self-hosted deployments are unaffected.
- **No server-side JWT invalidation on logout.** Cookie is cleared but the token remains valid until expiry. Server-side token revocation is planned.
- **Open ballots are the default.** Votes are visible to all board members unless the Secretary enables "Secret Ballot" on vote creation.
- **Audit log records proxy IP, not client IP.** Behind Replit's reverse proxy, all audit log entries show the same IP. Self-hosted deployments use `trust proxy`.

**Input Handling (Round 9 findings):**
- **No character limit on titles.** Meeting, vote, task, and minute titles accept unlimited text. A very long title (100KB+) would render slowly but wouldn't crash the system or leak data. Production deployments should add a 500-character limit.
- **Null bytes in text inputs return 500.** Sending the invisible character `\0` inside a title causes a server error instead of a graceful rejection. No data is leaked. This only occurs with automated security scanners — no human would type a null byte.

**Build Tooling:**
- **Vite has 14 flagged npm vulnerabilities.** All are in Vite, the build tool that compiles the frontend. Vite never runs in production — users never interact with it. Developers cloning the repo will see audit warnings. Run `pnpm update vite` to resolve.
- **Vite dev server accepts connections from any domain** (`allowedHosts: true`). Only relevant during local development. The compiled production app does not use Vite's dev server.

**Demo Features:**
- **"0000" reset password.** The admin panel's "Reset Demo Data" button requires typing "0000" as a UI safeguard to prevent accidental resets. This is intentional — it's a speed bump for the demo, not a security measure. The real protection is server-side: the endpoint requires admin authentication plus an explicit `{ confirm: "RESET" }` payload. The "0000" is visible in the source code by design.

---

## Self-Hosting Guide

Open Board is designed to run on your own infrastructure. Before deploying to production, make these changes:

### 1. Environment Variables (Required)

Set these in your server environment. **Do not commit them to source control.**

| Variable | Purpose | Example |
|----------|---------|---------|
| `SESSION_SECRET` | Signs JWT tokens. Must be a long random string. | `openssl rand -hex 64` |
| `DATABASE_URL` | PostgreSQL connection string. | `postgresql://user:pass@host:5432/openboard` |
| `SEED_PASSWORD` | Password for initial demo accounts. Change to something strong or remove demo accounts entirely. | `YourStrongPassword123!` |
| `ALLOWED_ORIGIN` | Comma-separated list of allowed frontend URLs for CORS. | `https://board.yourcompany.com` |
| `NODE_ENV` | Set to `production` to enable secure cookies and disable debug logging. | `production` |
| `PORT` | Server port. | `3000` |
| `ANTHROPIC_API_KEY` | *(Optional)* Enables AI features (document classification, search, task suggestions). | `sk-ant-...` |

### 2. Replace Demo Accounts

The seed script (`seed.ts`) creates demo users for the Meridian Energy demo. For production:

- **Option A:** Delete the seed data entirely and create real users via the admin panel.
- **Option B:** Modify `seed.ts` with your organization's real board structure, roles, and email addresses. Run the seed once, then disable it.

### 3. Change or Remove the Reset UI Password

In `artifacts/easyboard/src/pages/secretary/admin.tsx` (directory name kept for compatibility), the "Reset Demo Data" button uses a client-side password (`"0000"`). For production:

- **Option A (recommended):** Remove the entire System Reset tab. Production boards should never have a "wipe everything" button.
- **Option B:** Change `"0000"` to a strong password known only to your administrator.

The server-side endpoint (`POST /api/system/reset-data`) is independently protected by admin authentication + confirmation payload, but disabling the UI entirely is safest.

### 4. Configure CORS

By default, the app accepts requests from `*.replit.dev` and `*.replit.app`. For production:

Set `ALLOWED_ORIGIN` to your exact frontend domain(s):
```
ALLOWED_ORIGIN=https://board.yourcompany.com
```

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
- Run migrations: `pnpm drizzle-kit push`

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
  <em>If you work in board governance and want to test this, <a href="https://github.com/SaifAlYounan/Open Board/issues">open an issue</a> or reach out.</em>
</p>
