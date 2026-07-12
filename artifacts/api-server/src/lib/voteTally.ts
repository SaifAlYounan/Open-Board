import crypto from "crypto";

export type ApprovalRule = {
  type: string;
  minApprovals: number | null;
  quorum: number | null;
  /** What pool the quorum is measured against. null = the vote-type default
   *  (attendance for meeting votes, cast for everything else). */
  quorumBasis?: "attendance" | "cast" | null;
  /** What denominator fractional rules divide by. null = the rule-type default
   *  (eligible for unanimous, votes-cast-excluding-abstentions otherwise). */
  denominatorBasis?: "eligible" | "cast" | null;
} | null;

/** The two vote fields the tally semantics depend on. */
export type VoteLike = { type: string; meetingId: string | null };

/**
 * The resolved measurement bases for one evaluation (external-review items
 * 2–3). Everything downstream — quorum, denominator, the certificate — uses
 * these resolved values, so the certificate can state on what basis the
 * outcome was decided.
 */
export type ResolvedBases = {
  /** What the quorum was actually measured against. */
  quorumBasisKind: "attendance" | "cast";
  /** The weight in that pool (compared against rule.quorum). */
  quorumWeight: number;
  /** What fractional rules actually divided by. */
  denominatorKind: "eligible" | "cast";
  /** The divisor: eligible weight, or votes cast excluding abstentions. */
  denominatorWeight: number;
};

/**
 * Whether enough voting weight is present to make the vote decisive.
 * A null/absent quorum means "no quorum requirement".
 *
 * The quorum threshold is expressed in WEIGHT units — the same units the rest
 * of the tally uses. On an unweighted board every member's weight is 1, so
 * this is exactly a head-count quorum. `quorumWeight` is the RESOLVED basis
 * pool (attendance weight for meeting votes, ballots cast otherwise) — see
 * `resolveBases`.
 */
export function meetsQuorum(rule: ApprovalRule, quorumWeight: number): boolean {
  if (!rule || rule.quorum == null) return true;
  return quorumWeight >= rule.quorum;
}

/**
 * Resolve what this vote's quorum and denominator are measured against.
 *
 * Quorum basis (item 3 — quorum attaches to who is present, for votes taken
 * at a meeting):
 *   - rule.quorumBasis wins when set;
 *   - else a vote of type "meeting" attached to a meeting uses ATTENDANCE —
 *     the summed weight of eligible, non-recused members whose attendance is
 *     confirmed (or held by proxy);
 *   - else (circulation and all other types) the weight of ballots CAST —
 *     which includes abstentions, because an abstention is participation.
 *   - A meeting vote whose meeting has NO attendance recorded falls back to
 *     the cast basis (a cast ballot proves presence) and reports "cast", so
 *     the certificate never claims an attendance basis that was never taken.
 *
 * Denominator basis (item 2 — what "a majority" is a majority OF):
 *   - rule.denominatorBasis wins when set;
 *   - else "unanimous" divides by ELIGIBLE weight (the written-consent
 *     reading: every eligible member must approve, an abstention defeats it);
 *   - else fractional rules divide by votes cast EXCLUDING abstentions (the
 *     Robert's-Rules reading: a majority of those voting for-or-against).
 */
export function resolveBases(
  vote: VoteLike,
  rule: ApprovalRule,
  tally: Tally,
  attendanceWeight: number | null,
): ResolvedBases {
  const isMeetingVote = vote.type === "meeting" && vote.meetingId != null;
  const wantsAttendance = rule?.quorumBasis === "attendance" || (rule?.quorumBasis == null && isMeetingVote);
  const attendanceAvailable = attendanceWeight != null;
  const quorumBasisKind = wantsAttendance && attendanceAvailable ? "attendance" : "cast";
  const quorumWeight = quorumBasisKind === "attendance" ? attendanceWeight! : tally.castWeight;

  const denominatorKind = rule?.denominatorBasis ?? (rule?.type === "unanimous" ? "eligible" : "cast");
  const denominatorWeight = denominatorKind === "eligible" ? tally.totalWeight : tally.castWeight - tally.abstainWeight;

  return { quorumBasisKind, quorumWeight, denominatorKind, denominatorWeight };
}

/**
 * Decide a vote's outcome over the resolved bases. All magnitudes are WEIGHT
 * sums (on an unweighted board — every weight 1 — they equal head counts, so
 * this is a strict generalization of the unweighted rules).
 *
 * Quorum is a precondition for ANY approval: if the rule sets a quorum and the
 * resolved quorum pool is lighter than that, the resolution cannot carry —
 * regardless of how the votes that WERE cast split.
 *
 * An abstention is a cast ballot that approves nothing: it counts toward the
 * cast quorum basis, and — under the default "cast" denominator — drops out of
 * the divisor, so a resolution carries on a majority of votes cast
 * for-or-against. A zero denominator (nobody voted for-or-against) approves
 * nothing.
 */
export function evaluateByRule(
  rule: ApprovalRule,
  tally: Tally,
  bases: ResolvedBases,
): "approved" | "rejected" {
  if (!meetsQuorum(rule, bases.quorumWeight)) return "rejected";
  const approvals = tally.approvalsWeight;
  const denom = bases.denominatorWeight;
  const majority = () => (approvals > denom / 2 ? "approved" : "rejected");
  if (!rule) return majority();
  switch (rule.type) {
    case "unanimous":      return denom > 0 && approvals === denom ? "approved" : "rejected";
    case "two_thirds":     return denom > 0 && approvals >= Math.ceil((denom * 2) / 3) ? "approved" : "rejected";
    case "three_quarters": return denom > 0 && approvals >= Math.ceil((denom * 3) / 4) ? "approved" : "rejected";
    case "custom":         return rule.minApprovals ? (approvals >= rule.minApprovals ? "approved" : "rejected") : majority();
    default:               return majority();
  }
}

export type EligibleMember = { personId: string | null; weight?: number | null };
// `castBy` (proxy attribution) is carried on ballot rows but needs no tally
// special-casing: a proxy-cast ballot is stored against the PRINCIPAL at the
// principal's weight, so it already counts once, correctly.
export type BallotRecord = { personId: string | null; decision: string; weight?: number | null; castBy?: string | null };

export type Tally = {
  /** head count of eligible (non-recused) voting members */
  totalVoters: number;
  /** their summed voting weight (a cast ballot's persisted snapshot wins over the live membership weight) */
  totalWeight: number;
  /** head count of valid (non-recused) ballots cast — abstentions included */
  votesCast: number;
  /** summed weight of the valid ballots cast — abstentions included */
  castWeight: number;
  /** head count of valid "approved*" ballots */
  approvalsCount: number;
  /** summed weight of the valid "approved*" ballots */
  approvalsWeight: number;
  /** head count of valid "abstained" ballots (cast, but approving nothing) */
  abstainCount: number;
  /** summed weight of the valid "abstained" ballots */
  abstainWeight: number;
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
  let abstainCount = 0;
  let abstainWeight = 0;
  for (const r of validRecords) {
    const w = r.weight ?? 1;
    castWeight += w;
    if (r.decision.startsWith("approved")) {
      approvalsCount += 1;
      approvalsWeight += w;
    } else if (r.decision === "abstained") {
      abstainCount += 1;
      abstainWeight += w;
    }
  }

  return { totalVoters, totalWeight, votesCast: validRecords.length, castWeight, approvalsCount, approvalsWeight, abstainCount, abstainWeight };
}

/**
 * Summed weight of the eligible, non-recused members who are PRESENT — the
 * attendance quorum pool for a meeting vote. Weight resolution matches
 * `computeTally` exactly (a cast ballot's persisted snapshot wins over the
 * live membership weight), so quorum and outcome are always measured in the
 * same units. `presentIds` = members whose attendance status is confirmed or
 * proxy; the caller passes NULL attendance to `resolveBases` when the meeting
 * has no attendance recorded at all.
 */
export function computeAttendanceWeight(
  members: EligibleMember[],
  records: BallotRecord[],
  presentIds: ReadonlySet<string>,
  recusedIds: ReadonlySet<string | null> = new Set(),
): number {
  const isRecused = (pid: string | null) => pid != null && recusedIds.has(pid);
  const recordByPerson = new Map(records.filter((r) => r.personId && !isRecused(r.personId)).map((r) => [r.personId!, r]));
  let weight = 0;
  for (const m of members) {
    if (!m.personId || isRecused(m.personId) || !presentIds.has(m.personId)) continue;
    const record = recordByPerson.get(m.personId);
    weight += record ? record.weight ?? 1 : m.weight ?? 1;
  }
  return weight;
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
