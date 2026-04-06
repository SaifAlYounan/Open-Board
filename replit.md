# EasyBoard v2 — AI-Native Board Management Portal

## Overview
EasyBoard v2 is a complete corporate governance portal for Meridian Energy Group with 4 role-based interfaces, AI document classification, real-time vote tracking, and comprehensive board management workflows.

## Architecture

### Monorepo Structure
- `artifacts/api-server/` — Express API server on port 8080 (`/api` path)
- `artifacts/easyboard/` — React + Vite frontend on port 25532 (`/` path)
- `lib/db/` — Drizzle ORM schema + PostgreSQL client
- `lib/api-client-react/` — Generated React Query hooks (orval codegen)

### Platform Routing
- `/api/*` → API Server (port 8080)
- `/*` → EasyBoard frontend (port 25532)

## Authentication
- JWT tokens stored in localStorage as `token`
- `customFetch.ts` auto-attaches Bearer header
- `AuthProvider` in `lib/auth.tsx` restores user via `/api/auth/me` on page load
- 4 roles: `admin` (Secretary), `member` (Board Member), `management`, `observer`

## Test Credentials
All passwords: `Meridian2024!`
- **Secretary**: `a.alrashid@meridian-energy.com` (Ahmed Al-Rashid, role: admin)
- **Board Member**: `n.petrov@meridian-energy.com` (Nadia Petrov, role: member, BoD Chair)
- **Management/CFO**: `r.taylor@meridian-energy.com` (Robert Taylor, role: management)
- **Observer**: `d.park@meridian-energy.com` (David Park, role: observer)

## Seeded Data
- 20 people across all roles (format: firstname.lastname@meridian-energy.com)
- 5 boards: BoD (Board of Directors), FAC (Finance & Audit), SIC (Strategy & Investment), NRC (Nomination & Remuneration), TPC (Technical & Projects)
- Seed detection: checks for `s.chen@meridian-energy.com` (people) AND for existing meetings; if people missing → clearAll + full seed; if meetings missing → add demo data only
- Demo data: 3 meetings (BoD Q1 completed, BoD Q2 scheduled, FAC Q1 scheduled), 3 votes (RES-BOD-2026-001 open, RES-BOD-2026-002 approved, RES-FAC-2026-001 open), 4 tasks (TASK-2026-001 through 004, two assigned to CFO Robert Taylor), 2 minutes (review + signing status)
- `people.active` boolean column controls login access (inactive = 403 on login)

## Role-Based Interfaces

### Secretary (/secretary)
- Dashboard with AI command bar
- Pending AI Actions (/secretary/pending) — approve/reject/edit AI-proposed entities
- Votes (/secretary/votes) — create resolutions with approval rules + recusals; clickable cards navigate to detail
- Vote Detail (/secretary/votes/:id) — full vote detail with per-member breakdown, extend deadline, close vote, upload supporting materials, download SHA-256 signed PDF certificate
- Meetings (/secretary/meetings) — create and manage meetings
- Minutes (/secretary/minutes) — list and edit board minutes
- Tasks (/secretary/tasks) — create and track action items; each task card is clickable
- Task Detail (/secretary/tasks/:id) — view and edit task details (title, status, assignee, due date)
- Documents (/secretary/documents) — upload and AI-classify documents (committee_submission now recognized)
- Members (/secretary/members) — view all people
- Admin Panel (/secretary/admin) — manage users (edit/activate/deactivate/create) and board memberships
- Settings (/secretary/settings) — AI configuration status

### Board Member (/board)
- Dashboard with AI insights and board cards
- Board Room (/board/room/:boardId) — vote casting with supporting materials visible; meetings view; minutes view
- Minutes Viewer (/board/minutes/:id) — read-only with comment sidebar
- Minutes Signing (/board/minutes/:id/sign) — SHA-256 signed with Dancing Script font

### Management (/management)
- Dashboard with task summary, overdue alerts, and recent Board Minutes section
- My Tasks List (/management/tasks) — all tasks assigned to the user
- Task Detail (/management/task/:id) — file evidence upload with AI review
- Board Minutes (/management/minutes) — list of published minutes (review/signing/signed)

### Observer (/observer)
- Read-only view of boards and published minutes
- Observer Room (/observer/room/:boardId)

## AI Features
- Model: `claude-opus-4-20250514` via `ANTHROPIC_API_KEY`
- Document classification on upload → proposes pending actions (types: draft_minutes, resolution, financial_report, legal_opinion, evidence, meeting_agenda, committee_submission, general)
- AI Command bar for natural language (create meetings, votes)
- AI Search across minutes/votes/documents
- AI Insights on board dashboard
- AI Evidence review for task completion
- No AI key → blue info banner, never crashes

## Key Technical Decisions
- Vote buttons removed from DOM after voting (submittedVotes state in room.tsx); vote comment is stored and displayed in the green confirmation banner
- 409 on duplicate vote — handled with "Already voted" toast
- SHA-256 signature: SHA256(content + name + ISO_timestamp)
- `signature-appear` CSS animation in index.css
- Tiptap editor for minutes (read-only in viewer, editable in editor)
- React Query with 30s staleTime, retry 1
- Socket.io configured for real-time vote/signature updates
- AI date parsing strips timezone suffix (Z or ±HH:MM) to treat times as wall-clock (no UTC conversion)
- `migratePeopleTitles()` runs at every server startup to keep people titles up-to-date
- Pending Actions: per-type structured edit forms (create_meeting/vote/task/minutes each have typed fields instead of raw JSON)
- create_minutes actions auto-show meeting picker pre-populated with most recent meeting

## Database
- 21-table PostgreSQL schema via Drizzle ORM
- Tables: organizations, people, boards, boardMemberships, meetings, agendaItems, votes, voteRecords, vote_documents, approvalRules, minutes, minutesSuggestions, minutesSignatures, documents, agendaDocuments, tasks, taskEvidence, pendingActions, accessControl, auditTrail, attendance
- vote_documents: created via direct SQL (drizzle-kit push has pre-existing conflict with approvalRules junction table PK)

## Vote System
- PATCH /api/votes/:id supports: title, resolutionText, deadline (extend deadline), status (close vote - generates SHA-256 certificate hash on close)
- GET /api/votes/:id returns: full voteRecords with people, approvalRule with summaryText, documents array
- GET /api/votes lists now include documentCount field
- POST /api/votes/:id/documents — multer upload, stored in ./uploads/, max 20MB
- GET /api/votes/:id/documents — list documents
- DELETE /api/votes/:id/documents/:docId — delete document + file
- GET /api/votes/:id/documents/:docId/download — stream file download
- GET /api/votes/:id/certificate — full certificate data (for PDF generation)
- Certificate PDF: generated client-side (print window) on click of "Download Certificate" in vote detail

## Design System
- Apple aesthetic: Primary Blue #0071e3, Success #34c759, Danger #ff3b30, Warning #ff9500
- Background: #f5f5f7, Card: #ffffff, Text: #1d1d1f, Secondary: #86868b
- Fonts: Inter (self-hosted woff2 at /fonts/), Dancing Script (signatures, TTF) via @font-face — no Google Fonts CDN
- No dark mode, no emojis in UI
- Rounded-2xl cards, consistent 12px padding patterns
