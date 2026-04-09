# Security Policy

## Reporting Vulnerabilities

If you find a security vulnerability in EasyBoard, **[open an issue](https://github.com/SaifAlYounan/EasyBoard/issues)**. This is an open-source project — the code is public, the audit results are public, and the known issues are public. There is nothing to hide.

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
| Data | Full audit trail, SHA-256 signatures on minutes |
| Infrastructure | No debug endpoints, no source maps, no stack traces in responses |

### Data Sovereignty

EasyBoard is designed to be self-hosted. When you run it on your own infrastructure:

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

EasyBoard takes the opposite approach. The code is public. The vulnerabilities are public. The fixes are public.

**What you get:**
- **Full code audit capability.** Any security researcher, any governance professional, any regulator can read every line of code. Nothing is hidden.
- **Full deployment control.** Run it on your servers, in your jurisdiction, behind your firewall. No third-party access to your data.
- **Transparent security history.** The [Security Audit Status](README.md#security-audit-status) section of the README documents every vulnerability found across 3 rounds of auditing — what was wrong, when it was fixed, and what's still open.
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

EasyBoard's security-relevant dependencies:

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

EasyBoard has undergone five rounds of automated adversarial security auditing:

- **Round 1:** 4 critical, 5 high, 8 medium, 3 low — all fixed
- **Round 2:** 0 critical, 1 high, 2 medium, 4 low — all fixed
- **Round 3:** 0 critical, 2 high, 4 medium, 4 low — all fixed
- **Round 4:** 2 critical, 4 high, 6 medium, 5 low — all fixed
- **Round 5:** 0 critical, 2 high, 4 medium, 2 low — fixes in progress (comprehensive round with full regression verification: 37/38 prior findings confirmed fixed)

Each round consists of three parallel agents:
1. **Security audit** — fresh clone, read every route/lib file, live API testing with curl across all roles, adversarial testing (XSS, SQL injection, IDOR, privilege escalation, prompt injection)
2. **Static code review** — every frontend component and backend route checked for dead code, missing error handling, type safety, accessibility, state management
3. **Live E2E functional testing** — curl-based testing of every endpoint, every role, full lifecycle testing (vote create → cast → close → certificate, minutes draft → review → signing → signed)

Each agent runs independently with a fresh clone of the repository. Findings are cross-referenced and verified against actual source code before being reported.

Full findings from each round are documented in the [README changelog](README.md#changelog) and [Known Issues](README.md#known-issues-being-fixed).

*Last updated: April 8, 2026*
