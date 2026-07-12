# Security Policy

LQGovernance handles board-governance data — minutes, resolutions, votes, and confidential documents.
This document explains how to report a vulnerability, what the platform actually does to protect
data, **against which attacker each protection holds**, and where the current limitations are. It was
rewritten from a fresh read of the code after each hardening pass; if you find a claim here the code
does not honor, that is itself a reportable bug.

## The arc (how this document came to say what it says)

This project has been through four public rounds of scrutiny, each of which changed the code and then
this document:

1. **Built** as an AI-native board portal, donated to LegalQuants (2026-07).
2. **Audited** (findings F1–F12): the headline was that the artifacts with the most legal weight —
   minutes signatures — were decorative. The audit also found the test suite silently skipping its
   integration half.
3. **Hardened to the bar (P0)**: per-user Ed25519 minutes signing, mandatory TOTP two-factor,
   fail-closed audit writes, prompt-injection channel fencing with persisted extracted text.
4. **Externally reviewed** (2026-07): the reviewer showed the remaining integrity features were
   *internally consistent, not tamper-evident* (unkeyed audit chain, a circular vote certificate) and
   that the governance model itself was wrong in places a corporate secretary checks first (no
   abstain, quorum never measured over attendance, deadlines that never fired). All seven findings
   were fixed; the fixes are described below in their sections.

The honest pattern across all four rounds: **the least reliable artifact in the repo was the
documentation.** Hence this rewrite policy — docs are regenerated from the code after every
substantive round, and a CI check (`check-dead-config.mjs`) mechanically hunts the recurring bug
class of "stored, displayed, never consulted."

## Reporting a vulnerability

The canonical repository is **[github.com/LegalQuants/LQGovernance-OpenBoard](https://github.com/LegalQuants/LQGovernance-OpenBoard)**.

**For private disclosure, [open a GitHub Security Advisory](https://github.com/LegalQuants/LQGovernance-OpenBoard/security/advisories/new)**
("Report a vulnerability"). If the advisory form is unavailable to you, contact the maintainer
privately through their [GitHub profile](https://github.com/SaifAlYounan) rather than filing a public
issue. For non-sensitive matters you may [open a public issue](https://github.com/LegalQuants/LQGovernance-OpenBoard/issues).

Please include a description of the vulnerability and its impact, and steps to reproduce or the
affected file/line. We aim to acknowledge within 48 hours and agree a fix timeline within 7 days. We
will not pursue researchers acting in good faith.

---

## What the platform implements — and against whom

### Human-in-the-loop for the AI

Every AI-proposed action goes through the Secretary's approval queue; the AI never executes anything.
Each proposal is validated against a strict Zod schema when queued and again when executed; unknown
action types are rejected.

Since the external review, the loop is closed with facts, not trust: the AI's `source_quote` is
re-checked against the **persisted** extracted text **at approval time** (not just at classification),
a missing quote **blocks** the approval unless the Secretary explicitly overrides with a reason, the
approval card shows whether the quote was found and whether *this approver ever opened the source
document*, and the approval's audit entry records all three (`sourceQuoteVerified`, the override +
reason, `sourceViewed`). This is a **hallucination guard, not an injection defense** — see the
limitations.

### Authentication & sessions

- JWTs in **HttpOnly cookies** (`SameSite=Strict`, `Secure` in production); a per-user token version
  revokes every outstanding session on password change, deactivation, or logout. Sockets re-check
  role/active/version against the database.
- Passwords are **bcrypt cost 12**, 12-character minimum, forced reset on first sign-in. A durable
  Postgres-backed lockout (30 failures / 24 h) survives restarts and is shared across processes.
- **TOTP two-factor, mandatory** for administrators and voting/signing members. A correct password
  alone never yields a session for an enrolled account (login returns a challenge exchangeable only at
  the verify endpoint), codes cannot be replayed within their window, and the organization-binding
  actions — signing, approving/rejecting AI proposals, exporting — require the second factor proven
  **recently** (`MFA_FRESHNESS_SECONDS`, default 15 min).

### The two signing identities

- **Minutes** carry **per-user Ed25519 signatures**: the private key is wrapped by a passphrase typed
  at signing and never stored, so the operator — and anyone with full database access — *cannot* sign
  for a director. eIDAS *advanced*, not *qualified*; verify in-app or offline
  (`scripts/verify-minutes.mjs`). Pre-signing rows report `legacy_unverifiable`, never "verified".
- **Vote certificates (v3)** are **Ed25519-signed by the server key** over a payload frozen at close:
  ballots (including abstentions), the tally, the resolved quorum/denominator bases, recusals with
  reasons, and the attendance snapshot for meeting votes. Verification runs three independent checks
  (stored hash, signature, live-rows match), so the pre-v3 attack — flip ballots, recompute the hash,
  pass verify — now fails on the signature. Machine attestation, not a person's signature. Legacy
  certificates verify via the old recompute path, labeled `signed: false`.

Full designs and limits: [docs/SIGNING.md](docs/SIGNING.md).

### Data integrity

- **HMAC-keyed audit chain**: each row's link is HMAC-SHA-256 under a key derived from
  `SERVER_SIGNING_SECRET` (never in the database); the first keyed row pins the entire unkeyed
  history, keying is monotonic (a downgrade reads as tampering), and verification runs in-app
  (`GET /api/audit/verify`) or offline (`scripts/verify-audit.mjs`, an independent implementation).
  **Holds against database write access. Does not hold against app-server compromise** (environment +
  database) — that needs an external anchor, which is not built.
- **Fail-closed audit writes**: every audited mutation commits in one transaction with its audit
  entry; audited reads are recorded before they are served. Chain writes are serialized with an
  advisory lock across processes.
- **Deadlines fire.** `deadlineBehavior` (lapse / extend-once / notify) is enforced lazily on every
  read/cast of an expired open vote plus an hourly sweep; lapse mints the signed certificate over the
  ballots received. (Before the external review this column was stored, displayed, and never
  consulted.)
- **Retention log**: governance records are snapshotted before deletion and included in the export. A
  person who has acted in the record (ballots, signatures, audit rows, attendance, uploads) can never
  be hard-deleted — deactivation preserves the record and revokes access.

### Governance semantics (what the tally actually computes)

The external review found the product wrong about governance in ways a corporate secretary would
catch; these are now modeled, tested, and printed on the certificate:

- **Abstain is a first-class ballot**: it counts toward quorum and closing, never toward approval,
  and drops out of the default fractional denominator (majority of votes cast for-or-against —
  Robert's Rules reading). Unanimity defaults to the written-consent reading (all eligible must
  approve; an abstention defeats it). Both bases are configurable per approval rule.
- **Meeting votes measure quorum over attendance** (present + proxy weight); circulation votes over
  ballots cast. The certificate records which basis decided the outcome.
- **Recusal is a recorded fact**, not an access-control hole: who was excluded and why appears on the
  vote payload and the certificate — even for secret ballots (a recusal is administrative, not a
  ballot).
- The defaults ship as the common readings; **which reading your charter requires is a legal
  question** — confirm before relying on an outcome.

### Authorization

One access model everywhere (`lib/access.ts`): board membership OR an unexpired explicit grant, MINUS
explicit deny — deny (recusal) always wins. It governs the entity routes, the list endpoints, **the
knowledge graph and its search** (which previously leaked denied documents' titles and edges to
recused members), and AI search. Observers are read-only; object-level checks guard signing and
evidence submission.

### AI boundary

The AI is optional. With no provider configured, everything else works. The default Anthropic path
requires an explicit egress acknowledgement (`AI_ALLOW_EXTERNAL_PROVIDER=true`) because extracted
document text leaves the deployment; the `openai-compatible` path keeps text on your network. AI
search matches the persisted extracted text and hands the model **fenced excerpts** of matched
documents — through the same channel-separation markers used everywhere untrusted document text
meets the model, with the prompt rule (asserted by tests) that fenced content is data, never
instructions. Classification is a keyword-heuristic prompt — expect it to degrade on
multilingual or unusual board packs; the approval queue is the control.

### Transport & input hardening

Helmet headers; 1 MB body cap; UUID route validation; field allowlisting; `sanitize-html` +
DOMPurify on rendered rich text; multi-layer rate limiting; CORS with an explicit production
allowlist; upload size/type limits and path-traversal-contained downloads.

---

## Known limitations

Real, tracked, and stated plainly — do your own review before using this with production board data:

- **The integrity boundary is the application server.** The keyed audit chain and signed certificates
  are tamper-evident against database compromise (dumps, backups, SQL-level writes, a rogue DBA).
  An actor who also holds `SERVER_SIGNING_SECRET` — i.e. who owns the app server — can re-seal and
  re-sign everything. There is **no external anchor** (off-host signed chain head) yet. Per-user
  minutes signatures survive even that actor, except for the recorded-public-key substitution
  described in docs/SIGNING.md (detected only by out-of-band fingerprints).
- **Prompt injection is mitigated, not solved.** Channel fencing + persisted text + the approval-time
  quote check are hallucination and hygiene controls; an attacker who controls a document can quote
  their own injected text truthfully. Render-vs-extract divergence (white text, `/ToUnicode`
  remapping, homoglyphs) is **not implemented**. The human approval queue is the barrier that
  matters: review the rendered document.
- **Governance defaults are not legal advice.** Abstention treatment, quorum bases, unanimity, the
  deadline policy, proxy-attendance counting, and recusal disclosure on secret ballots all ship with
  defensible defaults and per-rule configuration — whether those match your jurisdiction and charter
  is a lawyer's call.
- **Two-factor is TOTP only** (no WebAuthn/passkeys yet; enrollment is built to accept them later).
  No SSO/OIDC.
- **No application-level encryption at rest.** Minutes, resolutions, documents, and AI-flagged
  passages are plaintext in Postgres and on disk; the only at-rest control is operator-provided
  full-disk encryption, which does not defend against dumps, backup leaks, a compromised process, or
  a subpoena on the host. A complete execution plan exists at
  [docs/ENCRYPTION_AT_REST.md](docs/ENCRYPTION_AT_REST.md) but is not built.
- **Short-window login throttles are per-process** (in-memory; reset on restart). The durable 24-hour
  lockout is Postgres-backed and unaffected.
- **One author, model-assisted, no independent audit.** This codebase was written and reviewed with
  heavy AI assistance and has had structured audits and an external review, but no independent
  professional security audit or penetration test. The MIT license carries no warranty. If your board
  needs assurance, buy assurance — do not substitute this document for it.

## Pre-production checklist

- [ ] `SESSION_SECRET` and `SERVER_SIGNING_SECRET` are strong random strings (`openssl rand -hex 32`);
      the signing secret is stored outside the database and outside database backups.
- [ ] The server signing key's **fingerprint** (logged at provisioning) is recorded out of band, as
      are all signer fingerprints.
- [ ] `NODE_ENV=production` and `ALLOWED_ORIGIN` set to your exact origin(s).
- [ ] Postgres on a private network with SSL and backups; encrypted volumes / managed-DB encryption.
- [ ] HTTPS at the reverse proxy; exactly one proxy hop.
- [ ] `DEMO_MODE` unset (the destructive reset route is then not even registered).
- [ ] The governance defaults (abstention, quorum basis, unanimity, deadline policy) reviewed against
      your charter by someone qualified to do so.
- [ ] Run your own dependency and code audit.
