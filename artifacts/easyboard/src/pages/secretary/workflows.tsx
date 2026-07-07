import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { SecretarySidebar } from "@/components/SecretarySidebar";
import { GitBranch, ChevronRight, CheckCircle2, XCircle, Clock, AlertCircle } from "lucide-react";

const API_BASE = "";

interface WorkflowStage {
  id: string;
  stageIndex: number;
  title: string;
  boardName: string | null;
  boardAbbreviation: string | null;
  status: "pending" | "active" | "approved" | "rejected" | "cancelled";
}

interface Workflow {
  id: string;
  title: string;
  description: string | null;
  status: "active" | "completed" | "rejected" | "cancelled";
  boardName: string | null;
  createdAt: string;
  stages: WorkflowStage[];
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; color: string }> = {
    active:    { label: "In Progress", color: "#0071e3" },
    completed: { label: "Completed",   color: "#34c759" },
    rejected:  { label: "Rejected",    color: "#ff3b30" },
    cancelled: { label: "Cancelled",   color: "#86868b" },
  };
  const s = map[status] || map.active;
  return (
    <span
      className="text-xs font-semibold px-2 py-0.5 rounded-full"
      style={{ color: s.color, backgroundColor: s.color + "18" }}
    >
      {s.label}
    </span>
  );
}

function stageIcon(status: string) {
  if (status === "approved") return <CheckCircle2 size={14} className="text-[#34c759]" />;
  if (status === "rejected") return <XCircle size={14} className="text-[#ff3b30]" />;
  if (status === "cancelled") return <XCircle size={14} className="text-[#86868b]" />;
  if (status === "active") return <AlertCircle size={14} className="text-[#0071e3]" />;
  return <Clock size={14} className="text-[#86868b]" />;
}

export default function SecretaryWorkflows() {
  const { data: workflows = [], isLoading } = useQuery<Workflow[]>({
    queryKey: ["workflows"],
    queryFn: () =>
      fetch(`${API_BASE}/api/workflows`, { credentials: "include" }).then((r) => r.json()),
  });

  return (
    <div className="flex min-h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0 p-8">
        <div className="max-w-4xl">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 bg-[#0071e3]/10 rounded-xl flex items-center justify-center">
              <GitBranch size={20} className="text-[#0071e3]" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold text-[#1d1d1f]">Approval Workflows</h1>
              <p className="text-sm text-[#86868b]">Multi-stage sequential approval chains</p>
            </div>
          </div>

          {isLoading ? (
            <div className="text-[#86868b] text-sm">Loading workflows…</div>
          ) : workflows.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#e5e5e7] p-12 text-center">
              <GitBranch size={32} className="text-[#86868b] mx-auto mb-4" />
              <h3 className="text-[#1d1d1f] font-medium mb-2">No workflows yet</h3>
              <p className="text-sm text-[#86868b] max-w-sm mx-auto">
                Upload a document that describes a sequential approval process — for example,
                "FAC must endorse before the Board approves" — and the AI will propose creating
                a workflow automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {workflows.map((wf) => {
                const activeStage = wf.stages.find((s) => s.status === "active");
                const completedCount = wf.stages.filter((s) => s.status === "approved").length;
                return (
                  <Link key={wf.id} href={`/secretary/workflows/${wf.id}`}>
                    <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6 hover:border-[#0071e3]/40 hover:shadow-sm transition-all cursor-pointer">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold text-[#1d1d1f] truncate">{wf.title}</h3>
                            {statusBadge(wf.status)}
                          </div>
                          {wf.description && (
                            <p className="text-sm text-[#86868b] truncate">{wf.description}</p>
                          )}
                        </div>
                        <ChevronRight size={16} className="text-[#86868b] flex-shrink-0 mt-1 ml-4" />
                      </div>

                      <div className="flex items-center gap-2 mb-4 flex-wrap">
                        {wf.stages.map((stage, idx) => (
                          <div key={stage.id} className="flex items-center gap-1">
                            <div
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
                              style={{
                                backgroundColor:
                                  stage.status === "approved" ? "#34c75918" :
                                  stage.status === "active"   ? "#0071e318" :
                                  stage.status === "rejected" ? "#ff3b3018" : "#86868b18",
                                color:
                                  stage.status === "approved" ? "#34c759" :
                                  stage.status === "active"   ? "#0071e3" :
                                  stage.status === "rejected" ? "#ff3b30" : "#86868b",
                              }}
                            >
                              {stageIcon(stage.status)}
                              {stage.boardAbbreviation || stage.boardName || `Stage ${idx + 1}`}
                            </div>
                            {idx < wf.stages.length - 1 && (
                              <ChevronRight size={12} className="text-[#86868b]" />
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="flex items-center justify-between text-xs text-[#86868b]">
                        <span>
                          {completedCount} of {wf.stages.length} stages complete
                          {activeStage && ` · Waiting on ${activeStage.boardName || activeStage.title}`}
                        </span>
                        <span>{new Date(wf.createdAt).toLocaleDateString("en-GB")}</span>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
