import { useState, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft, Bot, Users, FileText, Vote, CheckSquare, Shield, Zap, Database, Key, GitBranch, Clock, ChevronRight } from "lucide-react";

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="inline-flex items-center gap-2 bg-[#0071e3]/10 text-[#0071e3] text-xs font-semibold px-3 py-1.5 rounded-full tracking-wide uppercase mb-4">
      {icon}
      {label}
    </div>
  );
}

function Step({ number, title, description }: { number: string; title: string; description: string }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[#0071e3]/15 text-[#0071e3] flex items-center justify-center text-sm font-bold">
        {number}
      </div>
      <div>
        <h4 className="text-[#1d1d1f] font-medium mb-1">{title}</h4>
        <p className="text-[#86868b] text-sm leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function RoleCard({ icon, title, color, description, capabilities }: {
  icon: React.ReactNode;
  title: string;
  color: string;
  description: string;
  capabilities: string[];
}) {
  return (
    <div className="bg-white border border-[#e5e5e7] rounded-2xl p-6 hover:border-[#d1d1d6] transition-colors">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: color + "20", color }}>
          {icon}
        </div>
        <div>
          <h3 className="text-[#1d1d1f] font-semibold">{title}</h3>
        </div>
      </div>
      <p className="text-[#86868b] text-sm mb-4 leading-relaxed">{description}</p>
      <ul className="space-y-1.5">
        {capabilities.map((c, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-[#86868b]">
            <ChevronRight size={14} className="text-[#0071e3] mt-0.5 flex-shrink-0" />
            {c}
          </li>
        ))}
      </ul>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="flex justify-center py-2">
      <div className="w-px h-6 bg-[#d1d1d6] relative">
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-2 h-2 border-r-2 border-b-2 border-[#d1d1d6] rotate-45 translate-y-1" />
      </div>
    </div>
  );
}

function FlowStep({ icon, label, sub, accent }: { icon: React.ReactNode; label: string; sub?: string; accent?: boolean }) {
  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border ${accent ? "border-[#0071e3]/40 bg-[#0071e3]/8" : "border-[#e5e5e7] bg-[#f5f5f7]"}`}>
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${accent ? "bg-[#0071e3]/15 text-[#0071e3]" : "bg-[#e5e5e7] text-[#86868b]"}`}>
        {icon}
      </div>
      <div>
        <p className={`text-sm font-medium ${accent ? "text-[#0071e3]" : "text-[#1d1d1f]"}`}>{label}</p>
        {sub && <p className="text-xs text-[#86868b]">{sub}</p>}
      </div>
    </div>
  );
}

export default function HowItWorks() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 320);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="min-h-screen bg-[#f5f5f7] text-[#1d1d1f]">
      <header className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-[#e5e5e7] px-6 py-4 flex items-center justify-between">
        <Link href="/">
          <button className="flex items-center gap-2 text-[#86868b] hover:text-[#1d1d1f] transition-colors text-sm font-medium">
            <ArrowLeft size={16} />
            Back to LQGovernance
          </button>
        </Link>
        <div className="flex items-center gap-2 text-sm text-[#86868b]">
          <Bot size={14} className="text-[#0071e3]" />
          How It Works
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-16 space-y-20">

        {/* Hero */}
        <div className="space-y-4">
          <SectionHeader icon={<Bot size={12} />} label="Platform Overview" />
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight leading-tight text-[#1d1d1f]">
            How LQGovernance Works
          </h1>
          <p className="text-[#86868b] text-lg leading-relaxed max-w-2xl">
            LQGovernance is an AI-native board governance platform. Claude acts as an intelligent secretary that reads
            your documents, proposes structured governance actions, and executes them the moment you approve. Here is
            exactly how every part of the system fits together.
          </p>
        </div>

        {/* The AI Pipeline */}
        <section className="space-y-8">
          <div>
            <SectionHeader icon={<Bot size={12} />} label="The AI System" />
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3 text-[#1d1d1f]">The Central AI Pipeline</h2>
            <p className="text-[#86868b] leading-relaxed max-w-2xl">
              Every document uploaded to LQGovernance is processed by the configured AI provider — Claude via the
              Anthropic API by default (Claude Opus 4.8; set <code className="font-mono text-xs">AI_MODEL</code> to
              choose another), or a fully local OpenAI-compatible model. The AI reads the full text, classifies its intent, and proposes zero or more
              structured governance actions — never executing anything automatically. A human Secretary reviews every
              proposal before anything is created.
            </p>
          </div>

          <div className="bg-white border border-[#e5e5e7] rounded-2xl p-6 space-y-3">
            <FlowStep icon={<FileText size={15} />} label="Document uploaded by Secretary" sub="PDF, DOCX, XLSX, PPTX, TXT, image" />
            <FlowArrow />
            <FlowStep icon={<Bot size={15} />} label="Claude reads and classifies the document" sub="Confidence score + action type proposed, each grounded in a quote from the source" accent />
            <FlowArrow />
            <FlowStep icon={<GitBranch size={15} />} label="Pending Action queued for Secretary review" sub="create_meeting · create_vote · create_minutes · create_task · flag_confidential" />
            <FlowArrow />
            <FlowStep icon={<CheckSquare size={15} />} label="Secretary approves, edits, or rejects" sub="Secretary can modify any field before approving" />
            <FlowArrow />
            <FlowStep icon={<Zap size={15} />} label="Action executed and stored in the database" sub="Meeting · Resolution · Minutes · Task created automatically" accent />
            <FlowArrow />
            <FlowStep icon={<Users size={15} />} label="Board members and stakeholders notified via their dashboards" sub="Access control granted based on board membership" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-[#e5e5e7] rounded-xl p-5">
              <h4 className="text-[#1d1d1f] font-semibold mb-2 flex items-center gap-2"><Bot size={15} className="text-[#0071e3]" /> What the AI detects</h4>
              <ul className="space-y-2 text-sm text-[#86868b]">
                <li className="flex gap-2"><ChevronRight size={14} className="text-[#0071e3] mt-0.5 flex-shrink-0" />Board meetings: date, location, agenda items</li>
                <li className="flex gap-2"><ChevronRight size={14} className="text-[#0071e3] mt-0.5 flex-shrink-0" />Resolutions: resolution text, voting type, deadline</li>
                <li className="flex gap-2"><ChevronRight size={14} className="text-[#0071e3] mt-0.5 flex-shrink-0" />Meeting minutes: content, associated meeting, signatories</li>
                <li className="flex gap-2"><ChevronRight size={14} className="text-[#0071e3] mt-0.5 flex-shrink-0" />Action items: assignee, task description, due date</li>
                <li className="flex gap-2"><ChevronRight size={14} className="text-[#0071e3] mt-0.5 flex-shrink-0" />Multi-stage approval chains: parallel endorsements + final board vote</li>
                <li className="flex gap-2"><ChevronRight size={14} className="text-[#0071e3] mt-0.5 flex-shrink-0" />Confidential passages requiring restricted access</li>
              </ul>
            </div>
            <div className="bg-white border border-[#e5e5e7] rounded-xl p-5">
              <h4 className="text-[#1d1d1f] font-semibold mb-2 flex items-center gap-2"><Shield size={15} className="text-[#34c759]" /> What the AI cannot do</h4>
              <ul className="space-y-2 text-sm text-[#86868b]">
                <li className="flex gap-2"><ChevronRight size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" />Execute any action without Secretary approval</li>
                <li className="flex gap-2"><ChevronRight size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" />Send communications to board members</li>
                <li className="flex gap-2"><ChevronRight size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" />Access or modify the database directly</li>
                <li className="flex gap-2"><ChevronRight size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" />Sign minutes or cast votes on behalf of anyone</li>
                <li className="flex gap-2"><ChevronRight size={14} className="text-[#34c759] mt-0.5 flex-shrink-0" />See documents it has not been explicitly given to classify</li>
              </ul>
            </div>
          </div>
        </section>

        {/* The Four Roles */}
        <section className="space-y-6">
          <div>
            <SectionHeader icon={<Users size={12} />} label="Role-Based Access" />
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3 text-[#1d1d1f]">Four Roles, Four Interfaces</h2>
            <p className="text-[#86868b] leading-relaxed max-w-2xl">
              Every user in LQGovernance has exactly one role. Role assignment is managed by the Secretary. Each role
              grants a completely separate interface and a precisely scoped set of permissions.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RoleCard
              icon={<Key size={18} />}
              title="Secretary"
              color="#0071e3"
              description="The central human in the loop. Manages the entire governance lifecycle: uploads documents, reviews AI proposals, creates and manages meetings, votes, minutes, members, and tasks."
              capabilities={[
                "Upload and classify documents via AI",
                "Review, edit, and approve or reject all AI-proposed actions",
                "Create and manage board resolutions (circulation and meeting votes)",
                "Configure approval rules: majority, unanimous, two-thirds, custom",
                "Set recused members and key approvers per vote",
                "Manage the minutes workflow: draft → review → signing → signed",
                "Full audit trail access for all platform events",
              ]}
            />
            <RoleCard
              icon={<Vote size={18} />}
              title="Board Member"
              color="#34c759"
              description="Participates in votes, signs minutes, and attends meetings. The AI provides personalised insights on pending items whenever they log in."
              capabilities={[
                "View and cast votes on open resolutions",
                "Vote with comments when needed (with or without approval)",
                "Sign meeting minutes digitally",
                "View meeting agendas, attendance, and supporting materials",
                "Download SHA-256 resolution certificates for closed votes",
                "Receive AI insights on pending items and upcoming deadlines",
              ]}
            />
            <RoleCard
              icon={<CheckSquare size={18} />}
              title="Management"
              color="#ff9500"
              description="Executes board-directed tasks. Receives tasks created from meeting minutes, tracks their progress, and can upload evidence of completion."
              capabilities={[
                "View all tasks assigned by the board",
                "Mark tasks as in-progress or done",
                "Upload evidence of completion",
                "View meeting minutes relevant to their work",
                "AI insights on overdue or upcoming deadlines",
              ]}
            />
            <RoleCard
              icon={<FileText size={18} />}
              title="Observer"
              color="#86868b"
              description="Read-only view of board activity for auditors, regulators, or interested parties. No ability to vote, sign, or create anything."
              capabilities={[
                "View open and closed board resolutions",
                "Access supporting documents attached to votes",
                "View meeting minutes in review (not draft)",
                "See dashboard summary of active governance items",
                "No ability to write, vote, or sign anything",
              ]}
            />
          </div>
        </section>

        {/* Voting Workflow */}
        <section className="space-y-6">
          <div>
            <SectionHeader icon={<Vote size={12} />} label="Resolutions" />
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3 text-[#1d1d1f]">How Voting Works</h2>
            <p className="text-[#86868b] leading-relaxed max-w-2xl">
              Resolutions can be created manually by the Secretary or proposed automatically by the AI after document
              classification. Two vote types are supported: Circulation (members vote asynchronously by deadline) and
              Meeting (vote taken during a session).
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white border border-[#e5e5e7] rounded-xl p-5 space-y-4">
              <h4 className="text-[#1d1d1f] font-semibold">Approval Rules</h4>
              <div className="space-y-2 text-sm">
                {[
                  ["Simple Majority", "More than 50% of the eligible voting weight must approve"],
                  ["Two-Thirds", "At least 66.7% of the eligible voting weight must approve"],
                  ["Three-Quarters", "At least 75% of the eligible voting weight must approve"],
                  ["Unanimous", "Every eligible voter must approve (all voting weight)"],
                  ["Custom", "Secretary sets the exact minimum approval weight and quorum"],
                ].map(([label, desc]) => (
                  <div key={label} className="flex gap-3">
                    <span className="text-[#0071e3] font-medium w-28 flex-shrink-0">{label}</span>
                    <span className="text-[#86868b]">{desc}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white border border-[#e5e5e7] rounded-xl p-5 space-y-4">
              <h4 className="text-[#1d1d1f] font-semibold">Advanced Constraints</h4>
              <div className="space-y-3 text-sm text-[#86868b]">
                <p><span className="text-[#1d1d1f] font-medium">Weighted Voting — </span>Every board member carries a voting weight (default 1). Tally, quorum, and thresholds are computed over weight, so a board where every weight is 1 behaves exactly like classic one-member-one-vote. Each ballot snapshots the weight it was cast with.</p>
                <p><span className="text-[#1d1d1f] font-medium">Proxy Voting — </span>An absent member may grant a per-vote proxy (recorded by the Secretary) to another member of the same board, who casts the ballot on their behalf — always attributed as "cast by X as proxy for Y", counting the principal's weight and quorum presence. Each board caps how many proxies one member may hold (default 1), and the principal's own later vote supersedes a proxy-cast ballot.</p>
                <p><span className="text-[#1d1d1f] font-medium">Recused Members — </span>Members with a conflict of interest are excluded from the eligible voter pool and cannot vote on that resolution.</p>
                <p><span className="text-[#1d1d1f] font-medium">Key Approvers — </span>Specific members whose personal approval is required for the resolution to pass, regardless of whether the majority threshold is met.</p>
                <p><span className="text-[#1d1d1f] font-medium">Auto-close — </span>Once every eligible member has voted, the system automatically evaluates the result, closes the vote, and generates a SHA-256 certificate hash.</p>
                <p><span className="text-[#1d1d1f] font-medium">Deadline behaviour — </span>Recorded per vote as the intended policy (lapse, extend, or notify) for the Secretary to apply when a circulation deadline passes.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Approval Workflows */}
        <section className="space-y-6">
          <div>
            <SectionHeader icon={<GitBranch size={12} />} label="Multi-Stage Workflows" />
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3 text-[#1d1d1f]">Parallel Endorsements & Sequential Approvals</h2>
            <p className="text-[#86868b] leading-relaxed max-w-2xl">
              Some governance decisions require more than one body to weigh in before the board resolves. When the AI
              detects this pattern in a document — language like "subject to FAC and NRC endorsement" or "following
              committee sign-off" — it proposes a multi-stage approval workflow rather than a single vote.
            </p>
          </div>

          <div className="bg-white border border-[#e5e5e7] rounded-2xl p-6 space-y-6">
            <div>
              <h4 className="text-[#1d1d1f] font-semibold mb-3">How parallel stages work</h4>
              <p className="text-[#86868b] text-sm leading-relaxed mb-5">
                Stages are organised into groups. Every stage in the same group runs simultaneously — committees do not
                wait on each other. The next group only opens once every stage in the current group is approved.
                If any stage is rejected, all remaining stages are immediately cancelled.
              </p>
              {/* Visual example */}
              <div className="flex items-start gap-3 flex-wrap">
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-[#86868b] font-medium mb-1">Group 0 — opens immediately</div>
                  <div className="flex gap-2">
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#0071e3]/40 bg-[#0071e3]/8 text-sm text-[#0071e3] font-medium">
                      <Vote size={13} /> FAC Endorsement
                    </div>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#0071e3]/40 bg-[#0071e3]/8 text-sm text-[#0071e3] font-medium">
                      <Vote size={13} /> NRC Endorsement
                    </div>
                  </div>
                  <div className="text-xs text-[#86868b]">Both votes open at the same time</div>
                </div>
                <div className="flex items-center self-center mt-4">
                  <ChevronRight size={18} className="text-[#86868b]" />
                </div>
                <div className="flex flex-col gap-2">
                  <div className="text-xs text-[#86868b] font-medium mb-1">Group 1 — opens when all endorsements are in</div>
                  <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#e5e5e7] bg-[#f5f5f7] text-sm text-[#1d1d1f] font-medium">
                    <Vote size={13} className="text-[#86868b]" /> Board of Directors Approval
                  </div>
                  <div className="text-xs text-[#86868b]">Triggered automatically once FAC and NRC both approve</div>
                </div>
              </div>
            </div>

            <div className="border-t border-[#e5e5e7] pt-5 grid grid-cols-1 md:grid-cols-2 gap-5 text-sm">
              <div>
                <h4 className="text-[#1d1d1f] font-semibold mb-2">Tracked inside Votes</h4>
                <p className="text-[#86868b] leading-relaxed">
                  There is no separate workflows screen. Every vote that belongs to a workflow is tagged with a blue
                  "Workflow" badge in the votes list. Opening the vote reveals a compact stage map at the top — showing
                  all groups, where each committee stands, and a direct link to jump between sibling votes.
                </p>
              </div>
              <div>
                <h4 className="text-[#1d1d1f] font-semibold mb-2">Zero manual wiring</h4>
                <p className="text-[#86868b] leading-relaxed">
                  Once the Secretary approves the AI-proposed workflow, everything runs automatically. When the last
                  endorsement comes in, the board vote is created, access is granted to board members, and it appears
                  on their dashboard — with no Secretary intervention required.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            {[
              { label: "Single endorsement", example: "FAC → Board", desc: "One committee must endorse before the board votes. Sequential, one stage per group." },
              { label: "Parallel endorsements", example: "FAC + NRC → Board", desc: "Two or more committees endorse simultaneously. Board vote opens when the last endorsement lands." },
              { label: "Board only", example: "Board alone", desc: "No prior endorsement required. A single vote is created as a standalone resolution, not a workflow." },
            ].map(({ label, example, desc }) => (
              <div key={label} className="bg-white border border-[#e5e5e7] rounded-xl p-4">
                <div className="text-[#0071e3] font-semibold mb-1">{label}</div>
                <div className="text-[#1d1d1f] text-xs font-mono mb-2 opacity-50">{example}</div>
                <p className="text-[#86868b] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Minutes Workflow */}
        <section className="space-y-6">
          <div>
            <SectionHeader icon={<FileText size={12} />} label="Minutes" />
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3 text-[#1d1d1f]">The Minutes Lifecycle</h2>
            <p className="text-[#86868b] leading-relaxed max-w-2xl">
              Minutes travel through four stages. The Secretary controls progression through each stage. Board members
              sign digitally at the signing stage, and a cryptographic record is kept permanently.
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { stage: "Draft", color: "#86868b", desc: "Secretary writes or edits using the rich text editor. Not visible to board members." },
              { stage: "In Review", color: "#ff9500", desc: "Board members can read the minutes and submit feedback. Not yet binding." },
              { stage: "Signing", color: "#0071e3", desc: "Board members are notified to digitally sign. Each signature is SHA-256 timestamped." },
              { stage: "Signed", color: "#34c759", desc: "All required signatures collected. Minutes are locked and immutable." },
            ].map(({ stage, color, desc }) => (
              <div key={stage} className="bg-white border border-[#e5e5e7] rounded-xl p-4">
                <div className="text-xs font-semibold px-2 py-1 rounded-full inline-block mb-3" style={{ backgroundColor: color + "20", color }}>
                  {stage}
                </div>
                <p className="text-xs text-[#86868b] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Security */}
        <section className="space-y-6">
          <div>
            <SectionHeader icon={<Shield size={12} />} label="Security & Integrity" />
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3 text-[#1d1d1f]">Security Architecture</h2>
            <p className="text-[#86868b] leading-relaxed max-w-2xl">
              LQGovernance is built on standard, auditable cryptographic primitives. No proprietary security claims.
              Everything here is verifiable in the source code.
            </p>
          </div>
          <div className="bg-white border border-[#e5e5e7] rounded-2xl p-6 space-y-5">
            {[
              {
                title: "JWT Authentication",
                detail: "Every API request is authenticated with a signed JSON Web Token. Tokens are issued on login, validated on every request, and contain the user's role, ID, and expiry. There are no cookies and no session state on the server.",
              },
              {
                title: "SHA-256 Resolution Certificates",
                detail: "When a vote closes, the system computes a SHA-256 hash of the vote ID, final status, approval count, total votes, and close timestamp. This hash is stored permanently and printed on the certificate. Any tampering with the vote record would invalidate the hash.",
              },
              {
                title: "SHA-256 Minute Signatures",
                detail: "Each digital signature on meeting minutes records the signatory's ID, the minutes ID, and a timestamp — collectively hashed. The result is a tamper-evident chain that proves who signed, when, and what they signed.",
              },
              {
                title: "Role-Based Access Control",
                detail: "Every board entity (vote, meeting, minutes, task, document) has an explicit access control list. Access is granted when the entity is created, based on board membership. The Secretary can revoke or modify access at any time.",
              },
              {
                title: "Audit Trail",
                detail: "Every significant action in the system is written to an append-only audit log: document uploads, AI classifications, Secretary approvals, vote casts, signatures, task updates, and administrator actions. The audit log cannot be deleted through the UI.",
              },
              {
                title: "Self-Hosted & Open Source",
                detail: "Your data stays on your infrastructure. The API server and database run entirely under your control. On the default provider the only outbound request is to the Anthropic API, using your own key — and Anthropic does not train on API data. Or set AI_PROVIDER=openai-compatible with AI_BASE_URL to run a local model (Ollama, vLLM, LM Studio) and make zero outbound AI requests at all.",
              },
            ].map(({ title, detail }) => (
              <div key={title} className="border-b border-[#e5e5e7] last:border-0 pb-5 last:pb-0">
                <h4 className="text-[#1d1d1f] font-semibold mb-1.5 flex items-center gap-2">
                  <Shield size={14} className="text-[#34c759]" />
                  {title}
                </h4>
                <p className="text-[#86868b] text-sm leading-relaxed">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Architecture */}
        <section className="space-y-6">
          <div>
            <SectionHeader icon={<Database size={12} />} label="Technical Architecture" />
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3 text-[#1d1d1f]">What the System Is Built On</h2>
            <p className="text-[#86868b] leading-relaxed max-w-2xl">
              Every dependency is a widely-used open-source project with a strong security track record.
              No proprietary components, no vendor lock-in.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { layer: "Frontend", stack: "React 18 + Vite + TypeScript", detail: "Role-based single-page app. TanStack Query for server state. Wouter for routing. Tailwind CSS for styling." },
              { layer: "API Server", stack: "Node.js + Express + TypeScript", detail: "REST API compiled with esbuild. JWT middleware on every protected route. Multer for secure file uploads." },
              { layer: "Database", stack: "PostgreSQL + Drizzle ORM", detail: "Fully relational schema with foreign-key constraints, UUIDs for all primary keys, and timestamped audit rows." },
              { layer: "AI Layer", stack: "Claude via Anthropic API, or any local OpenAI-compatible server", detail: "Runs on Claude (Opus 4.8 by default; set AI_MODEL to pick another model) or on a local OpenAI-compatible endpoint (AI_PROVIDER=openai-compatible + AI_BASE_URL — Ollama, vLLM, LM Studio). Structured JSON output is always validated locally against strict schemas, whatever the provider. Anthropic does not train on API data." },
            ].map(({ layer, stack, detail }) => (
              <div key={layer} className="bg-white border border-[#e5e5e7] rounded-xl p-5">
                <div className="text-xs font-semibold text-[#0071e3] uppercase tracking-widest mb-1">{layer}</div>
                <div className="text-[#1d1d1f] font-medium mb-2">{stack}</div>
                <p className="text-[#86868b] text-sm leading-relaxed">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Typical Day */}
        <section className="space-y-6">
          <div>
            <SectionHeader icon={<Clock size={12} />} label="In Practice" />
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight mb-3 text-[#1d1d1f]">A Typical Governance Cycle</h2>
            <p className="text-[#86868b] leading-relaxed max-w-2xl">
              Here is what the LQGovernance workflow looks like from document receipt to signed minutes.
            </p>
          </div>
          <div className="bg-white border border-[#e5e5e7] rounded-2xl p-6 space-y-5">
            {[
              { n: "1", t: "Secretary uploads board pack PDF", d: "The 40-page board pack is uploaded. The AI reads every page and proposes: 1 meeting, the agenda structure, and 7 action items — all in under 30 seconds." },
              { n: "2", t: "Secretary reviews AI proposals", d: "The Pending Actions queue shows each proposed action with a confidence score and a plain-English description. The Secretary corrects a date on one item and approves the rest." },
              { n: "3", t: "Meeting takes place", d: "Board members open the Board Room and see the agenda, supporting documents, and attendance list. The Secretary marks attendance and the chair opens the session." },
              { n: "4", t: "Secretary opens resolutions for vote", d: "Items requiring a formal decision are published as circulation resolutions. Each resolution appears on every eligible board member's dashboard with the supporting materials attached." },
              { n: "5", t: "Board members cast their votes", d: "Members review the resolution text and vote — approved, rejected, or with comments — from any device, any location. The system tracks who has voted and who is outstanding." },
              { n: "6", t: "Votes close and minutes are signed", d: "When the last eligible member votes, the result is evaluated, the vote closes, and a SHA-256 certificate is generated. The Secretary then drafts the minutes, advances them through review and signing, and each board member signs with one click. Minutes are permanently locked once all signatures are in." },
            ].map(({ n, t, d }) => <Step key={n} number={n} title={t} description={d} />)}
          </div>
        </section>

        {/* CTA */}
        <div className="text-center pt-4 pb-8">
          <p className="text-[#86868b] mb-6">Ready to see it in action?</p>
          <Link href="/login">
            <button className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#0071e3] hover:bg-[#0077ed] text-white font-medium rounded-full transition-colors text-sm">
              Enter LQGovernance
              <ChevronRight size={16} />
            </button>
          </Link>
        </div>

      </main>

      {/* Floating CTA */}
      <div
        className={`fixed right-6 top-1/2 -translate-y-1/2 z-40 transition-all duration-500 ${
          visible ? "opacity-100 translate-x-0 pointer-events-auto" : "opacity-0 translate-x-8 pointer-events-none"
        }`}
      >
        <div className="bg-white border border-[#e5e5e7] rounded-2xl shadow-lg shadow-black/8 p-5 w-52 space-y-3">
          <p className="text-[#1d1d1f] font-semibold text-sm leading-snug">
            Read enough?
          </p>
          <p className="text-[#86868b] text-xs leading-relaxed">
            The demo is live. Every feature on this page is running right now.
          </p>
          <Link href="/login">
            <button className="w-full flex items-center justify-center gap-1.5 px-4 py-2.5 bg-[#0071e3] hover:bg-[#0077ed] text-white text-xs font-semibold rounded-xl transition-colors">
              Try it now
              <ChevronRight size={13} />
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
