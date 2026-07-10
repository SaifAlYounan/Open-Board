import { useParams, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { TopNav } from '@/components/TopNav';
import { CheckCircle, XCircle, Clock, ArrowLeft, Shield } from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

async function fetchCertificate(id: string) {
  const res = await fetch(`${BASE_URL}/api/votes/${id}/certificate`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch certificate");
  return res.json();
}

const STATUS_COLOR: Record<string, string> = {
  approved: "#34c759",
  rejected: "#ff3b30",
  lapsed: "#ff9500",
  cancelled: "#86868b",
  open: "#0071e3",
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  approved: <CheckCircle size={20} className="text-[#34c759]" />,
  rejected: <XCircle size={20} className="text-[#ff3b30]" />,
  lapsed: <Clock size={20} className="text-[#ff9500]" />,
};

export default function VoteCertificate() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();

  const { data: cert, isLoading, error } = useQuery({
    queryKey: ["vote-certificate", id],
    queryFn: () => fetchCertificate(id!),
    enabled: !!id,
  });

  return (
    <div className="min-h-screen bg-[#f5f5f7]">
      <TopNav />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate("/board")}
          className="flex items-center gap-2 text-sm text-[#0071e3] mb-6 hover:underline"
        >
          <ArrowLeft size={16} /> Back
        </button>

        {isLoading && (
          <div className="text-center py-20 text-[#86868b] text-sm">Loading certificate…</div>
        )}

        {error && (
          <div className="bg-white rounded-2xl border border-[#e5e5e7] p-8 text-center">
            <p className="text-[#ff3b30] text-sm">Certificate not available or access denied.</p>
          </div>
        )}

        {cert && (
          <div className="bg-white rounded-2xl border border-[#e5e5e7] overflow-hidden">
            {/* Header */}
            <div className="border-b border-[#e5e5e7] px-8 py-6 flex items-center gap-3">
              <Shield size={22} className="text-[#0071e3]" />
              <div>
                <div className="text-xs font-mono text-[#86868b]">{cert.resolutionNumber}</div>
                <h1 className="text-lg font-semibold text-[#1d1d1f]">{cert.title}</h1>
                <div className="text-sm text-[#86868b]">{cert.boardName}</div>
              </div>
              <span
                className="ml-auto flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full"
                style={{ backgroundColor: (STATUS_COLOR[cert.status] || "#86868b") + "20", color: STATUS_COLOR[cert.status] || "#86868b" }}
              >
                {STATUS_ICON[cert.status]}
                {cert.status.charAt(0).toUpperCase() + cert.status.slice(1)}
              </span>
            </div>

            {/* Body */}
            <div className="px-8 py-6 space-y-6">
              <div>
                <div className="text-xs font-medium text-[#86868b] uppercase tracking-wide mb-2">Resolution Text</div>
                <p className="text-sm text-[#1d1d1f] leading-relaxed">{cert.resolutionText}</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {cert.closedAt && (
                  <div>
                    <div className="text-xs font-medium text-[#86868b] uppercase tracking-wide mb-1">Closed</div>
                    <div className="text-sm text-[#1d1d1f]">{new Date(cert.closedAt).toLocaleDateString()}</div>
                  </div>
                )}
                {cert.deadline && (
                  <div>
                    <div className="text-xs font-medium text-[#86868b] uppercase tracking-wide mb-1">Deadline</div>
                    <div className="text-sm text-[#1d1d1f]">{new Date(cert.deadline).toLocaleDateString()}</div>
                  </div>
                )}
              </div>

              {cert.secret && (
                <div className="flex items-center gap-2 text-xs text-[#86868b] bg-[#f5f5f7] rounded-xl px-4 py-3">
                  <Shield size={14} />
                  This was a secret ballot — individual votes are not disclosed.
                </div>
              )}

              {(() => {
                const records = cert.voteRecords || [];
                const isWeighted =
                  records.some((r: any) => (r.weight ?? 1) !== 1) ||
                  (cert.castWeight != null && records.length > 0 && cert.castWeight !== records.length);
                return (
                  <>
                    {isWeighted && (
                      <div className="flex items-center gap-4 text-xs text-[#86868b] bg-[#f5f5f7] rounded-xl px-4 py-3" data-testid="cert-weighted-tally">
                        <span className="font-medium text-[#5856d6]">Weighted tally</span>
                        <span><strong className="text-[#34c759]">{cert.approvalsWeight}</strong> for</span>
                        <span><strong className="text-[#ff3b30]">{(cert.castWeight ?? 0) - (cert.approvalsWeight ?? 0)}</strong> against</span>
                        <span className="ml-auto">{cert.castWeight}/{cert.totalWeight} weight cast</span>
                      </div>
                    )}
                    {records.length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-[#86868b] uppercase tracking-wide mb-2">Vote Records</div>
                        <div className="space-y-2">
                          {records.map((r: any) => (
                            <div key={r.id} className="flex items-center justify-between text-sm">
                              <span className="text-[#1d1d1f]">
                                {r.person?.name || "Unknown"}
                                {isWeighted && <span className="ml-1.5 text-xs text-[#5856d6]">×{r.weight ?? 1}</span>}
                                {r.castBy && <span className="ml-1.5 text-xs text-[#5856d6]">by proxy: {r.castByName || "proxy holder"}</span>}
                              </span>
                              <span className="font-medium" style={{ color: r.decision?.startsWith("approved") ? "#34c759" : r.decision?.startsWith("rejected") || r.decision?.startsWith("not_approved") ? "#ff3b30" : "#86868b" }}>
                                {r.decision}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(cert.proxies || []).length > 0 && (
                      <div>
                        <div className="text-xs font-medium text-[#86868b] uppercase tracking-wide mb-2">Proxy Relationships</div>
                        <div className="space-y-2">
                          {cert.proxies.map((p: any) => (
                            <div key={p.id} className="flex items-center justify-between text-sm">
                              <span className="text-[#1d1d1f]">
                                <strong>{p.holderName || "Unknown"}</strong> held the proxy of <strong>{p.principalName || "Unknown"}</strong>
                              </span>
                              <span className="text-xs text-[#86868b]">{p.used ? "Ballot cast by proxy" : "Not used"}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {cert.hash && (
                <div className="bg-[#f5f5f7] rounded-xl p-4">
                  <div className="text-xs font-medium text-[#86868b] uppercase tracking-wide mb-1">Certificate Hash (SHA-256)</div>
                  <div className="text-xs font-mono text-[#1d1d1f] break-all">{cert.hash}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
