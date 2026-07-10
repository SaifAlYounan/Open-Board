import crypto from "crypto";

export type ApprovalRule = {
  type: string;
  minApprovals: number | null;
  quorum: number | null;
} | null;

/**
 * Whether enough voting weight was cast to make the vote decisive.
 * A null/absent quorum means "no quorum requirement".
 *
 * The quorum threshold is expressed in WEIGHT units — the same units the rest
 * of the tally uses. On an unweighted board every member's weight is 1, so
 * weight cast == ballots cast and this is exactly the old head-count quorum.
 */
export function meetsQuorum(rule: ApprovalRule, castWeight: number): boolean {
  if (!rule || rule.quorum == null) return true;
  return castWeight >= rule.quorum;
}

/**
 * Decide a vote's outcome. All three magnitudes are WEIGHT sums (on an
 * unweighted board — every weight 1 — they equal the old head counts, so this
 * is a strict generalization of the unweighted rules):
 *
 * Quorum is a precondition for ANY approval: if the rule sets a quorum and less
 * weight was cast than that, the resolution cannot carry — it is rejected,
 * regardless of how the votes that WERE cast split.
 *
 * @param approvalsWeight  summed weight of "approved*" ballots among the valid (non-recused) records
 * @param totalWeight      summed weight of the eligible (non-recused) voters
 * @param castWeight       summed weight of the valid ballots actually cast
 */
export function evaluateByRule(
  rule: ApprovalRule,
  approvalsWeight: number,
  totalWeight: number,
  castWeight: number,
): "approved" | "rejected" {
  if (!meetsQuorum(rule, castWeight)) return "rejected";
  if (!rule) return approvalsWeight > totalWeight / 2 ? "approved" : "rejected";
  switch (rule.type) {
    case "unanimous":      return approvalsWeight === totalWeight ? "approved" : "rejected";
    case "two_thirds":     return approvalsWeight >= Math.ceil((totalWeight * 2) / 3) ? "approved" : "rejected";
    case "three_quarters": return approvalsWeight >= Math.ceil((totalWeight * 3) / 4) ? "approved" : "rejected";
    case "custom":         return rule.minApprovals ? (approvalsWeight >= rule.minApprovals ? "approved" : "rejected") : (approvalsWeight > totalWeight / 2 ? "approved" : "rejected");
    default:               return approvalsWeight > totalWeight / 2 ? "approved" : "rejected";
  }
}

export type EligibleMember = { personId: string | null; weight?: number | null };
export type BallotRecord = { personId: string | null; decision: string; weight?: number | null };

export type Tally = {
  /** head count of eligible (non-recused) voting members */
  totalVoters: number;
  /** their summed voting weight (a cast ballot's persisted snapshot wins over the live membership weight) */
  totalWeight: number;
  /** head count of valid (non-recused) ballots cast */
  votesCast: number;
  /** summed weight of the valid ballots cast */
  castWeight: number;
  /** head count of valid "approved*" ballots */
  approvalsCount: number;
  /** summed weight of the valid "approved*" ballots */
  approvalsWeight: number;
};

/**
 * Aggregate a vote's ballots into head counts AND weight sums.
 *
 * Weight resolution: a cast ballot carries the weight snapshotted at cast time
 * (auditable, immune to later membership edits); a member who has not voted yet
 * contributes their current membership weight to the eligible total. A missing
 * weight defaults to 1, so unweighted data reproduces plain head counts.
 */
export function computeTally(
  members: EligibleMember[],
  records: BallotRecord[],
  recusedIds: ReadonlySet<string | null> = new Set(),
): Tally {
  const isRecused = (pid: string | null) => pid != null && recusedIds.has(pid);
  const validRecords = records.filter((r) => !isRecused(r.personId));
  const recordByPerson = new Map(validRecords.filter((r) => r.personId).map((r) => [r.personId!, r]));

  let totalVoters = 0;
  let totalWeight = 0;
  for (const m of members) {
    if (isRecused(m.personId)) continue;
    totalVoters += 1;
    const record = m.personId ? recordByPerson.get(m.personId) : undefined;
    totalWeight += record ? record.weight ?? 1 : m.weight ?? 1;
  }

  let castWeight = 0;
  let approvalsCount = 0;
  let approvalsWeight = 0;
  for (const r of validRecords) {
    const w = r.weight ?? 1;
    castWeight += w;
    if (r.decision.startsWith("approved")) {
      approvalsCount += 1;
      approvalsWeight += w;
    }
  }

  return { totalVoters, totalWeight, votesCast: validRecords.length, castWeight, approvalsCount, approvalsWeight };
}

export type CertificateRecord = {
  personId: string | null;
  decision: string;
  weight?: number | null;
  /** person who cast this ballot as a proxy for `personId` (null = cast in person) */
  castBy?: string | null;
};

/**
 * Compute a vote certificate's tamper-evident SHA-256 (hash format v2).
 *
 * The hash is derived ENTIRELY from persisted data (the stored records with
 * their snapshotted weights and proxy attribution, the status, and the single
 * stored `closedAt`), so it can be recomputed and verified later. Callers MUST
 * pass the same `closedAt` they persist.
 *
 * v2 covers per-ballot weight and proxy attribution (castBy) plus the weighted
 * totals; votes closed before the weighted-voting feature were hashed with the
 * v1 format — see `computeLegacyCertificateHash`, kept so old certificates
 * still verify.
 */
export function computeCertificateHash(
  id: string,
  status: string,
  closedAt: Date,
  records: CertificateRecord[],
): string {
  const sorted = [...records]
    .sort((a, b) => (a.personId ?? "").localeCompare(b.personId ?? ""))
    .map((r) => ({ personId: r.personId, decision: r.decision, weight: r.weight ?? 1, castBy: r.castBy ?? null }));
  const approvals = sorted.filter((r) => r.decision.startsWith("approved")).length;
  const approvalsWeight = sorted.filter((r) => r.decision.startsWith("approved")).reduce((s, r) => s + r.weight, 0);
  const castWeight = sorted.reduce((s, r) => s + r.weight, 0);
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify({
        v: 2,
        id,
        status,
        approvals,
        approvalsWeight,
        total: sorted.length,
        castWeight,
        closedAt: closedAt.toISOString(),
        records: sorted,
      }),
    )
    .digest("hex");
}

/**
 * The v1 (pre-weighted-voting) certificate hash — personId + decision only.
 * Kept verbatim so certificates minted before the weight/proxy columns existed
 * can still be verified against their stored hash.
 */
export function computeLegacyCertificateHash(
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
