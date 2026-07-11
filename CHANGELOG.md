# Changelog

All notable changes are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org).

## [Unreleased]

Post-3.0.0 follow-ups on `main` (not yet tagged).

### Security — board-records hardening (audit findings F1, F6, F7, F10)

- **Real electronic signatures on minutes (F6).** The old signature was an
  unkeyed `sha256(content + name + timestamp)` over a timestamp that was never
  stored — unrecomputable, forgeable by anyone with database access, and never
  verified. Replaced with a **per-user Ed25519 signature**: each signer enrolls
  a keypair whose private half is wrapped by a passphrase entered at signing
  (scrypt → AES-256-GCM) and **never stored**, so the server cannot sign on a
  director's behalf. Signatures verify in-app (`GET /api/minutes/:id/signature/verify`)
  and **offline** from an exported bundle (`GET /api/minutes/:id/export` +
  `scripts/verify-minutes.mjs`, an independent reimplementation needing no
  database). Pre-existing signatures report `legacy_unverifiable`, never
  "verified". Built to the eIDAS *advanced* bar; the qualified (QES) gap and the
  key-substitution limit are documented in `docs/SIGNING.md`. Enroll via
  `POST /api/signing-keys`.
- **Two-factor authentication (F7).** TOTP MFA, mandatory for admins and for any
  board member who can vote or sign. A correct password no longer yields a
  session for an enrolled account — it yields a short-lived challenge that must
  be exchanged for a session with a TOTP (or single-use, hashed recovery) code.
  Signing, approving AI proposals, and exporting the record require the second
  factor to have been proven *recently* (`MFA_FRESHNESS_SECONDS`, default 15 min).
  Enrollment is passkey-ready. Password hashing raised from bcrypt cost 10 to 12
  with transparent rehash on next sign-in. New dependency: `otplib`.
- **Fail-closed audit trail (F10).** Every audited mutation now writes its audit
  entry in the **same transaction**: if the entry cannot be written, the mutation
  rolls back. Audited reads (document view/download, exports) are audited before
  they are served, so an action that cannot be recorded is denied rather than
  performed silently. Chain writes serialize on a Postgres advisory lock, so
  concurrent requests — including multiple app containers on one database — can
  never fork the hash chain.
- **Prompt-injection mitigations (F1).** Untrusted document and evidence text is
  fenced as data the model is told never to obey and that the document cannot
  close from within; the extracted text is now **persisted** (`documents.extracted_text`);
  and every AI-proposed action's `source_quote` is checked verbatim against it.
  That quote check is a **hallucination guard, not an injection defense** — the
  real defense (render-vs-extract divergence) needs OCR tooling and is not yet
  built, so the human approval queue remains the barrier that matters. A CI
  corpus exercises the classic injection families.

### Deployment
- **Turnkey Docker deployment.** A single production image now serves the built SPA and the API from one
  process (`STATIC_DIR` + an Express SPA fallback that preserves the CSP and never shadows `/api` or
  `/socket.io`). `docker compose up -d` brings up Postgres + the app and applies the schema on first
  boot — the only required setting is `SESSION_SECRET`.
- **Automatic HTTPS** via an optional Caddy reverse proxy (`docker compose --profile production up -d`
  with `DOMAIN` + `ACME_EMAIL`) and a one-click **Render** blueprint (`render.yaml`). See `DEPLOY.md`.

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
