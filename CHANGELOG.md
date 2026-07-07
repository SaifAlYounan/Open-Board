# Changelog

All notable changes to Open Board are documented here. This project adheres to
[Semantic Versioning](https://semver.org). A fuller narrative history lives in the
[README](README.md#changelog).

## [Unreleased]

### Getting started
- The Quick Start now works end to end: real `pnpm dev` / `pnpm db:push` scripts, a `.env.example`
  covering every variable, a `docker-compose.yml` for Postgres 16, and a Vite dev proxy so the
  frontend reaches the API on one origin.
- `.env` is loaded automatically by the server and drizzle-kit (Node's built-in env-file loader).

### Added
- Password-change screen with a forced first-reset (one-time passwords can no longer strand a user),
  a working "Forgot password?" flow, and a token-based reset page.
- Person creation issues a one-time password (shown once) and forces a reset on first sign-in.
- `GET /votes/:id/certificate/verify` recomputes a resolution certificate from persisted data.
- Community-health files: this changelog, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, issue/PR templates.

### Governance correctness
- **Quorum is now enforced** in vote tallying (it was stored and displayed but never consulted).
- Vote certificate hashes are **reproducible and verifiable** (previously hashed a timestamp that was
  never persisted, so they could never be checked).
- Minutes follow a real state machine (`draft → review → signing → signed`); content freezes once
  signing begins, and minutes can't be marked signed with zero signatures.

### Security
- Object-level authorization on minutes signing and task-evidence submission (were reachable by any
  authenticated user who knew the UUID).
- Audit hash-chain now binds every attributable field (who/what/details/IP), not just id/action/time.
- Minutes comments are authorization-checked and sanitized.
- Last active administrator can't be demoted, deactivated, or deleted (org-lockout guard).
- CI runs with a least-privilege token.

### Performance
- Indexes added across hot foreign-key / filter / order columns.
- Low-stakes AI modes routed to a cheaper model without extended thinking.

## [3.0.0] — Round 13 audit + remediation

See the [README changelog](README.md#changelog) for the full v3.0 notes: DEMO_MODE-gated seeding,
per-user JWT invalidation, structured AI outputs with Zod validation at queue and execute time,
hash-chained audit trail, and the first fully type-checking, unit-tested, CI-gated build.
