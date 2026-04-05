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
- **Secretary**: ahmed@meridian.ae (role: admin)
- **Board Member**: sarah@meridian.ae (role: member, Chairperson)
- **Management/CFO**: david@meridian.ae (role: management)
- **Observer**: james@meridian.ae (role: observer)

## Seeded Data
- 20 people across all roles (format: firstname@meridian.ae)
- 5 boards: BOD (Board of Directors), FAC (Finance & Audit), SIC (Strategy & Investment), NRC (Nomination & Remuneration), TPC (Technical & Projects)
- No pre-seeded meetings/votes/tasks/documents

## Role-Based Interfaces

### Secretary (/secretary)
- Dashboard with AI command bar
- Pending AI Actions (/secretary/pending) — approve/reject/edit AI-proposed entities
- Votes (/secretary/votes) — create resolutions with approval rules
- Meetings (/secretary/meetings) — create and manage meetings
- Minutes (/secretary/minutes) — list and edit board minutes
- Tasks (/secretary/tasks) — create and track action items
- Documents (/secretary/documents) — upload and AI-classify documents
- Members (/secretary/members) — view all people
- Settings (/secretary/settings) — AI configuration status

### Board Member (/board)
- Dashboard with AI insights and board cards
- Board Room (/board/room/:boardId) — vote casting, meetings view, minutes view
- Minutes Viewer (/board/minutes/:id) — read-only with comment sidebar
- Minutes Signing (/board/minutes/:id/sign) — SHA-256 signed with Dancing Script font

### Management (/management)
- Task dashboard with overdue alerts
- Task Detail (/management/task/:id) — file evidence upload with AI review

### Observer (/observer)
- Read-only view of boards and published minutes
- Observer Room (/observer/room/:boardId)

## AI Features
- Model: `claude-opus-4-20250514` via `ANTHROPIC_API_KEY`
- Document classification on upload → proposes pending actions
- AI Command bar for natural language (create meetings, votes)
- AI Search across minutes/votes/documents
- AI Insights on board dashboard
- AI Evidence review for task completion
- No AI key → blue info banner, never crashes

## Key Technical Decisions
- Vote buttons removed from DOM after voting (submittedVotes state in room.tsx)
- 409 on duplicate vote — handled with "Already voted" toast
- SHA-256 signature: SHA256(content + name + ISO_timestamp)
- `signature-appear` CSS animation in index.css
- Tiptap editor for minutes (read-only in viewer, editable in editor)
- React Query with 30s staleTime, retry 1
- Socket.io configured for real-time vote/signature updates

## Database
- 20-table PostgreSQL schema via Drizzle ORM
- Tables: organizations, people, boards, boardMemberships, meetings, agendaItems, votes, voteEntries, minutes, minutesComments, minutesSignatures, documents, tasks, taskEvidence, pendingActions, accessControls, auditLog, notifications, systemSettings, minutesVersions

## Design System
- Apple aesthetic: Primary Blue #0071e3, Success #34c759, Danger #ff3b30, Warning #ff9500
- Background: #f5f5f7, Card: #ffffff, Text: #1d1d1f, Secondary: #86868b
- Fonts: Inter (system), Dancing Script (signatures) via @font-face
- No dark mode, no emojis in UI
- Rounded-2xl cards, consistent 12px padding patterns
