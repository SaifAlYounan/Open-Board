# Security Policy

LQGovernance handles board-governance data — minutes, resolutions, votes, and confidential documents.
Security is a first-class concern. This document explains how to report a vulnerability, what the
platform does to protect data, and where the current limitations are.

## Reporting a vulnerability

The canonical repository is **[github.com/LegalQuants/LQGovernance-OpenBoard](https://github.com/LegalQuants/LQGovernance-OpenBoard)**.

**For private disclosure, [open a GitHub Security Advisory](https://github.com/LegalQuants/LQGovernance-OpenBoard/security/advisories/new)**
("Report a vulnerability"). This keeps the report confidential until a fix is released and lets us
collaborate on it privately.

If the advisory form is unavailable to you, contact the maintainer privately through their
[GitHub profile](https://github.com/SaifAlYounan) rather than filing a public issue.

For non-sensitive matters you may instead [open a public issue](https://github.com/LegalQuants/LQGovernance-OpenBoard/issues) —
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
- `SESSION_SECRET` is mandatory — the server refuses to start without it. Passwords are **bcrypt cost
  12** (an under-cost hash is transparently upgraded on the owner's next successful sign-in) with a
  12-character minimum; first-boot and newly created accounts use one-time passwords and are forced to
  reset on first sign-in.

### Two-factor authentication
- **TOTP second factor**, mandatory for administrators and for any board member who can vote or sign
  (an observer seat does not trigger it). Enrollment is two-step — the factor does not count until a
  code from it is confirmed — and is designed so WebAuthn/passkeys can slot in later.
- **A correct password alone no longer yields a session** for an enrolled account: login returns a
  short-lived *challenge* that must be exchanged for a session with a TOTP (or single-use, hashed
  recovery) code. The challenge is signed with the session secret but is rejected everywhere except
  the exchange endpoint, so it can never be replayed as a session.
- A TOTP code cannot be replayed inside its 30-second window (the consumed time-step is recorded), and
  a wrong second factor feeds the same durable account lockout as a wrong password.
- The organization-**binding** actions — signing minutes, approving/rejecting an AI proposal, and
  exporting the full record — require the second factor to have been proven *recently*
  (`MFA_FRESHNESS_SECONDS`, default 15 min), not merely at some point in the session's life.

### Cryptographic minutes signing
- Minutes are signed with a **per-user Ed25519 key**. Each signer enrolls a keypair whose private half
  is wrapped by a passphrase entered at signing (scrypt → AES-256-GCM) and **never stored** — so the
  server, and anyone with database access, **cannot sign on a director's behalf**. This is the
  *sole-control* property of an eIDAS *advanced* electronic signature.
- The signature commits to a canonical, fully-persisted payload (content hash, signer, the exact
  stored timestamp, algorithm, public key), so it is recomputable and verifiable — in-app via
  `GET /api/minutes/:id/signature/verify`, and **offline** from an exported bundle
  (`GET /api/minutes/:id/export`) with `artifacts/api-server/scripts/verify-minutes.mjs`, which needs
  no database and shares no code with the app.
- Signatures made before this existed are reported `legacy_unverifiable` — never "verified". Full
  design, the key-substitution limit, and the qualified-signature (QES) gap are in
  [docs/SIGNING.md](docs/SIGNING.md).

### Authorization
- Object-level access control on boards, votes, meetings, minutes, and tasks. **Per-document access
  is an allow-list**: a document is visible only to members who hold an explicit `hasAccess=true`
  grant (plus admins). Note the current limitation below — on upload a document is granted only to
  the uploader, so board-wide visibility is not automatic and exclusion-based recusal is not yet
  implemented.
- Minutes signing and task-evidence submission enforce object-level checks (board membership /
  assignee) — not just authentication.

### Data integrity
- **Hash-chained audit trail**: each row stores a SHA-256 over the previous row (a hash chain)
  binding actor, entity, details, IP, and timestamp. Verify it with `GET /api/audit/verify` (admin)
  or offline with `artifacts/api-server/scripts/verify-audit.mjs` against a database dump. This detects an
  unsophisticated row edit, but it is **not** tamper-evident against an actor with database write
  access — the hash inputs are all in the row and the algorithm is public, so such an actor can
  rewrite a row and re-seal the chain. There is no external anchor yet (see limitations below).
- **Fail-closed audit writes**: every audited mutation commits in one transaction with its audit
  entry — if the entry cannot be written, the mutation rolls back and the request fails. Audited
  reads (document views/downloads, data export) are audited before they are served, so an action
  that cannot be recorded is denied rather than performed silently. Chain writes are serialized
  with a Postgres advisory lock, so concurrent requests — including multiple app containers on one
  database — cannot fork the chain.
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
- Self-hosted: your **database and files** stay on your infrastructure, in your jurisdiction. This
  guarantee holds for the AI pipeline **only when AI is disabled or the local (`openai-compatible`)
  provider is used**. With the default Anthropic provider (`ANTHROPIC_API_KEY` set), extracted
  document text — including passages the classifier is asked to flag as privileged — is transmitted
  to a third-party API, and that vendor could be compelled to produce it. See the limitation below.

---

## Known limitations

These are real and tracked as issues — do your own review before using with production board data:

- **Prompt injection is mitigated, not solved.** Extracted document and evidence text is fenced as
  untrusted **data** (channel separation: explicit markers that the document cannot close from
  within, plus a system-prompt rule to report — never obey — instructions found inside the fence),
  the extracted text is persisted, and every AI-proposed action's `source_quote` is checked verbatim
  against it (`source_quote_verified`). **That quote check is a hallucination guard, not an
  injection defense**: an attacker controls the document, so an injected instruction can quote
  itself truthfully. The real defense against a hostile PDF — render-vs-extract divergence (what a
  human SEES vs what the extractor READS: white text, `/ToUnicode` remapping, homoglyphs) — is
  **not implemented**; it needs OCR tooling. **The human approval queue remains the barrier that
  matters**: review the rendered document, not the extraction, and do not treat AI proposals from
  untrusted documents as trustworthy.
- **Two-factor is TOTP only.** The mandatory second factor is TOTP (see "Two-factor authentication"
  above). There is no WebAuthn/passkey yet (enrollment is built to accept one later) and no SSO/OIDC.
- **Minutes signing is *advanced*, not *qualified*.** The signature proves the signer's key signed
  this exact text and that the server could not have signed for them — but an actor with database
  write access can substitute the *recorded public key* for one of their own and re-sign. That is
  detected only by checking the signer's key fingerprint against a copy held outside the system (see
  [docs/SIGNING.md](docs/SIGNING.md)). A qualified signature (QES) closes this by moving key custody
  and identity binding to a qualified trust service provider — a procurement decision, not code.
- **The audit chain has no external anchor** — see "Hash-chained audit trail" above. The in-app and
  offline verifiers detect a naive edit, but an actor with database write access can re-seal the
  whole chain undetected until an off-host anchor (a signed chain head) is added.
- **Short-window login rate limiting is per-process** — the 15-minute per-IP / per-email throttles
  are in-memory and reset on restart. The durable 24-hour account lockout is Postgres-backed and is
  not affected.
- **No application-level encryption at rest.** The application does **not** encrypt DB fields or
  uploaded files itself — minutes bodies, resolution text, uploaded documents, and AI-flagged
  passages are stored as plaintext in Postgres and on disk. The only at-rest control is
  operator-provided **full-disk** encryption (encrypted volumes/managed-DB encryption, encrypted
  backups — see [DEPLOY.md → Encryption at rest](DEPLOY.md#encryption-at-rest)). Full-disk
  encryption defends against a stolen disk; it does **not** defend against a database dump, a
  backup leak, a compromised application process, a rogue administrator, or a subpoena served on
  the host. Application-level envelope encryption is designed but not built — a complete execution
  plan is in [docs/ENCRYPTION_AT_REST.md](docs/ENCRYPTION_AT_REST.md). TLS is terminated at your
  reverse proxy and DB SSL is operator-configured.

## Pre-production checklist

- [ ] `SESSION_SECRET` is a strong random string (`openssl rand -hex 32`).
- [ ] `NODE_ENV=production` and `ALLOWED_ORIGIN` set to your exact origin(s).
- [ ] Postgres on a private network with SSL enabled and backups configured.
- [ ] Encryption at rest enabled at the storage layer — encrypted volumes/managed-DB encryption and
      encrypted backups (see [DEPLOY.md → Encryption at rest](DEPLOY.md#encryption-at-rest)).
- [ ] HTTPS enforced at the reverse proxy; the API sits behind exactly one proxy hop (`trust proxy` = 1).
- [ ] `DEMO_MODE` unset; demo accounts absent. (With `DEMO_MODE` unset the destructive
      `POST /system/reset-data` wipe route is not registered at all — it 404s.)
- [ ] Run your own dependency and code audit.
