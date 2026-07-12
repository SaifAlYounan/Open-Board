import {
  db,
  boardMembershipsTable,
  approvalRulesTable,
  approvalRuleRecusalsTable,
  approvalRuleRequiredVotersTable,
  voteRecordsTable,
  attendanceTable,
  peopleTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import type { DbClient } from "./numbering";
import {
  computeTally,
  computeAttendanceWeight,
  resolveBases,
  evaluateByRule,
} from "./voteTally";
import type { Tally, ResolvedBases, ApprovalRule as TallyRule } from "./voteTally";

/**
 * The single eligibility predicate for who may vote on a resolution: every
 * board member except observers and board secretaries. Reused everywhere a
 * voter set is derived (the weighted tally, the cast path, workflow stats) so
 * head counts and weight sums always describe the SAME set of people.
 */
export function isEligibleVoter(m: { roleInBoard: string | null }): boolean {
  return m.roleInBoard !== "observer" && m.roleInBoard !== "secretary";
}

export type VoteForEvaluation = {
  id: string;
  boardId: string | null;
  type: string;
  meetingId: string | null;
};

/**
 * Everything one vote-outcome decision needs, loaded once and shared by every
 * evaluation entry point (ballot-cast auto-close, deadline lapse, the
 * certificate mint) so they can never disagree on the inputs.
 */
export interface EvaluationContext {
  /** The approval rule row (null = default simple majority). */
  rule: (typeof approvalRulesTable.$inferSelect) | null;
  /** The rule in the tally module's shape. */
  tallyRule: TallyRule;
  /** Recusal rows (personId + reason) — administrative facts for the certificate. */
  recusals: { personId: string | null; reason: string | null }[];
  recusedIds: Set<string | null>;
  /** Required-voter ids: when non-empty, ALL of them must have approved. */
  requiredIds: (string | null)[];
  /** Eligible (non-observer/secretary) members with live weights. */
  eligibleMembers: { personId: string | null; weight: number | null }[];
  /** Every ballot row for the vote (recused ballots included — the tally filters). */
  allRecords: (typeof voteRecordsTable.$inferSelect)[];
  tally: Tally;
  /**
   * Present (confirmed/proxy) eligible weight for a meeting vote; null when the
   * vote is not a meeting vote OR its meeting has no attendance recorded (the
   * bases then fall back to the cast pool).
   */
  attendanceWeight: number | null;
  /** The attendance rows the weight was computed from — snapshotted into the certificate. */
  attendanceRows: { personId: string | null; status: string | null }[];
  bases: ResolvedBases;
}

export async function loadEvaluationContext(vote: VoteForEvaluation, dbc: DbClient = db): Promise<EvaluationContext> {
  const allMembers = vote.boardId
    ? await dbc.select().from(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, vote.boardId))
    : [];
  const eligibleMembers = allMembers
    .filter(isEligibleVoter)
    .map((m) => ({ personId: m.personId, weight: m.votingWeight }));

  const [rule] = await dbc.select().from(approvalRulesTable).where(eq(approvalRulesTable.voteId, vote.id));
  const recusals = rule
    ? await dbc.select().from(approvalRuleRecusalsTable).where(eq(approvalRuleRecusalsTable.ruleId, rule.id))
    : [];
  const recusedIds = new Set<string | null>(recusals.map((r) => r.personId));
  const requiredRows = rule
    ? await dbc.select().from(approvalRuleRequiredVotersTable).where(eq(approvalRuleRequiredVotersTable.ruleId, rule.id))
    : [];
  const requiredIds = requiredRows.map((r) => r.personId);

  const allRecords = await dbc.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, vote.id));
  const tally = computeTally(eligibleMembers, allRecords, recusedIds);

  let attendanceWeight: number | null = null;
  let attendanceRows: { personId: string | null; status: string | null }[] = [];
  if (vote.type === "meeting" && vote.meetingId) {
    const rows = await dbc.select().from(attendanceTable).where(eq(attendanceTable.meetingId, vote.meetingId));
    if (rows.length > 0) {
      attendanceRows = rows.map((r) => ({ personId: r.personId, status: r.status }));
      const presentIds = new Set(
        rows.filter((r) => (r.status === "confirmed" || r.status === "proxy") && r.personId).map((r) => r.personId!),
      );
      attendanceWeight = computeAttendanceWeight(eligibleMembers, allRecords, presentIds, recusedIds);
    }
  }

  const tallyRule: TallyRule = rule
    ? {
        type: rule.type,
        minApprovals: rule.minApprovals,
        quorum: rule.quorum,
        quorumBasis: rule.quorumBasis,
        denominatorBasis: rule.denominatorBasis,
      }
    : null;

  const bases = resolveBases(vote, tallyRule, tally, attendanceWeight);

  return { rule, tallyRule, recusals, recusedIds, requiredIds, eligibleMembers, allRecords, tally, attendanceWeight, attendanceRows, bases };
}

/**
 * The vote's outcome over a loaded context: required voters (if any) must ALL
 * have approved, then the rule is evaluated over the resolved bases.
 */
export function evaluateOutcome(ctx: EvaluationContext): "approved" | "rejected" {
  if (ctx.requiredIds.length > 0) {
    const validRecords = ctx.allRecords.filter((r) => !ctx.recusedIds.has(r.personId));
    const allRequiredApproved = ctx.requiredIds.every((pid) =>
      validRecords.some((r) => r.personId === pid && r.decision.startsWith("approved")),
    );
    if (!allRequiredApproved) return "rejected";
  }
  return evaluateByRule(ctx.tallyRule, ctx.tally, ctx.bases);
}

/**
 * The recusal list as certificate/API facts: personId, name, reason. Recusal
 * is an administrative fact about who was EXCLUDED from the vote (unlike an
 * abstention, which is a ballot) — external-review item 2 made it visible.
 */
export async function recusalFacts(
  recusals: { personId: string | null; reason: string | null }[],
  dbc: DbClient = db,
): Promise<{ personId: string | null; name: string | null; reason: string | null }[]> {
  const ids = recusals.map((r) => r.personId).filter((p): p is string => p != null);
  const people = ids.length ? await dbc.select().from(peopleTable).where(inArray(peopleTable.id, ids)) : [];
  return recusals
    .map((r) => ({
      personId: r.personId,
      name: people.find((p) => p.id === r.personId)?.name ?? null,
      reason: r.reason,
    }))
    .sort((a, b) => (a.personId ?? "").localeCompare(b.personId ?? ""));
}
