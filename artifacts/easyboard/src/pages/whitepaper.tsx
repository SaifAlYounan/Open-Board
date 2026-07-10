import { Link } from "wouter";
import { ArrowLeft, Shield } from "lucide-react";

export default function Whitepaper() {
  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-[#e5e5e7] px-6 py-4 flex items-center justify-between">
        <Link href="/">
          <button className="flex items-center gap-2 text-[#86868b] hover:text-[#1d1d1f] transition-colors text-sm font-medium">
            <ArrowLeft size={16} />
            Back to Open Board
          </button>
        </Link>
        <div className="flex items-center gap-2 text-sm text-[#86868b]">
          <Shield size={14} className="text-[#0071e3]" />
          Security Architecture
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-16">
        <div className="mb-12 space-y-3">
          <div className="inline-flex items-center gap-2 bg-[#0071e3]/10 text-[#0071e3] text-xs font-semibold px-3 py-1.5 rounded-full tracking-wide uppercase">
            <Shield size={12} />
            Security White Paper
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight text-[#1d1d1f]">
            Open Board Security Architecture
          </h1>
          <p className="text-[#86868b] text-lg leading-relaxed">
            Why Open Source and Self-Hosted Is the Secure Choice for Board Management
          </p>
        </div>

        <div className="bg-white border border-[#e5e5e7] rounded-2xl p-6 mb-12">
          <h2 className="text-lg font-semibold mb-3 text-[#1d1d1f]">Executive Summary</h2>
          <p className="text-[#86868b] leading-relaxed">
            Board management platforms handle the most sensitive information in any organization: M&A valuations,
            executive compensation, legal privilege, strategic plans, and regulatory filings. The security architecture
            of the platform handling this information deserves scrutiny beyond marketing claims and compliance certificates.
          </p>
          <p className="text-[#86868b] leading-relaxed mt-3">
            This document addresses the ten most common objections raised against open-source, self-hosted board
            management platforms — and demonstrates why each objection, when examined on its merits, argues in
            favor of the open-source model rather than against it.
          </p>
        </div>

        <div className="space-y-12">
          <Section
            number="1"
            title='"Open source exposes vulnerabilities to attackers"'
            content={`This argument was formally debunked in the security community over a century ago. Kerckhoffs's Principle (1883) — the foundational axiom of modern cryptography — states that a system's security must depend on the secrecy of its keys, not the secrecy of its design.

In practice: Linux runs 96% of the world's top million servers and 100% of the top 500 supercomputers. Signal, recommended by the European Commission and multiple national security agencies for sensitive communications, is fully open source. Every TLS connection securing global banking, healthcare, and government communications relies on open-source implementations.

A closed-source board management platform relies on internal teams to identify vulnerabilities. An open-source platform invites the global security community to audit, test, and improve it. The empirical evidence overwhelmingly favors the latter model.`}
            question="Can I audit the source code of the platform handling my board's most privileged documents? If not, on what basis am I trusting its security?"
          />

          <Section
            number="2"
            title='"Self-hosted means the customer bears the security burden"'
            content={`Correct. That is precisely the advantage.

With a vendor-hosted platform: board documents reside on infrastructure controlled by a third party, accessible to their administrators, support staff, and contractors. The organization has no independent visibility into who accesses the data, how it is stored, or what happens during a security incident.

With a self-hosted deployment: data resides on the organization's own infrastructure, within its own jurisdiction, under its own security policies. The organization's security team has full access to logs, network traffic, database queries, and application behavior in real time.

The legal dimension: Under most data protection frameworks (GDPR Article 28, ADGM Data Protection Regulations 2021, DIFC Data Protection Law), the data controller remains liable for its processor's failures. Outsourcing board document hosting does not outsource accountability. Self-hosting aligns control with accountability.

The privilege dimension: Board documents routinely contain legal professional privilege. Under common law and civil law traditions, privilege can be waived if documents are disclosed to third parties without adequate safeguards. Hosting privileged documents on a vendor's infrastructure introduces a privilege risk that warrants careful legal analysis.`}
            question="Do you have an independent legal opinion on whether your current board portal arrangement adequately protects legal professional privilege?"
          />

          <Section
            number="3"
            title='"Our platform has SOC 2 Type II / ISO 27001 certification"'
            content={`These certifications confirm that an organization has documented security processes and follows them consistently. They do not confirm that those processes are effective, that the code is secure, or that the platform has not been breached.

Notable examples: SolarWinds maintained SOC 2 Type II certification when a nation-state actor compromised its build pipeline and infiltrated 18,000 organizations, including government agencies. Equifax was PCI-DSS compliant when 147 million records were exposed. Capital One passed every applicable AWS security audit when a misconfigured firewall rule exposed 100 million customer records.

Compliance certifications are a necessary but insufficient condition for security. They verify process, not outcome. Open-source code allows verification of outcome — anyone can examine the actual encryption implementation, access control logic, and data handling.`}
            question="Does your certification tell me what encryption algorithm protects my data at rest? What hashing algorithm secures passwords? How session tokens are generated and validated? Open source answers all of these questions directly."
          />

          <Section
            number="4"
            title='"AI processing of board documents creates data exposure risk"'
            content={`This is the one objection with legitimate technical substance. The answer depends entirely on architecture.

Typical vendor approach: board documents are sent to a cloud AI provider through the vendor's infrastructure. The customer has no visibility into the data pipeline — what is sent, how it is processed, whether it is retained, or whether it is used for model training.

Open Board approach: AI calls go directly from the organization's server to the AI provider — no intermediary infrastructure. Every AI call is visible in the source code, so the exact data payload sent and received can be audited. The provider is configurable: the Anthropic API (optionally through an Anthropic-compatible gateway you host yourself), or fully local / OpenAI-compatible inference (Ollama, vLLM, LM Studio and similar — set AI_PROVIDER=openai-compatible and AI_BASE_URL) so board documents never leave your network at all. AI can also be disabled entirely. No vendor-hosted platform can offer this level of auditability because they do not provide their source code.`}
            question="When I use your AI features, where exactly does my document text go? Through whose infrastructure? Is it retained?"
          />

          <Section
            number="5"
            title='"Self-hosted software requires dedicated security expertise"'
            content={`Any organization with a board of directors has IT infrastructure. That infrastructure team already manages email servers, ERP systems, CRM platforms, and network security. A Node.js application with PostgreSQL is well within the competency of any professional IT department.

Open Board's dependency footprint is minimal and entirely mainstream: Express (widely deployed web framework), PostgreSQL (25+ year track record), React (used by the largest consumer and enterprise platforms globally), bcryptjs, JWT, SHA-256 — industry-standard security primitives.

The cost comparison: the annual licensing fee for a typical proprietary board management platform ($50,000–$150,000+) exceeds the annual cost of infrastructure and maintenance for a self-hosted deployment by a significant multiple. The organization spends less and gets more control.`}
            question="What is the total annual cost of your platform including implementation, training, and support? Have you compared that to the cost of a self-hosted deployment?"
          />

          <Section
            number="6"
            title='"We offer data residency in your jurisdiction"'
            content={`Data residency is one of the strongest arguments for self-hosting.

With a vendor-hosted platform: the vendor claims data is stored in a specific jurisdiction, but data may transit through other jurisdictions during processing, backup, replication, or support operations. If the vendor is headquartered in the United States, the CLOUD Act (Clarifying Lawful Overseas Use of Data Act, 2018) gives the US government authority to compel the production of data controlled by US companies regardless of where that data is physically stored. A contractual guarantee of data residency in Abu Dhabi, Frankfurt, or Singapore does not override a US court order under the CLOUD Act.

With a self-hosted deployment: data resides on the organization's own servers. Full stop. No cross-border transfers. No adequacy decisions. No Standard Contractual Clauses. No Transfer Impact Assessments. No CLOUD Act exposure — the data is not controlled by a foreign entity.`}
            question="Is your company subject to the jurisdiction of any government other than ours? If so, can you guarantee that no foreign government can compel you to produce my board documents? Under what legal authority?"
          />

          <Section
            number="7"
            title='"Who provides support during a security incident?"'
            content={`With a vendor-hosted platform: the customer calls a support line and waits for the vendor's incident response team — potentially in a different timezone — to investigate and report back. The customer has no independent verification capability. Industry data shows that vendor disclosure timelines frequently extend to weeks or months after initial compromise.

With a self-hosted platform: the organization's own security team has immediate access to application logs, database records, network traffic, and system-level forensics. Incident response begins within minutes, not when the vendor decides to disclose. The organization can engage its own forensic consultants with full access to all relevant systems. Open-source platforms benefit from transparent vulnerability disclosure, published CVEs with patches, and community-driven security advisories.`}
            question="In your last security incident, how many hours elapsed between detection and customer notification? With self-hosted, that number is zero — our team detects and responds in real time."
          />

          <Section
            number="8"
            title='"Board portals require enterprise-grade encryption"'
            content={`Open Board uses open cryptographic standards you can verify in the source: bcryptjs (adaptive hashing) for password storage, SHA-256 for document-integrity verification and signature hashes, and JWT with configurable expiry for session management. Transport encryption (TLS) is terminated at your reverse proxy, and encrypted database connections (SSL) and encryption at rest are configured on your own infrastructure — the same operator-provided controls any self-hosted platform relies on.

There is no proprietary "enterprise-grade" encryption that differs from these open standards. SHA-256 is SHA-256; the mathematics do not change based on licensing fees. The difference is that with open source you can verify the implementation, and with closed source you trust a claim.`}
            question="Name one cryptographic algorithm in your platform that is not available in open source."
          />

          <Section
            number="9"
            title={`"Open-source projects can't keep pace with security patches"`}
            content={`Open Board's core dependencies are among the most actively maintained software projects in existence: PostgreSQL (25-year track record, timely security releases), Node.js / Express (backed by the OpenJS Foundation, millions of production deployments), React (maintained by one of the largest technology companies). These projects issue security advisories and patches on a faster cadence than most proprietary software vendors.

By contrast, proprietary platforms disclose vulnerabilities only when the vendor chooses to — and customers have no way to independently verify whether a vulnerability exists, when it was discovered, or how long it took to patch.`}
            question="How long, on average, between when your team discovers a vulnerability and when your customers are notified? With open source, the answer is public record."
          />

          <Section
            number="10"
            title='"Regulatory compliance requires a certified platform"'
            content={`No regulatory framework in any jurisdiction requires a specific vendor. Regulations require specific controls: access management (role-based access control with per-entity permissions), encryption in transit and at rest (operator-configured at the proxy / database / storage layer), audit trail (complete logging of every action, user, entity, timestamp), data protection (self-hosted deployment with full data-controller ownership), and business continuity (standard database backup and infrastructure redundancy).

These controls are implemented identically regardless of whether the software is proprietary or open source. The regulatory requirement is the control, not the brand.`}
            question="Please cite the specific regulation that requires a proprietary vendor rather than the implementation of specific security controls."
          />

          <div className="mt-16 p-8 bg-[#0071e3]/8 border border-[#0071e3]/20 rounded-2xl text-center space-y-4">
            <h2 className="text-2xl font-semibold text-[#1d1d1f]">Conclusion</h2>
            <p className="text-[#86868b] leading-relaxed max-w-xl mx-auto">
              The security debate around board management platforms ultimately reduces to a simple question:{" "}
              <strong className="text-[#1d1d1f]">Do you want security you can verify, or security you must trust?</strong>
            </p>
            <p className="text-[#86868b]">
              Proprietary platforms ask for trust. Open-source platforms offer proof.
            </p>
            <p className="text-sm text-[#86868b] mt-4">
              For organizations handling the most sensitive governance information — M&A strategy, legal privilege, executive
              compensation, regulatory filings — the ability to independently verify security architecture is not a luxury.
              It is a fiduciary responsibility.
            </p>
          </div>

          <p className="text-xs text-[#86868b] text-center pb-8">
            Open Board is open source under the MIT License. The complete source code, database schema, AI integration,
            and security architecture are available for audit at any time.
          </p>
        </div>
      </main>
    </div>
  );
}

function Section({ number, title, content, question }: {
  number: string;
  title: string;
  content: string;
  question: string;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className="w-8 h-8 rounded-full bg-[#0071e3]/15 text-[#0071e3] text-sm font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
          {number}
        </div>
        <h2 className="text-xl font-semibold text-[#1d1d1f] leading-snug">{title}</h2>
      </div>
      <div className="ml-12 space-y-3">
        {content.split("\n\n").map((para, i) => (
          <p key={i} className="text-[#86868b] leading-relaxed">{para}</p>
        ))}
        <div className="mt-4 pl-4 border-l-2 border-[#0071e3]/40">
          <p className="text-sm text-[#0071e3] italic leading-relaxed">
            The question to ask: "{question}"
          </p>
        </div>
      </div>
    </div>
  );
}
