import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { SecretarySidebar } from "@/components/SecretarySidebar";
import {
  GitBranch, ChevronRight, CheckCircle2, XCircle, Clock, AlertCircle,
  ArrowLeft, Vote, Users, ExternalLink
} from "lucide-react";

const API_BASE = "";

interface VoteStats {
  totalVoters: number;
  votesCast: number;
  approvalsCount: number;
}

interface StageVote {
  id: string;
  resolutionNumber: string;
  title: string;
  status: string;
  closedAt: string | null;
}

interface WorkflowStage {
  id: string;
  stageIndex: number;
  title: string;
  description: string | null;
  boardName: string | null;
  boardAbbreviation: string | null;
  approvalType: string;
  status: "pending" | "active" | "approved" | "rejected" | "cancelled";
  completedAt: string | null;
  vote: StageVote | null;
  voteStats: VoteStats | null;
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

const stageStatusConfig = {
  pending:   { icon: Clock,         color: "#86868b", label: "Waiting"  },
  active:    { icon: AlertCircle,   color: "#0071e3", label: "In Vote"  },
  approved:  { icon: CheckCircle2, color: "#34c759", label: "Endorsed" },
  rejected:  { icon: XCircle,       color: "#ff3b30", label: "Rejected" },
  cancelled: { icon: XCircle,       color: "#86868b", label: "Cancelled"},
};

const workflowStatusConfig = {
  active:    { label: "In Progress", color: "#0071e3" },
  completed: { label: "Completed",   color: "#34c759" },
  rejected:  { label: "Rejected",    color: "#ff3b30" },
  cancelled: { label: "Cancelled",   color: "#86868b" },
};

const approvalTypeLabel: Record<string, string> = {
  majority:       "Simple majority",
  unanimous:      "Unanimous",
  two_thirds:     "Two-thirds",
  three_quarters: "Three-quarters",
};

export default function WorkflowDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: workflow, isLoading } = useQuery<Workflow>({
    queryKey: ["workflows", id],
    queryFn: () =>
      fetch(`${API_BASE}/api/workflows/${id}`, { credentials: "include" }).then((r) => r.json()),
    enabled: !!id,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <div className="flex min-h-screen bg-[#f5f5f7]">
        <SecretarySidebar />
        <main className="flex-1 lg:ml-64 pt-14 lg:pt-0 p-8 text-[#86868b] text-sm">Loading…</main>
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex min-h-screen bg-[#f5f5f7]">
        <SecretarySidebar />
        <main className="flex-1 lg:ml-64 pt-14 lg:pt-0 p-8 text-[#86868b] text-sm">Workflow not found.</main>
      </div>
    );
  }

  const wfStatus = workflowStatusConfig[workflow.status];
  const completedCount = workflow.stages.filter((s) => s.status === "approved").length;

  return (
    <div className="flex min-h-screen bg-[#f5f5f7]">
      <SecretarySidebar />
      <main className="flex-1 lg:ml-64 pt-14 lg:pt-0 p-8">
        <div className="max-w-3xl">
          <Link href="/secretary/workflows">
            <button className="flex items-center gap-1.5 text-sm text-[#86868b] hover:text-[#1d1d1f] mb-6 transition-colors">
              <ArrowLeft size={14} />
              All Workflows
            </button>
          </Link>

          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-6 mb-6">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 bg-[#0071e3]/10 rounded-xl flex items-center justify-center">
                  <GitBranch size={18} className="text-[#0071e3]" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-[#1d1d1f]">{workflow.title}</h1>
                  {workflow.boardName && (
                    <p className="text-xs text-[#86868b]">Final approver: {workflow.boardName}</p>
                  )}
                </div>
              </div>
              <span
                className="text-xs font-semibold px-2.5 py-1 rounded-full"
                style={{ color: wfStatus.color, backgroundColor: wfStatus.color + "18" }}
              >
                {wfStatus.label}
              </span>
            </div>

            {workflow.description && (
              <p className="text-sm text-[#86868b] mb-4">{workflow.description}</p>
            )}

            <div className="flex items-center gap-4 text-xs text-[#86868b] border-t border-[#f5f5f7] pt-4 mt-4">
              <span>{completedCount} of {workflow.stages.length} stages complete</span>
              <span>Created {new Date(workflow.createdAt).toLocaleDateString("en-GB")}</span>
            </div>
          </div>

          <div className="space-y-3">
            {workflow.stages.map((stage, idx) => {
              const cfg = stageStatusConfig[stage.status];
              const Icon = cfg.icon;
              const isLast = idx === workflow.stages.length - 1;

              return (
                <div key={stage.id}>
                  <div
                    className="bg-white rounded-2xl border p-5 transition-all"
                    style={{ borderColor: stage.status === "active" ? "#0071e3" : "#e5e5e7" }}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: cfg.color + "18", color: cfg.color }}
                      >
                        <Icon size={15} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold text-[#86868b]">
                            Stage {stage.stageIndex + 1}
                          </span>
                          <span
                            className="text-xs font-semibold px-1.5 py-0.5 rounded-full"
                            style={{ color: cfg.color, backgroundColor: cfg.color + "18" }}
                          >
                            {cfg.label}
                          </span>
                        </div>
                        <h3 className="font-medium text-[#1d1d1f] mb-0.5">{stage.title}</h3>
                        {stage.description && (
                          <p className="text-sm text-[#86868b] mb-3">{stage.description}</p>
                        )}

                        <div className="flex items-center gap-4 text-xs text-[#86868b] mb-3">
                          {stage.boardName && (
                            <span className="flex items-center gap-1">
                              <Users size={12} />
                              {stage.boardName}
                            </span>
                          )}
                          <span>{approvalTypeLabel[stage.approvalType] || stage.approvalType}</span>
                          {stage.completedAt && (
                            <span>Resolved {new Date(stage.completedAt).toLocaleDateString("en-GB")}</span>
                          )}
                        </div>

                        {stage.vote && (
                          <div className="bg-[#f5f5f7] rounded-xl p-3 flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0 mr-3">
                              <Vote size={13} className="text-[#86868b] flex-shrink-0" />
                              <span className="text-xs text-[#86868b] font-mono flex-shrink-0">{stage.vote.resolutionNumber}</span>
                              <span className="text-xs text-[#1d1d1f] font-medium truncate">{stage.vote.title}</span>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              {stage.voteStats && (
                                <span className="text-xs text-[#86868b]">
                                  {stage.voteStats.votesCast}/{stage.voteStats.totalVoters} voted
                                  {stage.voteStats.votesCast > 0 && ` · ${stage.voteStats.approvalsCount} approved`}
                                </span>
                              )}
                              <Link href={`/secretary/votes/${stage.vote.id}`}>
                                <button className="flex items-center gap-1 text-xs text-[#0071e3] hover:underline">
                                  View vote
                                  <ExternalLink size={11} />
                                </button>
                              </Link>
                            </div>
                          </div>
                        )}

                        {stage.status === "pending" && (
                          <p className="text-xs text-[#86868b] italic">
                            Waiting for the previous stage to be approved before this vote opens.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {!isLast && (
                    <div className="flex justify-center py-1">
                      <ChevronRight size={14} className="text-[#86868b] rotate-90" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {workflow.status === "completed" && (
            <div className="mt-6 bg-[#34c759]/10 border border-[#34c759]/30 rounded-2xl p-4 flex items-center gap-3">
              <CheckCircle2 size={18} className="text-[#34c759] flex-shrink-0" />
              <p className="text-sm text-[#1d1d1f]">
                All stages completed. The final board approval has been granted.
              </p>
            </div>
          )}

          {workflow.status === "rejected" && (
            <div className="mt-6 bg-[#ff3b30]/10 border border-[#ff3b30]/30 rounded-2xl p-4 flex items-center gap-3">
              <XCircle size={18} className="text-[#ff3b30] flex-shrink-0" />
              <p className="text-sm text-[#1d1d1f]">
                This workflow was rejected at one of the stages. Remaining stages have been cancelled.
              </p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
