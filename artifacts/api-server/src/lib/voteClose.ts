import crypto from "crypto";
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
  computeCertificateHash,
} from "./voteTally";
import type { Tally, ResolvedBases, ApprovalRule as TallyRule } from "./voteTally";
import { getServerSigner, signCanonical, verifyCanonical, SERVER_SIGNING_ALGORITHM } from "./serverSigning";

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

// ---------------------------------------------------------------------------
// The v3 signed certificate (external-review item 1 — the circular certificate)
// ---------------------------------------------------------------------------

export const CERTIFICATE_PAYLOAD_VERSION = "LQGovernance-Vote-Certificate-v3";

/**
 * Everything the certificate attests to, frozen at close time. JSON-only
 * values (no Dates, no names — a person's display name can change legitimately
 * and must not read as tampering). Attendance and recusals are SNAPSHOTTED
 * because their source rows are mutable.
 */
export interface CertificatePayloadV3 {
  v: string;
  voteId: string;
  resolutionNumber: string;
  status: string;
  closedAt: string;
  rule: {
    type: string;
    minApprovals: number | null;
    quorum: number | null;
    quorumBasis: string | null;
    denominatorBasis: string | null;
    deadlineBehavior: string | null;
  } | null;
  bases: { quorumBasisKind: string; quorumWeight: number; denominatorKind: string; denominatorWeight: number };
  tally: {
    totalVoters: number;
    totalWeight: number;
    votesCast: number;
    castWeight: number;
    approvalsCount: number;
    approvalsWeight: number;
    abstainCount: number;
    abstainWeight: number;
  };
  records: { personId: string | null; decision: string; weight: number; castBy: string | null }[];
  recusals: { personId: string | null; reason: string | null }[];
  attendance: { personId: string | null; status: string | null }[];
  algorithm: string;
  publicKey: string;
  keyId: string;
}

// Deterministic JSON (sorted keys) — the canonical form the signature and the
// hash commit to. Injective for JSON values, and stable across a jsonb
// round-trip because the payload holds only JSON primitives.
export function canonicalCertificate(payload: unknown): string {
  const stable = (value: unknown): string => {
    if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    const keys = Object.keys(value as Record<string, unknown>).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(",")}}`;
  };
  return stable(payload);
}

export function certificateHashV3(payload: unknown): string {
  return crypto.createHash("sha256").update(canonicalCertificate(payload), "utf8").digest("hex");
}

export function buildCertificatePayload(
  vote: { id: string; resolutionNumber: string },
  status: string,
  closedAt: Date,
  ctx: EvaluationContext,
  signer: { publicKey: string; keyId: string },
): CertificatePayloadV3 {
  const sortById = <T extends { personId: string | null }>(xs: T[]) =>
    [...xs].sort((a, b) => (a.personId ?? "").localeCompare(b.personId ?? ""));
  return {
    v: CERTIFICATE_PAYLOAD_VERSION,
    voteId: vote.id,
    resolutionNumber: vote.resolutionNumber,
    status,
    closedAt: closedAt.toISOString(),
    rule: ctx.rule
      ? {
          type: ctx.rule.type,
          minApprovals: ctx.rule.minApprovals,
          quorum: ctx.rule.quorum,
          quorumBasis: ctx.rule.quorumBasis,
          denominatorBasis: ctx.rule.denominatorBasis,
          deadlineBehavior: ctx.rule.deadlineBehavior,
        }
      : null,
    bases: { ...ctx.bases },
    tally: { ...ctx.tally },
    records: sortById(ctx.allRecords).map((r) => ({
      personId: r.personId,
      decision: r.decision,
      weight: r.weight ?? 1,
      castBy: r.castBy ?? null,
    })),
    recusals: sortById(ctx.recusals).map((r) => ({ personId: r.personId, reason: r.reason })),
    attendance: sortById(ctx.attendanceRows).map((a) => ({ personId: a.personId, status: a.status })),
    algorithm: SERVER_SIGNING_ALGORITHM,
    publicKey: signer.publicKey,
    keyId: signer.keyId,
  };
}

export interface MintedCertificate {
  certificateHash: string;
  certificateVersion: number | null;
  certificatePayload: CertificatePayloadV3 | null;
  certificateSignature: string | null;
  certificateKeyId: string | null;
}

/**
 * Mint the certificate columns for a vote closing as `status` at `closedAt`.
 *
 * With the server key configured: a v3 payload (frozen bases, tally, ballots,
 * recusals, attendance snapshot) Ed25519-signed over its canonical form —
 * verification no longer recomputes the hash from the same mutable rows it is
 * checking, so a database-write attacker cannot flip ballots and re-seal.
 * FAIL-CLOSED: a configured-but-wrong secret throws (the close fails) rather
 * than silently minting an unsigned certificate.
 *
 * Without the secret (development): the legacy v2 unkeyed hash, exactly as
 * before — production refuses to boot in that state (checkStartupConfig).
 */
export async function mintCertificate(
  vote: { id: string; resolutionNumber: string },
  status: string,
  closedAt: Date,
  ctx: EvaluationContext,
): Promise<MintedCertificate> {
  const signer = await getServerSigner();
  if (!signer) {
    return {
      certificateHash: computeCertificateHash(vote.id, status, closedAt, ctx.allRecords),
      certificateVersion: null,
      certificatePayload: null,
      certificateSignature: null,
      certificateKeyId: null,
    };
  }
  const payload = buildCertificatePayload(vote, status, closedAt, ctx, signer);
  const canonical = canonicalCertificate(payload);
  return {
    certificateHash: certificateHashV3(payload),
    certificateVersion: 3,
    certificatePayload: payload,
    certificateSignature: signCanonical(signer.privateKey, canonical),
    certificateKeyId: signer.keyId,
  };
}

export interface CertificateVerification {
  verified: boolean;
  hashVersion: number | null;
  signed: boolean;
  /** v3: the stored payload's hash matches certificate_hash. */
  hashValid?: boolean;
  /** v3: the Ed25519 signature verifies over the stored payload. */
  signatureValid?: boolean;
  /** v3: a payload rebuilt from the LIVE rows matches the frozen payload. */
  payloadMatchesRecords?: boolean;
  /** v3: fingerprint of the signing public key — check it out of band. */
  fingerprint?: string;
  keyId?: string | null;
  reason?: string;
}

/**
 * Verify a v3 certificate. Three independent checks, all required:
 *
 *  1. hashValid — certificate_hash is the hash of the STORED payload;
 *  2. signatureValid — the Ed25519 signature verifies over the stored
 *     payload's canonical form, under the payload's own public key (which
 *     must also match the key row when it still exists). This is what breaks
 *     the circularity: forging it needs SERVER_SIGNING_SECRET, which is not
 *     in the database.
 *  3. payloadMatchesRecords — a payload rebuilt from the live ballots, rule,
 *     recusals and attendance equals the frozen one, so any post-close edit
 *     of those rows is named for what it is.
 *
 * THE HONEST LIMIT. An attacker holding BOTH the database and the server's
 * secret can re-sign a doctored payload. The verify response therefore
 * carries the key FINGERPRINT: an operator who recorded it out of band at
 * provisioning (docs/SIGNING.md) can detect a swapped key. Same doctrine as
 * the per-user minutes signing.
 */
export async function verifyCertificateV3(
  vote: {
    id: string;
    boardId: string | null;
    type: string;
    meetingId: string | null;
    resolutionNumber: string;
    status: string | null;
    closedAt: Date | null;
    certificateHash: string | null;
    certificatePayload: unknown;
    certificateSignature: string | null;
    certificateKeyId: string | null;
  },
): Promise<CertificateVerification> {
  const payload = vote.certificatePayload as CertificatePayloadV3 | null;
  if (!payload || !vote.certificateSignature || !vote.certificateHash || !vote.closedAt) {
    return { verified: false, hashVersion: 3, signed: true, reason: "certificate_incomplete" };
  }

  const canonical = canonicalCertificate(payload);
  const hashValid = certificateHashV3(payload) === vote.certificateHash;
  const signatureValid =
    payload.v === CERTIFICATE_PAYLOAD_VERSION &&
    payload.algorithm === SERVER_SIGNING_ALGORITHM &&
    verifyCanonical(canonical, vote.certificateSignature, payload.publicKey);

  // Rebuild the payload from the LIVE rows (same loaders the mint used) and
  // compare canonical forms: a flipped ballot, an edited recusal reason, or a
  // rewritten attendance row all land here. The signer identity is taken from
  // the STORED payload — key rotation must not read as record tampering.
  const ctx = await loadEvaluationContext(vote);
  const rebuilt = buildCertificatePayload(
    vote,
    payload.status,
    new Date(payload.closedAt),
    ctx,
    { publicKey: payload.publicKey, keyId: payload.keyId },
  );
  const payloadMatchesRecords =
    canonicalCertificate(rebuilt) === canonical &&
    // The vote row itself must still say what the certificate says it said.
    payload.status === (vote.status ?? "") &&
    payload.closedAt === vote.closedAt.toISOString();

  return {
    verified: hashValid && signatureValid && payloadMatchesRecords,
    hashVersion: 3,
    signed: true,
    hashValid,
    signatureValid,
    payloadMatchesRecords,
    fingerprint: crypto.createHash("sha256").update(Buffer.from(payload.publicKey, "base64")).digest("hex"),
    keyId: vote.certificateKeyId,
  };
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
