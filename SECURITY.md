# Security Policy

## Reporting Vulnerabilities

If you find a security vulnerability in Open Board, **[open an issue](https://github.com/SaifAlYounan/Open Board/issues)**. This is an open-source project — the code is public, the audit results are public, and the known issues are public. There is nothing to hide.

Include:
- Description of the vulnerability
- Steps to reproduce (or the affected file/line)
- Impact assessment (what an attacker could do)

If you prefer private disclosure, email: **[redacted]**

**Response time:** We aim to acknowledge within 48 hours and provide a fix timeline within 7 days. All disclosures are credited in the changelog (unless you prefer to remain anonymous).

---

## Disclosure Policy

1. **Reporter opens an issue** (or emails if they prefer private disclosure)
2. **We acknowledge** within 48 hours
3. **We assess severity** and agree on a fix timeline
4. **We develop and test** the fix
5. **We release the fix** and update the changelog with full details of what was wrong and how it was fixed

We will not take legal action against researchers who report vulnerabilities in good faith.

---

## Security Design Principles

### Human-in-the-Loop by Default

Every AI-proposed action goes through the Secretary's approval queue. The AI classifies documents and suggests actions — it never executes them autonomously. This is a deliberate architectural choice: in board governance, no automated system should make decisions without human oversight.

### Least Privilege

- **Board Members** can only see boards they're assigned to
- **Observers** have read-only access to their assigned boards
- **Management** sees only their tasks and board decisions relevant to their work
- **Only the Secretary (admin)** can create meetings, votes, tasks, manage users, or reset data

Access is deny-by-default. Every endpoint verifies the requesting user has explicit access to the entity they're requesting.

### Defense in Depth

Security does not rely on a single layer:

| Layer | Control |
|-------|---------|
| Transport | HTTPS (enforced via HSTS) |
| Headers | Helmet (CSP, X-Frame-Options, X-Content-Type-Options) |
| Authentication | JWT in HttpOnly secure cookies, bcrypt password hashing |
| Authorization | Per-entity access control with DB-level uniqueness constraints |
| Input | sanitize-html (backend), DOMPurify (frontend), Zod schemas, UUID validation |
| Rate Limiting | Per-IP + per-email on auth, per-user on writes and AI |
| Data | Full audit trail, SHA-256 integrity hashes on votes and minutes |
| Infrastructure | No debug endpoints, no source maps, no stack traces in responses |

### Data Sovereignty

Open Board is designed to be self-hosted. When you run it on your own infrastructure:

- Your board documents never leave your servers
- No telemetry, no analytics, no CDN calls
- The AI API key is the only external dependency, and it's optional
- You control your database, your backups, your jurisdiction

---

## Open Source vs. Proprietary Board Portals: A Security Comparison

Board governance platforms handle some of the most sensitive corporate information: strategic plans, M&A discussions, executive compensation, legal opinions, and voting records. The security model matters.

### The Proprietary Model

Vendors like Diligent, Nasdaq Boardvantage, and OnBoard operate as SaaS platforms. Your board documents are stored on their infrastructure, managed by their teams, under their jurisdiction.

**What you get:**
- Managed infrastructure and patching
- SOC 2 / ISO 27001 certifications
- Dedicated security teams

**What you give up:**
- **Visibility into the code.** You cannot audit what runs on their servers. You trust their security claims without the ability to verify them.
- **Data sovereignty.** Your documents are on their servers, in their jurisdiction. Under the US CLOUD Act, a US-headquartered vendor can be compelled to produce data stored anywhere in the world — including your board minutes.
- **Vendor lock-in.** Your governance history is trapped in their format, on their platform. Migration is painful by design.
- **Changelog transparency.** When a proprietary vendor patches a vulnerability, they don't publish what was wrong. You have no way to assess whether vulnerabilities existed during the period your data was on their platform.

### The Open Source Model

Open Board takes the opposite approach. The code is public. The vulnerabilities are public. The fixes are public.

**What you get:**
- **Full code audit capability.** Any security researcher, any governance professional, any regulator can read every line of code. Nothing is hidden.
- **Full deployment control.** Run it on your servers, in your jurisdiction, behind your firewall. No third-party access to your data.
- **Transparent security history.** The [Security Audit Status](README.md#security-audit-status) section of the README documents every vulnerability found across 12 rounds of auditing — what was wrong, when it was fixed, and what remains open.
- **No vendor dependency.** You own the code and the data. If this project disappears tomorrow, you still have everything.

**What you give up:**
- You are responsible for hosting, patching, and maintaining the application
- You need technical staff (or a technical partner) to deploy and operate it
- No SOC 2 certification (yet — this is a function of resources, not architecture)

### The Core Argument

Proprietary vendors ask you to trust their security. Open-source projects let you verify it.

A SOC 2 certificate tells you that an auditor checked a vendor's *processes* at a point in time. An open-source codebase lets you check the *actual code* at any time.

For board governance — where the stakes include regulatory liability, fiduciary duty, and director personal exposure — the ability to verify should not be optional.

---

## Current Security Posture

See [README.md — Security Audit Status](README.md#security-audit-status) for the latest findings, fixes, and known issues. This section is updated after each audit round.

---

## Dependencies

Open Board's security-relevant dependencies:

| Package | Purpose | Notes |
|---------|---------|-------|
| `jsonwebtoken` | JWT signing/verification | Tokens in HttpOnly cookies |
| `bcryptjs` | Password hashing | Cost factor 10 |
| `helmet` | HTTP security headers | CSP, HSTS, X-Frame-Options |
| `sanitize-html` | Backend input sanitization | Two modes: plain text + rich HTML |
| `dompurify` | Frontend HTML sanitization | Renders minutes content safely |
| `express-rate-limit` | Rate limiting | Auth, AI, and write endpoints |
| `cookie-parser` | Cookie handling | HttpOnly JWT cookie parsing |
| `drizzle-orm` | Database ORM | Parameterized queries (SQL injection prevention) |
| `multer` | File uploads | 10MB limit, extension validation |
| `zod` | Schema validation | Login form validation |

We monitor dependencies for known vulnerabilities and update promptly.

---

### Audit History

Open Board has undergone twelve rounds of security auditing using multiple AI models and methodologies:

**Rounds 1–10** used automated AI agents (MiniMax M2.7 via OpenClaw), three parallel agents per round:
1. **Security audit** — fresh clone, live API testing with curl across all roles, adversarial testing (XSS, SQL injection, IDOR, privilege escalation, prompt injection)
2. **Static code review** — every route and lib file checked for auth gaps, validation issues, type safety
3. **Live E2E functional testing** — curl-based testing of every endpoint, every role, full lifecycle testing

- **Rounds 1–4:** 4 critical, 5 high, 8 medium, 3 low (Round 1) down to 2 critical, 4 high, 6 medium, 5 low (Round 4) — all fixed
- **Rounds 5–7:** Validation gaps, enum mismatches, rate limiting — all fixed
- **Round 8:** Verification — 0 findings, 61 regression items confirmed fixed
- **Round 9:** Adversarial red team — 0 critical, 0 high, 2 medium, 4 low. Documented as known limitations
- **Round 10:** Post-launch verification of secret ballot, document access, auto-attach. Found and fixed 2 issues.

**Round 11** was a multi-model review:
- **Claude Opus 4.6** (full static audit, reading entire codebase): flagged 4 catastrophic, 11 critical, 23 high-severity architectural and design issues — transaction safety, idempotency, certificate hash coverage, trust boundary validation, README claim accuracy
- **MiniMax M2.7** (3 parallel agents, same methodology as Rounds 1–10): found 0 new issues in the same codebase — demonstrating that endpoint-level automated testing cannot catch architectural and design-level flaws

Manual source code verification confirmed all 4 catastrophic and most critical findings as real. v2.8 addressed 8 of the 15 most-severe items fully, 2 partially, with 5 still open (including architectural items requiring a validation-layer refactor).

**Round 12** (post-fix verification):
- 4 MiniMax M2.7 agents (security audit, code review, E2E testing, 25-item change verification) re-tested after v2.8
- Confirmed 10 of 12 applied fixes are working correctly
- Identified 2 fixes that did not land as intended: reject endpoint missing idempotency check, admin force-approve still possible on open votes
- All findings cross-verified against source code

**Current posture: BETA** — all endpoint-level findings from Rounds 1–10 are resolved. Of the 15 most-severe architectural findings from Round 11, 8 are fully fixed, 2 partially fixed, 5 remain open. See [README.md — Security Audit Status](README.md#security-audit-status) for full details.

*Last updated: April 9, 2026*
