# EasyBoard Security Architecture
## Why Open Source and Self-Hosted Is the Secure Choice for Board Management

---

### Executive Summary

Board management platforms handle the most sensitive information in any organization: M&A valuations, executive compensation, legal privilege, strategic plans, and regulatory filings. The security architecture of the platform handling this information deserves scrutiny beyond marketing claims and compliance certificates.

This document addresses the ten most common objections raised against open-source, self-hosted board management platforms — and demonstrates why each objection, when examined on its merits, argues in favor of the open-source model rather than against it.

---

### 1. "Open source exposes vulnerabilities to attackers"

This argument was formally debunked in the security community over a century ago. Kerckhoffs's Principle (1883) — the foundational axiom of modern cryptography — states that a system's security must depend on the secrecy of its keys, not the secrecy of its design.

In practice:

- Linux runs 96% of the world's top million servers and 100% of the top 500 supercomputers.
- Signal, recommended by the European Commission and multiple national security agencies for sensitive communications, is fully open source.
- Every TLS connection securing global banking, healthcare, and government communications relies on open-source implementations.
- The largest technology companies in the world publish their security-critical code as open source specifically because public scrutiny improves security outcomes.

A closed-source board management platform relies on internal teams to identify vulnerabilities. An open-source platform invites the global security community to audit, test, and improve it. The empirical evidence overwhelmingly favors the latter model.

**The question to ask:** "Can I audit the source code of the platform handling my board's most privileged documents? If not, on what basis am I trusting its security?"

---

### 2. "Self-hosted means the customer bears the security burden"

Correct. That is precisely the advantage.

With a vendor-hosted platform:
- Board documents reside on infrastructure controlled by a third party, accessible to their administrators, support staff, and contractors.
- The organization has no independent visibility into who accesses the data, how it is stored, or what happens during a security incident.
- Incident response depends entirely on the vendor's timeline and transparency.

With a self-hosted deployment:
- Data resides on the organization's own infrastructure, within its own jurisdiction, under its own security policies.
- The organization's security team has full access to logs, network traffic, database queries, and application behavior in real time.
- Incident response begins immediately with full forensic capability — no dependency on vendor disclosure timelines.

**The legal dimension:** Under most data protection frameworks (GDPR Article 28, ADGM Data Protection Regulations 2021, DIFC Data Protection Law), the data controller remains liable for its processor's failures. Outsourcing board document hosting does not outsource accountability. Self-hosting aligns control with accountability.

**The privilege dimension:** Board documents routinely contain legal professional privilege. Under common law and civil law traditions, privilege can be waived if documents are disclosed to third parties without adequate safeguards. Hosting privileged documents on a vendor's infrastructure introduces a privilege risk that warrants careful analysis.

---

### 3. "Our platform has SOC 2 Type II / ISO 27001 certification"

These certifications confirm that an organization has documented security processes and follows them consistently. They do not confirm that those processes are effective, that the code is secure, or that the platform has not been breached.

Notable examples:
- SolarWinds maintained SOC 2 Type II certification when a nation-state actor compromised its build pipeline and infiltrated 18,000 organizations, including government agencies.
- Equifax was PCI-DSS compliant when 147 million records were exposed.
- Capital One passed every applicable AWS security audit when a misconfigured firewall rule exposed 100 million customer records.

Compliance certifications are a necessary but insufficient condition for security. They verify process, not outcome. Open-source code allows verification of outcome — anyone can examine the actual encryption implementation, access control logic, and data handling.

**The question to ask:** "Does your certification tell me what encryption algorithm protects my data at rest? What hashing algorithm secures passwords? How session tokens are generated and validated? Open source tells me all of these things."

---

### 4. "AI processing of board documents creates data exposure risk"

This is the one objection with legitimate technical substance. The answer depends entirely on architecture.

**Typical vendor approach:** Board documents are sent to a cloud AI provider through the vendor's infrastructure. The customer has no visibility into the data pipeline — what is sent, how it is processed, whether it is retained, or whether it is used for model training.

**EasyBoard approach:**
- AI calls go directly from the organization's server to the AI provider — no intermediary infrastructure.
- The organization selects its AI provider and can contractually verify data handling terms (e.g., Anthropic's commitment: "We do not train our models on your inputs and outputs").
- Every AI call is visible in the source code — the exact data payload sent and received can be audited.
- For maximum security: deploy a local language model (Llama, Mistral, or equivalent) via self-hosted inference. Board documents never leave the organization's network. No vendor-hosted platform can offer this because they do not provide their source code.

**The question to ask:** "When I use your AI features, where exactly does my document text go? Through whose infrastructure? Is it retained? Can I run a local model instead?"

---

### 5. "Self-hosted software requires dedicated security expertise"

Any organization with a board of directors has IT infrastructure. That infrastructure team already manages email servers, ERP systems, CRM platforms, and network security. A Node.js application with PostgreSQL is well within the competency of any professional IT department.

EasyBoard's dependency footprint is minimal and entirely mainstream:
- Express (one of the most widely deployed web frameworks, with millions of weekly downloads)
- PostgreSQL (25+ year track record, fewer critical CVEs than most enterprise databases)
- React (used by the largest consumer and enterprise platforms globally)
- bcryptjs, JWT, SHA-256 — industry-standard security primitives

Dependency management is handled through standard tooling (`npm audit`, automated security advisories). PostgreSQL security patches are published on a regular schedule with clear upgrade paths.

**The cost comparison:** The annual licensing fee for a typical proprietary board management platform ($50,000–$150,000+) exceeds the annual cost of infrastructure and maintenance for a self-hosted deployment by a significant multiple. The organization spends less and gets more control.

---

### 6. "We offer data residency in your jurisdiction"

Data residency is one of the strongest arguments for self-hosting.

With a vendor-hosted platform:
- The vendor claims data is stored in a specific jurisdiction, but data may transit through other jurisdictions during processing, backup, replication, or support operations.
- Contractual guarantees of data residency are difficult to verify and frequently include exceptions for "operational purposes."
- If the vendor is headquartered in the United States, the CLOUD Act (Clarifying Lawful Overseas Use of Data Act, 2018) gives the US government authority to compel the production of data controlled by US companies regardless of where that data is physically stored. A contractual guarantee of data residency in Abu Dhabi, Frankfurt, or Singapore does not override a US court order under the CLOUD Act.

With a self-hosted deployment:
- Data resides on the organization's own servers. Full stop.
- No cross-border transfers. No adequacy decisions. No Standard Contractual Clauses. No Transfer Impact Assessments.
- No CLOUD Act exposure — the data is not controlled by a foreign entity.

**The question to ask:** "Is your company subject to the jurisdiction of any government other than ours? If so, can you guarantee that no foreign government can compel you to produce my board documents? Under what legal authority?"

---

### 7. "Who provides support during a security incident?"

With a vendor-hosted platform:
- The customer calls a support line and waits for the vendor's incident response team — potentially in a different timezone — to investigate and report back.
- The customer has no independent verification capability. Forensic analysis is entirely in the vendor's hands.
- Industry data shows that vendor disclosure timelines frequently extend to weeks or months after initial compromise. During this period, the customer has no visibility into the scope or impact of the breach.

With a self-hosted platform:
- The organization's own security team has immediate access to application logs, database records, network traffic, and system-level forensics.
- Incident response begins within minutes, not when the vendor decides to disclose.
- The organization can engage its own forensic consultants with full access to all relevant systems.
- Open-source platforms benefit from transparent vulnerability disclosure, published CVEs with patches, and community-driven security advisories.

**The question to ask:** "In your last security incident, how many hours elapsed between detection and customer notification? With self-hosted, that number is zero — our team detects and responds in real time."

---

### 8. "Board portals require enterprise-grade encryption"

EasyBoard implements the same cryptographic standards used by every major technology platform and financial institution:

- **TLS 1.3** for data in transit
- **bcryptjs** (adaptive hashing) for password storage
- **SHA-256** for document integrity verification and digital signatures
- **JWT** with configurable expiry for session management
- **PostgreSQL** encrypted connections for database communication

There is no proprietary "enterprise-grade" encryption that differs from the open standards used by EasyBoard. AES-256 is AES-256. SHA-256 is SHA-256. The mathematics do not change based on licensing fees. The difference is that with open-source, you can verify the implementation. With closed-source, you trust a claim.

**The question to ask:** "Name one cryptographic algorithm in your platform that is not available in open source."

---

### 9. "Open-source projects can't keep pace with security patches"

EasyBoard's core dependencies are among the most actively maintained software projects in existence:

- PostgreSQL: maintained by a global team of contributors, with a 25-year track record of timely security releases.
- Node.js / Express: backed by the OpenJS Foundation, with millions of production deployments worldwide.
- React: maintained by one of the largest technology companies, with an extensive security review process.

These projects issue security advisories and patches on a faster cadence than most proprietary software vendors. The `npm audit` toolchain automatically identifies known vulnerabilities and their fixes.

By contrast, proprietary platforms disclose vulnerabilities only when the vendor chooses to — and customers have no way to independently verify whether a vulnerability exists, when it was discovered, or how long it took to patch.

**The question to ask:** "How long, on average, between when your team discovers a vulnerability and when your customers are notified? With open source, the answer is public record."

---

### 10. "Regulatory compliance requires a certified platform"

No regulatory framework in any jurisdiction requires a specific vendor. Regulations require specific controls:

- **Access management** — role-based access control with per-entity permissions ✓
- **Encryption** — in transit and at rest ✓
- **Audit trail** — complete logging of every action, user, entity, timestamp, and IP address ✓
- **Data protection** — self-hosted deployment with full data controller ownership ✓
- **Business continuity** — standard database backup and infrastructure redundancy ✓

These controls are implemented identically regardless of whether the software is proprietary or open source. The regulatory requirement is the control, not the brand.

**The question to ask:** "Please cite the specific regulation that requires a proprietary vendor rather than the implementation of specific security controls."

---

### Conclusion

The security debate around board management platforms ultimately reduces to a simple question: **Do you want security you can verify, or security you must trust?**

Proprietary platforms ask for trust. Open-source platforms offer proof.

For organizations handling the most sensitive governance information — M&A strategy, legal privilege, executive compensation, regulatory filings — the ability to independently verify security architecture is not a luxury. It is a fiduciary responsibility.

---

*EasyBoard is open source under the MIT License. The complete source code, database schema, AI integration, and security architecture are available for audit at any time.*
