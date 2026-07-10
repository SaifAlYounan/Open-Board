# Security Policy

Open Board handles board-governance data — minutes, resolutions, votes, and confidential documents.
Security is a first-class concern. This document explains how to report a vulnerability, what the
platform does to protect data, and where the current limitations are.

## Reporting a vulnerability

The canonical repository is **[github.com/SaifAlYounan/Open-Board](https://github.com/SaifAlYounan/Open-Board)**.

**For private disclosure, [open a GitHub Security Advisory](https://github.com/SaifAlYounan/Open-Board/security/advisories/new)**
("Report a vulnerability"). This keeps the report confidential until a fix is released and lets us
collaborate on it privately.

If the advisory form is unavailable to you, contact the maintainer privately through their
[GitHub profile](https://github.com/SaifAlYounan) rather than filing a public issue.

For non-sensitive matters you may instead [open a public issue](https://github.com/SaifAlYounan/Open-Board/issues) —
this is an open-source project and its code, issues, and known gaps are all public.

Please include:
- a description of the vulnerability and its impact (what an attacker could do),
- steps to reproduce, or the affected file/line.

We aim to acknowledge within 48 hours and agree a fix timeline within 7 days. We will not pursue
researchers acting in good faith.

## Disclosure process

1. Reporter opens a private advisory (or a public issue for non-sensitive matters).
2. We acknowledge and assess severity.
3. We develop, test, and release a fix.
4. We credit the reporter (unless they prefer to remain anonymous).

---

## What the platform implements

### Human-in-the-loop
Every AI-proposed action goes through the Secretary's approval queue. The AI classifies documents and
proposes actions — it never executes them. Each proposal is validated against a strict Zod schema
**when it is queued and again when it executes**; unknown action types are rejected.

### Authentication & sessions
- JWTs are stored in **HttpOnly cookies** (`SameSite=Strict`, `Secure` in production) — never in
  localStorage. `Authorization: Bearer` is also accepted for programmatic access.
- A per-user **token version** invalidates every outstanding JWT the moment a password is changed or
  reset, an account is deactivated, or the user logs out — logout revokes server-side, not just
  cookie-clearing. Sockets re-check role/active/version against the DB, not the token.
- `SESSION_SECRET` is mandatory — the server refuses to start without it. Passwords are bcrypt (cost 10)
  with a 12-character minimum; first-boot and newly created accounts use one-time passwords and are
  forced to reset on first sign-in.

### Authorization
- Object-level access control on boards, votes, meetings, minutes, and tasks; **per-document ACLs**
  allow excluding an individual from specific materials (conflict-of-interest recusal).
- Minutes signing and task-evidence submission enforce object-level checks (board membership /
  assignee) — not just authentication.

### Data integrity
- **Tamper-evident audit trail**: each row stores a SHA-256 over the previous row (a hash chain)
  binding actor, entity, details, IP, and timestamp.
- **Verifiable vote certificates**: the certificate hash is computed entirely from persisted data and
  can be recomputed via `GET /api/votes/:id/certificate/verify`.
- **Retention log**: governance records are snapshotted into `deleted_records` before deletion and are
  included in the data export.

### Transport & input hardening
- Helmet security headers; 1 MB request-body cap; UUID validation on route parameters; `pick()`
  field-allowlisting to prevent mass assignment.
- `sanitize-html` on the backend and DOMPurify on the frontend for any rendered rich text.
- Multi-layer rate limiting: per-IP + per-email on login, per-user on AI and write endpoints.
- **Durable account lockout**: 30 failed password attempts lock the account for 24 hours. The
  counter lives in Postgres (atomic increments), so it survives restarts and is shared across
  every app process; expired entries are cleaned up opportunistically.
- CORS requires an explicit `ALLOWED_ORIGIN` allowlist in production (no wildcard fallback); dev
  accepts localhost only.
- File uploads are limited by size and MIME/extension; downloads are path-traversal-contained to the
  uploads directory.

### Deployment model
- **Single-organization per deployment.** There is no multi-tenant isolation — the per-board
  membership is the boundary.
- Self-hosted: your data stays on your infrastructure, in your jurisdiction. When self-hosted, no
  third-party vendor can be compelled to produce your board documents.

---

## Known limitations

These are real and tracked as issues — do your own review before using with production board data:

- **Short-window login rate limiting is per-process** — the 15-minute per-IP / per-email throttles
  are in-memory and reset on restart. The durable 24-hour account lockout is Postgres-backed and is
  not affected.
- **Encryption at rest is operator-provided, by design.** The application does not encrypt DB
  fields or uploaded files itself — you are expected to run it on encrypted storage (encrypted
  volumes/disks, an encrypted managed Postgres, encrypted backups). How to do that is documented in
  [DEPLOY.md → Encryption at rest](DEPLOY.md#encryption-at-rest); TLS is terminated at your reverse
  proxy and DB SSL is operator-configured.

## Pre-production checklist

- [ ] `SESSION_SECRET` is a strong random string (`openssl rand -hex 32`).
- [ ] `NODE_ENV=production` and `ALLOWED_ORIGIN` set to your exact origin(s).
- [ ] Postgres on a private network with SSL enabled and backups configured.
- [ ] Encryption at rest enabled at the storage layer — encrypted volumes/managed-DB encryption and
      encrypted backups (see [DEPLOY.md → Encryption at rest](DEPLOY.md#encryption-at-rest)).
- [ ] HTTPS enforced at the reverse proxy; the API sits behind exactly one proxy hop (`trust proxy` = 1).
- [ ] `DEMO_MODE` unset; demo accounts absent.
- [ ] Consider removing the Admin → System "Reset All Data" action for production boards.
- [ ] Run your own dependency and code audit.
