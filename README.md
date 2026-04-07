<p align="center">
  <h1 align="center">✦ EasyBoard</h1>
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

EasyBoard is a board management platform built by a governance professional, not a software company. It replaces the traditional board portal model — where administrators manually create meetings, circulate documents, and track votes — with an AI-first approach where the system reads your documents and proposes the next actions.

**The AI is not an add-on. It is the product.**

Upload draft minutes → the AI extracts action items, flags confidential passages, and proposes creating tasks with assignees and deadlines. Upload a board resolution → the AI proposes a circulation vote with the correct board and quorum rules. The Board Secretary reviews and approves. Everything else follows.

Every proposed action goes through the Secretary's approval queue. Nothing executes without human approval. This is [human-in-the-loop governance](https://human-loop-guide.replit.app) by design.

---

## Quick Start

### Option 1: Run on Replit

[![Run on Replit](https://replit.com/badge/github/SaifAlYounan/EasyBoard)](https://replit.com/@SaifAlYounan/EasyBoard)

1. Fork the repo on Replit
2. Add environment variables (see [Deployment](#deployment))
3. Click Run

### Option 2: Self-Hosted

```bash
git clone https://github.com/SaifAlYounan/EasyBoard.git
cd EasyBoard
pnpm install
```

Set environment variables:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/easyboard
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
Password: Meridian2024!
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

- **Draft Minutes** — Extracts action items, attendees, resolutions. Flags confidential passages. Proposes tasks with assignees and deadlines.
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
- **Custom Approval Rules** — unanimous, majority, two-thirds, weighted, quorum, recusals

### For Board Members
- **Zero-Friction Dashboard** — pending votes, minutes to sign, next meeting at a glance
- **AI Search** — "When did we discuss Kazakhstan?" → answer with source links
- **Vote in 2 Clicks** — 4 options: Approved, Approved with Comments, Not Approved, Not Approved with Comments
- **Sign in 1 Click** — SHA-256 digital signatures with tamper-proof hashes
- **Comment on Minutes** — paragraph-level comments during review period

### For Management
- **Task Dashboard** — assigned tasks with source links back to board minutes
- **Evidence Upload** — submit deliverables; AI reviews against task requirements
- **Board Decisions View** — read-only access to decisions that affect your work

### For Observers
- **Read-Only Access** — view meetings, votes, and documents you're granted access to
- **Comment on Minutes** — participate in the review process
- **AI Search** — search within your access scope

---

## Architecture

```
Layer 0 — Document Brain         (invisible — AI classification engine)
Layer 1 — Secretary Interface    (AI copilot + approval queue)
Layer 2 — Board Member Interface (zero friction — vote, sign, search)
Layer 3 — Management Interface   (tasks + evidence upload)
Layer 4 — Observer Interface     (read-only + comments)
```

### Tech Stack

- **Backend:** Node.js, Express 5
- **Database:** PostgreSQL + Drizzle ORM
- **Frontend:** React 18, Vite, Tailwind CSS, Radix UI
- **Routing:** Wouter (frontend), Express Router (backend)
- **AI:** Anthropic Claude Opus 4 (via @anthropic-ai/sdk)
- **Auth:** JWT (jsonwebtoken) + bcryptjs
- **Real-time:** Socket.io
- **Documents:** multer, pdf-parse, mammoth
- **Signatures:** SHA-256 (Node.js crypto)
- **Validation:** Zod schemas
- **Package Manager:** pnpm monorepo (6 workspaces)

### Database

20+ tables covering organizations, boards, people, board memberships, meetings, agenda items, votes, vote records, minutes, minutes signatures, minutes suggestions, tasks, task evidence, documents, access control, approval rules, approval workflows, pending actions, attendance, and audit trail.

Full schema in `lib/db/src/schema/`.

---

## Demo Credentials

The seed script creates a fictional company (**Meridian Energy Group** — $4.2B renewable energy, Abu Dhabi) with 20 users across 4 roles and 5 boards:

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

**All passwords:** `Meridian2024!`

**5 Boards:** Board of Directors (BoD), Finance & Audit Committee (FAC), Strategy & Investment Committee (SIC), Nomination & Remuneration Committee (NRC), Technology & Projects Committee (TPC).

---

## Security

EasyBoard is designed for organizations that take data sovereignty seriously.

- **Self-hosted** — your data stays on your servers, in your jurisdiction
- **Zero external dependencies at runtime** — fonts bundled locally, no CDN calls, no telemetry
- **AI is pluggable** — use Anthropic's API, or swap in a local model. Your documents, your choice
- **Mandatory JWT secret** — app refuses to start without `SESSION_SECRET`; no hardcoded fallbacks
- **Rate limiting** — AI endpoints (10 requests/min) and auth endpoints (10 attempts/15 min)
- **Per-entity access control** — every meeting, vote, document, and task has explicit access grants with DB-level uniqueness constraints
- **Full audit trail** — every action logged with user, entity, timestamp, and IP
- **SHA-256 signatures** — tamper-proof digital signatures on minutes
- **CORS protection** — configurable origin whitelist via `ALLOWED_ORIGIN`
- **No CLOUD Act exposure** — when self-hosted, no foreign government can compel a vendor to produce your board documents

For a detailed comparison of open-source vs. proprietary board portal security, see [SECURITY.md](SECURITY.md).

---

## Deployment

### Environment Variables

- `DATABASE_URL` (required) — PostgreSQL connection string
- `SESSION_SECRET` (required) — Random 64-character hex string for JWT signing. App refuses to start without it.
- `ANTHROPIC_API_KEY` (optional) — Enables AI features. App works without it.
- `ALLOWED_ORIGIN` (optional) — CORS origin whitelist. Defaults to request origin.
- `SEED_PASSWORD` (optional) — Override default demo password.
- `PORT` (optional) — Default: 3000

### Production Considerations

- **Database:** Use a managed PostgreSQL instance (Neon, Supabase, RDS). Schema is standard PostgreSQL.
- **File Storage:** Replace `/uploads/` with S3-compatible object storage for production.
- **Auth:** JWT with mandatory `SESSION_SECRET`. Consider adding token refresh and short expiry (15 min access + 7 day refresh).
- **Rate Limiting:** Built in — express-rate-limit on auth and AI endpoints.
- **CORS:** Set `ALLOWED_ORIGIN` to your domain.
- **Seed Password:** Set `SEED_PASSWORD` env var for production demos. Change passwords after first login.

---

## Changelog

### v2.1 — Security Hardening (2026-04-07)
- **Fixed:** JWT secret now mandatory — app refuses to start without `SESSION_SECRET`
- **Fixed:** `close_task` action now correctly matches by task number (was closing wrong task)
- **Fixed:** Meetings table status column added (was crashing on status updates)
- **Fixed:** Access control uniqueness enforced at DB level
- **Fixed:** Vote status enum now includes "cancelled"
- **Fixed:** File type validation consistent across all upload endpoints (PDF, DOCX, TXT only)
- **Added:** Rate limiting on AI endpoints (10/min) and auth endpoints (10/15min)
- **Added:** AI error logging in document and task processing
- **Added:** Configurable CORS origin via `ALLOWED_ORIGIN`
- **Added:** Configurable seed password via `SEED_PASSWORD`

### v2.0 — AI-Native Rebuild (2026-04-05)
- Complete rebuild as 4-layer AI-first architecture
- Document Brain: AI classifies uploaded documents and proposes actions
- Secretary approval queue: human-in-the-loop for all AI actions
- 5 AI modes: CLASSIFY, COMMAND, SEARCH, REVIEW, SUGGEST
- Natural language command bar for Secretary
- Minutes lifecycle with SHA-256 digital signatures
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

**Alexios van der Slikke-Kirillov** — Group Senior Counsel & Board Secretary

---

<p align="center">
  <strong>Built by a governance professional. Shaped by the community.</strong><br>
  <em>If you work in board governance and want to test this, <a href="https://github.com/SaifAlYounan/EasyBoard/issues">open an issue</a> or reach out.</em>
</p>
