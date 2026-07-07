import crypto from "crypto";

export type ApprovalRule = {
  type: string;
  minApprovals: number | null;
  quorum: number | null;
} | null;

/**
 * Whether enough valid votes were cast to make the vote decisive.
 * A null/absent quorum means "no quorum requirement".
 */
export function meetsQuorum(rule: ApprovalRule, validVotesCast: number): boolean {
  if (!rule || rule.quorum == null) return true;
  return validVotesCast >= rule.quorum;
}

/**
 * Decide a vote's outcome.
 *
 * Quorum is a precondition for ANY approval: if the rule sets a quorum and fewer
 * valid votes were cast than that, the resolution cannot carry — it is rejected,
 * regardless of how the votes that WERE cast split. (Previously `quorum` was
 * stored and displayed but never consulted, so a resolution could be recorded as
 * passed below its required quorum.)
 *
 * @param approvals       count of "approved*" votes among the valid (non-recused) records
 * @param totalVoters     number of eligible (non-recused) voters
 * @param validVotesCast  number of valid votes actually cast
 */
export function evaluateByRule(
  rule: ApprovalRule,
  approvals: number,
  totalVoters: number,
  validVotesCast: number,
): "approved" | "rejected" {
  if (!meetsQuorum(rule, validVotesCast)) return "rejected";
  if (!rule) return approvals > totalVoters / 2 ? "approved" : "rejected";
  switch (rule.type) {
    case "unanimous":      return approvals === totalVoters ? "approved" : "rejected";
    case "two_thirds":     return approvals >= Math.ceil((totalVoters * 2) / 3) ? "approved" : "rejected";
    case "three_quarters": return approvals >= Math.ceil((totalVoters * 3) / 4) ? "approved" : "rejected";
    case "custom":         return rule.minApprovals ? (approvals >= rule.minApprovals ? "approved" : "rejected") : (approvals > totalVoters / 2 ? "approved" : "rejected");
    default:               return approvals > totalVoters / 2 ? "approved" : "rejected";
  }
}

export type CertificateRecord = { personId: string | null; decision: string };

/**
 * Compute a vote certificate's tamper-evident SHA-256.
 *
 * The hash is derived ENTIRELY from persisted data (the stored records, status,
 * and the single stored `closedAt`), so it can be recomputed and verified later.
 * The previous implementation hashed `new Date()` while separately storing a
 * different `new Date()` in the column, so the stored hash could never be
 * reproduced. Callers MUST pass the same `closedAt` they persist.
 */
export function computeCertificateHash(
  id: string,
  status: string,
  closedAt: Date,
  records: CertificateRecord[],
): string {
  const sorted = [...records]
    .sort((a, b) => (a.personId ?? "").localeCompare(b.personId ?? ""))
    .map((r) => ({ personId: r.personId, decision: r.decision }));
  const approvals = sorted.filter((r) => r.decision.startsWith("approved")).length;
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        id,
        status,
        approvals,
        total: sorted.length,
        closedAt: closedAt.toISOString(),
        records: sorted,
      }),
    )
    .digest("hex");
}
