# Changelog

All notable changes are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org).

## [Unreleased]

Post-3.0.0 follow-ups on `main` (not yet tagged).

### Performance
- List endpoints (`votes`, `documents`, `tasks`, `minutes`, `pending-actions`) push filters,
  access-scoping, and pagination into SQL and batch all enrichment into a single query per relation —
  no more fetch-whole-table + N+1. (`GET /meetings` is still pending — see the roadmap.)
- AI daily budget moved from an in-memory per-process counter to a persisted `ai_usage` ledger
  (atomic call reservation, token accounting, optional `AI_DAILY_TOKEN_LIMIT`) — survives restarts and
  is consistent across instances.
- The database-state block sent to the AI is now a second prompt-cache breakpoint, so a burst of
  document classifications reuses it instead of re-sending the directory each time.

### Added
- `deleted_records` retention log: every governance record is snapshotted before it is deleted and is
  included in `GET /system/export`.

### Accessibility
- Focus trap on the AI search modal; the board-selector dropdown closes on outside-click / Escape.

## [3.0.0]

The audited, hardened, and runnable release.

### Getting started
- The Quick Start works end to end: real `pnpm dev` / `pnpm db:push` scripts, a complete
  `.env.example`, a `docker-compose.yml` for Postgres 16, and a Vite dev proxy so the frontend reaches
  the API on one origin. `.env` is loaded automatically.
- Password-change screen with a forced first-reset, a working "Forgot password?" flow, a token-based
  reset page, and one-time passwords for newly created members.

### Governance correctness
- **Quorum is now enforced** in vote tallying (it was previously stored and displayed but never
  consulted).
- Vote certificates are reproducible and verifiable via `GET /votes/:id/certificate/verify`.
- Minutes follow a real state machine (`draft → review → signing → signed`); content freezes once
  signing begins, and minutes cannot be marked signed with zero signatures.

### Security
- Object-level authorization on minutes signing and task-evidence submission.
- Audit hash-chain binds every attributable field (actor / entity / details / IP).
- Last active administrator cannot be demoted, deactivated, or deleted.
- CI runs with a least-privilege token.

### Performance & tooling
- Indexes added across hot foreign-key / filter / order columns.
- Low-stakes AI modes routed to a cheaper model without extended thinking.
- Full monorepo type-checks, unit-tests (Vitest), and builds, gated by GitHub Actions CI (typecheck,
  OpenAPI spec-drift check, tests, build). Community-health files added; data export endpoint added.

### History
Versions before 3.0.0 were an iterative security-hardening series on an early "EasyBoard"/Replit-hosted
prototype. That history is superseded by the 3.0.0 audit and remediation and is not carried forward
here.
