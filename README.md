<p align="center">
  <h1 align="center">✦ EasyBoard (beta)</h1>
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
  <a href="#contributing">Contributing</a>
</p>

---

## What Is This?

EasyBoard is a board management platform built by a governance professional, not a software company. It replaces the traditional board portal model — where administrators manually create meetings, circulate documents, and track votes — with an AI-first approach where the system reads your documents and proposes the next actions.

**The AI is not an add-on. It is the product.**

Upload draft minutes → the AI extracts action items, flags confidential passages, and proposes creating tasks with assignees and deadlines. Upload a board resolution → the AI proposes a circulation vote with the correct board and quorum rules. The Board Secretary reviews and approves. Everything else follows.

This is a beta. It works. It has rough edges. It's released because governance tools should be built by the people who understand governance — and shaped by the community that uses them.

---

## Quick Start

### Option 1: Run on Replit

[![Run on Replit](https://replit.com/badge/github/SaifAlYounan/EasyBoard)](https://replit.com/@SaifAlYounan/EasyBoard)

1. Fork the repo on Replit
2. Add environment variables (see below)
3. Click Run

### Option 2: Self-Hosted

```bash
git clone https://github.com/SaifAlYounan/EasyBoard.git
cd EasyBoard
npm install
```

Set environment variables:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/easyboard
JWT_SECRET=$(openssl rand -hex 32)
ANTHROPIC_API_KEY=sk-ant-...   # Optional — app works without it
PORT=3000
```

Initialize the database and start:

```bash
npm run seed    # Creates org, boards, demo users
npm start       # Starts the server on port 3000
```

Open `http://localhost:3000`. Log in as the Board Secretary:

```
Email: a.alrashid@meridian-energy.com
Password: Meridian2024!
```

> **Note:** The app works without an Anthropic API key. AI features will show an info banner prompting you to configure it. All manual features work normally.

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

| Type | What the AI Does |
|------|-----------------|
| **Draft Minutes** | Extracts action items, attendees, resolutions. Flags confidential passages. Proposes tasks with assignees and deadlines. |
| **Resolution** | Extracts resolution text. Proposes a circulation or meeting vote with the correct board. |
| **Financial Report** | Extracts key figures. Proposes attaching to the next relevant meeting. |
| **Evidence / Deliverable** | Matches against open tasks. Proposes closing the task with reasoning. |
| **Meeting Agenda** | Extracts all agenda items with types. Proposes creating the meeting with full agenda. |
| **Legal Opinion** | Extracts conclusions. Flags as privileged. Links to relevant agenda items. |
| **General** | Extracts summary and key topics. Stores without proposing actions. |

Every proposed action goes through the Secretary's approval queue. Nothing executes without human approval.

---

## Features

### For the Board Secretary
- **AI Document Classification** — upload any PDF, DOCX, or TXT and let the AI parse it
- **Approval Queue** — review, edit, or reject every AI-proposed action
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

| Component | Technology |
|-----------|-----------|
| Backend | Node.js, Express |
| Database | PostgreSQL (pg, no ORM) |
| Frontend | React, Tailwind CSS |
| AI | Anthropic Claude (via @anthropic-ai/sdk) |
| Auth | JWT, bcryptjs |
| Rich Text | Tiptap |
| Real-time | Socket.io |
| Documents | multer, pdf-parse, mammoth |
| Signatures | SHA-256 (crypto-js) |

### Database

20 tables covering organizations, boards, people, meetings, votes, minutes, tasks, documents, access control, approval rules, pending actions, and audit trail. Full schema in `/server/schema.sql`.

---

## Demo Credentials

The seed script creates a fictional company (**Meridian Energy Group**) with 20 users across 4 roles and 5 boards:

| Role | Name | Email | Title |
|------|------|-------|-------|
| Secretary | Ahmed Al-Rashid | a.alrashid@meridian-energy.com | Board Secretary |
| Board Member | Nadia Petrov | n.petrov@meridian-energy.com | Chairman of the Board |
| Board Member | Sarah Chen | s.chen@meridian-energy.com | Independent Director |
| Management | Robert Taylor | r.taylor@meridian-energy.com | Chief Financial Officer |
| Observer | David Park | d.park@meridian-energy.com | External Legal Counsel |

**All passwords:** `Meridian2024!`

Full list of 20 users and 5 boards in the seed script.

---

## Security

EasyBoard is designed for organizations that take data sovereignty seriously.

- **Self-hosted** — your data stays on your servers, in your jurisdiction
- **Zero external dependencies at runtime** — fonts bundled locally, no CDN calls, no telemetry
- **AI is pluggable** — use Anthropic's API, or swap in a local model. Your documents, your choice
- **Per-entity access control** — every meeting, vote, document, and task has explicit access grants
- **Full audit trail** — every action logged with user, entity, timestamp, and IP
- **SHA-256 signatures** — tamper-proof digital signatures on minutes
- **No CLOUD Act exposure** — when self-hosted, no foreign government can compel a vendor to produce your board documents

For a detailed comparison of open-source vs. proprietary board portal security, see [SECURITY.md](SECURITY.md).

---

## Deployment

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Random 64-character hex string |
| `ANTHROPIC_API_KEY` | No | Enables AI features. App works without it. |
| `PORT` | No | Default: 3000 |

### Production Considerations

- **Database:** Use a managed PostgreSQL instance (Neon, Supabase, RDS). Schema is standard PostgreSQL.
- **File Storage:** Replace `/uploads/` with S3-compatible object storage for production.
- **Auth:** Add token refresh and short expiry (15 min access + 7 day refresh) for production.
- **Rate Limiting:** Add express-rate-limit on auth and AI endpoints.
- **CORS:** Configure for your domain.

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

**How to contribute:**

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

<p align="center">
  <strong>Built by a governance professional. Shaped by the community.</strong><br>
  <em>If you work in board governance and want to test this, <a href="https://github.com/SaifAlYounan/EasyBoard/issues">open an issue</a> or reach out.</em>
</p>
