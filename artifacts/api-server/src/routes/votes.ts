import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import {
  db,
  votesTable,
  boardsTable,
  voteRecordsTable,
  boardMembershipsTable,
  peopleTable,
  accessControlTable,
  approvalRulesTable,
  approvalRuleRequiredVotersTable,
  approvalRuleRecusalsTable,
  voteProxiesTable,
  voteDocumentsTable,
  workflowStagesTable,
  approvalWorkflowsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { sanitizeText } from "../lib/sanitize";
import { evaluateByRule, computeTally, computeCertificateHash, computeLegacyCertificateHash } from "../lib/voteTally";
import { nextResolutionNumber } from "../lib/numbering";
import { pick } from "../lib/pick";
import { parsePagination } from "../lib/pagination";
import { grantDefaultAccess, hasAccess } from "../lib/access";
import { groupBy } from "../lib/group";
import { audit } from "../lib/auditLog";
import { retainDeleted } from "../lib/retention";
import { triggerWorkflowNextStage } from "../lib/workflowTrigger";
import { logger } from "../lib/logger";
import { writeLimiter } from "../lib/rateLimiters";
import { emitInvalidate } from "../lib/realtime";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const router = Router();

router.param("id", (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid id format" });
    return;
  }
  next();
});

router.param("docId", (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid docId format" });
    return;
  }
  next();
});

router.param("proxyId", (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid proxyId format" });
    return;
  }
  next();
});

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = [".pdf", ".docx", ".txt"];
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error("File type not supported"));
  },
});

type MembershipRow = { personId: string | null; roleInBoard: string | null; votingWeight: number };
type BallotRow = { personId: string | null; decision: string; weight: number };

/**
 * Weighted aggregates for a vote's API payloads, computed the same way the
 * evaluation path computes them: over eligible voting members (no observers,
 * no board secretaries, no recused members). On an unweighted board these
 * equal the eligible head counts.
 */
function weightedFields(boardMembers: MembershipRow[], voteRecords: BallotRow[], recusedIds: ReadonlySet<string | null> = new Set()) {
  const eligible = boardMembers
    .filter((m) => m.roleInBoard !== "observer" && m.roleInBoard !== "secretary")
    .map((m) => ({ personId: m.personId, weight: m.votingWeight }));
  const t = computeTally(eligible, voteRecords, recusedIds);
  return { totalWeight: t.totalWeight, castWeight: t.castWeight, approvalsWeight: t.approvalsWeight };
}

function buildApprovalSummary(rule: {
  type: string;
  minApprovals: number | null;
  quorum: number | null;
  weighted: boolean;
  deadlineBehavior: string;
}): string {
  const behaviors: Record<string, string> = {
    lapse: "lapses if unresolved by deadline",
    extend: "auto-extends 7 days",
    notify: "notifies secretary when deadline passes",
  };

  const ruleDesc: Record<string, string> = {
    unanimous: "Unanimous — all members must approve",
    majority: "Simple majority — more than 50% must approve",
    two_thirds: "Two-thirds majority — at least 66.7% must approve",
    three_quarters: "Three-quarters majority — at least 75% must approve",
    custom: rule.minApprovals
      ? `Custom — at least ${rule.minApprovals} approval(s) required`
      : "Custom rule",
  };

  const desc = ruleDesc[rule.type] || rule.type;
  const quorumNote = rule.quorum ? `, quorum: ${rule.quorum} voting weight` : "";
  const behaviorNote = behaviors[rule.deadlineBehavior] || rule.deadlineBehavior;
  return `${desc}${quorumNote}. Vote ${behaviorNote}.`;
}

router.get("/votes", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { boardId, status } = req.query;
  const { limit, offset } = parsePagination(req.query);

  // Push filters + access-scoping + pagination into SQL (was: fetch every vote,
  // filter/slice in JS).
  const conds = [];
  if (typeof boardId === "string") conds.push(eq(votesTable.boardId, boardId));
  if (typeof status === "string") conds.push(eq(votesTable.status, status as never));
  if (user.role !== "admin") {
    const accessible = await db
      .select({ id: accessControlTable.entityId })
      .from(accessControlTable)
      .where(
        and(
          eq(accessControlTable.entityType, "vote"),
          eq(accessControlTable.personId, user.id),
          eq(accessControlTable.hasAccess, true)
        )
      );
    const ids = accessible.map((a) => a.id).filter((v): v is string => v != null);
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    conds.push(inArray(votesTable.id, ids));
  }

  const votes = await db
    .select()
    .from(votesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(votesTable.createdAt)
    .limit(limit)
    .offset(offset);

  // Batch-load everything the page needs — one query per relation, not per vote.
  const voteIds = votes.map((v) => v.id);
  const boardIds = [...new Set(votes.map((v) => v.boardId).filter((v): v is string => v != null))];

  const boards = boardIds.length ? await db.select().from(boardsTable).where(inArray(boardsTable.id, boardIds)) : [];
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const records = voteIds.length ? await db.select().from(voteRecordsTable).where(inArray(voteRecordsTable.voteId, voteIds)) : [];
  const members = boardIds.length ? await db.select().from(boardMembershipsTable).where(inArray(boardMembershipsTable.boardId, boardIds)) : [];
  // Batched (not per-vote) rule + recusal load so the weighted tally can exclude
  // recused members, mirroring the evaluation path.
  const rules = voteIds.length ? await db.select().from(approvalRulesTable).where(inArray(approvalRulesTable.voteId, voteIds)) : [];
  const ruleIds = rules.map((r) => r.id);
  const recusals = ruleIds.length ? await db.select().from(approvalRuleRecusalsTable).where(inArray(approvalRuleRecusalsTable.ruleId, ruleIds)) : [];
  const ruleByVoteId = new Map(rules.filter((r) => r.voteId).map((r) => [r.voteId!, r]));
  const recusalsByRule = groupBy(recusals, (r) => r.ruleId);
  // Proxy grants held by the current user — one batched query, drives the
  // "you hold a proxy" affordance in the voting UI.
  const myGrants = voteIds.length
    ? await db.select().from(voteProxiesTable).where(and(inArray(voteProxiesTable.voteId, voteIds), eq(voteProxiesTable.holderId, user.id)))
    : [];
  const grantPrincipalIds = [...new Set(myGrants.map((g) => g.principalId))];
  const grantPeople = grantPrincipalIds.length
    ? await db.select().from(peopleTable).where(inArray(peopleTable.id, grantPrincipalIds))
    : [];
  const grantsByVote = groupBy(myGrants, (g) => g.voteId);
  const docs = voteIds.length ? await db.select().from(voteDocumentsTable).where(inArray(voteDocumentsTable.voteId, voteIds)) : [];
  const stages = voteIds.length ? await db.select().from(workflowStagesTable).where(inArray(workflowStagesTable.voteId, voteIds)) : [];
  const workflowIds = [...new Set(stages.map((s) => s.workflowId))];
  const workflows = workflowIds.length ? await db.select().from(approvalWorkflowsTable).where(inArray(approvalWorkflowsTable.id, workflowIds)) : [];
  const workflowById = new Map(workflows.map((w) => [w.id, w]));
  const stageByVoteId = new Map(stages.filter((s) => s.voteId).map((s) => [s.voteId!, s]));

  const recordsByVote = groupBy(records, (r) => r.voteId);
  const membersByBoard = groupBy(members, (m) => m.boardId);
  const docCountByVote = new Map<string, number>();
  for (const d of docs) docCountByVote.set(d.voteId, (docCountByVote.get(d.voteId) ?? 0) + 1);

  const result = votes.map((v) => {
    const board = v.boardId ? boardById.get(v.boardId) : null;
    const voteRecords = recordsByVote.get(v.id) ?? [];
    const approvals = voteRecords.filter((r) => r.decision.startsWith("approved")).length;
    const boardMembers = v.boardId ? membersByBoard.get(v.boardId) ?? [] : [];
    const myRecord = voteRecords.find((r) => r.personId === user.id);
    const rule = ruleByVoteId.get(v.id);
    const recusedIds = new Set((rule ? recusalsByRule.get(rule.id) ?? [] : []).map((r) => r.personId));
    const stage = stageByVoteId.get(v.id);
    const workflow = stage ? workflowById.get(stage.workflowId) : null;
    const workflowStage = stage && workflow
      ? {
          workflowId: workflow.id,
          workflowTitle: workflow.title,
          stageGroup: stage.stageGroup,
          stageIndex: stage.stageIndex,
          stageTitle: stage.title,
          stageStatus: stage.status,
        }
      : null;

    return {
      ...v,
      boardName: board?.name || null,
      boardAbbreviation: board?.abbreviation || null,
      totalVoters: boardMembers.length,
      votescast: voteRecords.length,
      approvalsCount: approvals,
      ...weightedFields(boardMembers, voteRecords, recusedIds),
      hasVoted: !!myRecord,
      myProxies: (grantsByVote.get(v.id) ?? []).map((g) => ({
        proxyId: g.id,
        principalId: g.principalId,
        principalName: grantPeople.find((p) => p.id === g.principalId)?.name ?? null,
        hasVoted: voteRecords.some((r) => r.personId === g.principalId),
      })),
      documentCount: docCountByVote.get(v.id) ?? 0,
      workflowStage,
    };
  });

  res.json(result);
});

const VALID_VOTE_STATUSES = ["open", "approved", "rejected", "lapsed", "cancelled"];

router.post("/votes", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const { boardId, meetingId, resolutionNumber: rawResolutionNumber, title, resolutionText, type, deadline, approvalRule, secret } = pick(req.body, ["boardId", "meetingId", "resolutionNumber", "title", "resolutionText", "type", "deadline", "approvalRule", "secret"] as (keyof typeof req.body)[]) as { boardId?: string; meetingId?: string; resolutionNumber?: string; title?: string; resolutionText?: string; type?: string; deadline?: string; approvalRule?: unknown; secret?: boolean };
  if (!boardId || !title || !resolutionText || !type) {
    res.status(400).json({ error: "Required: boardId, title, resolutionText, type" });
    return;
  }

  const VALID_VOTE_TYPES = ["circulation", "meeting", "simple", "resolution", "election", "special"] as const;
  type VoteType = (typeof VALID_VOTE_TYPES)[number];
  if (!VALID_VOTE_TYPES.includes(type as VoteType)) {
    res.status(400).json({ error: `Invalid vote type. Must be one of: ${VALID_VOTE_TYPES.join(", ")}` });
    return;
  }

  // Validate the approval rule shape up front — an unknown rule type otherwise
  // falls through to the majority default at evaluation time (finding L5).
  const VALID_RULE_TYPES = ["unanimous", "majority", "two_thirds", "three_quarters", "custom"] as const;
  type RuleType = (typeof VALID_RULE_TYPES)[number];
  const VALID_DEADLINE_BEHAVIORS = ["lapse", "extend", "notify"] as const;
  type DeadlineBehavior = (typeof VALID_DEADLINE_BEHAVIORS)[number];
  interface ApprovalRuleInput {
    type?: string;
    minApprovals?: number;
    quorum?: number;
    weighted?: boolean;
    deadlineBehavior?: string;
    requiredVoterIds?: string[];
    recusedIds?: string[];
  }
  const rule = approvalRule as ApprovalRuleInput | undefined;
  if (rule?.type != null && !VALID_RULE_TYPES.includes(rule.type as RuleType)) {
    res.status(400).json({ error: `Invalid approval rule type. Must be one of: ${VALID_RULE_TYPES.join(", ")}` });
    return;
  }
  if (rule?.deadlineBehavior != null && !VALID_DEADLINE_BEHAVIORS.includes(rule.deadlineBehavior as DeadlineBehavior)) {
    res.status(400).json({ error: `Invalid deadlineBehavior. Must be one of: ${VALID_DEADLINE_BEHAVIORS.join(", ")}` });
    return;
  }

  const cleanTitle = sanitizeText(title);
  const cleanResolutionText = sanitizeText(resolutionText);

  // Generate resolution number server-side if not provided (race-free sequence)
  let resolutionNumber = rawResolutionNumber;
  if (!resolutionNumber) {
    const [board] = await db.select().from(boardsTable).where(eq(boardsTable.id, boardId));
    resolutionNumber = await nextResolutionNumber(db, board?.abbreviation || "GEN");
  }

  const [vote] = await db
    .insert(votesTable)
    .values({
      boardId,
      meetingId,
      resolutionNumber,
      title: cleanTitle,
      resolutionText: cleanResolutionText,
      type: type as VoteType,
      deadline: deadline ? new Date(deadline) : null,
      secret: secret === true,
    })
    .returning();

  if (rule) {
    const [insertedRule] = await db
      .insert(approvalRulesTable)
      .values({
        voteId: vote.id,
        type: (rule.type as RuleType) || "majority",
        minApprovals: rule.minApprovals,
        quorum: rule.quorum,
        weighted: rule.weighted || false,
        deadlineBehavior: (rule.deadlineBehavior as DeadlineBehavior) || "lapse",
      })
      .returning();

    if (rule.requiredVoterIds?.length) {
      await db.insert(approvalRuleRequiredVotersTable).values(
        rule.requiredVoterIds.map((pid: string) => ({ ruleId: insertedRule.id, personId: pid }))
      );
    }
    if (rule.recusedIds?.length) {
      await db.insert(approvalRuleRecusalsTable).values(
        rule.recusedIds.map((pid: string) => ({ ruleId: insertedRule.id, personId: pid }))
      );
    }
  }

  await grantDefaultAccess("vote", vote.id, boardId);

  const [board] = boardId
    ? await db.select().from(boardsTable).where(eq(boardsTable.id, boardId))
    : [null];

  const members = boardId
    ? await db.select().from(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, boardId))
    : [];

  audit(req, "vote_created", "vote", vote.id, { title: vote.title, resolutionNumber: vote.resolutionNumber, boardName: board?.name });
  emitInvalidate("votes", { boardId, id: vote.id });
  res.status(201).json({
    ...vote,
    boardName: board?.name || null,
    boardAbbreviation: board?.abbreviation || null,
    totalVoters: members.length,
    votescast: 0,
    approvalsCount: 0,
    ...weightedFields(members, [], new Set(rule?.recusedIds ?? [])),
    hasVoted: false,
    documentCount: 0,
  });
});

router.get("/votes/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const [vote] = await db.select().from(votesTable).where(eq(votesTable.id, id));
  if (!vote) {
    res.status(404).json({ error: "Vote not found" });
    return;
  }

  if (!await hasAccess(user.id, user.role, "vote", id)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const [board] = vote.boardId
    ? await db.select().from(boardsTable).where(eq(boardsTable.id, vote.boardId))
    : [null];

  const records = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, id));
  const approvals = records.filter((r) => r.decision.startsWith("approved")).length;

  const members = vote.boardId
    ? await db.select().from(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, vote.boardId))
    : [];

  const myRecord = records.find((r) => r.personId === user.id);

  // Proxy grants for this vote — administrative facts (who may vote for whom),
  // not ballot contents, so they are visible to everyone with vote access even
  // on secret ballots. Ballot CONTENTS stay masked below.
  const proxies = await db.select().from(voteProxiesTable).where(eq(voteProxiesTable.voteId, id));
  const proxyPersonIds = [...new Set(proxies.flatMap((p) => [p.principalId, p.holderId]))];
  const proxyPeople = proxyPersonIds.length
    ? await db.select().from(peopleTable).where(inArray(peopleTable.id, proxyPersonIds))
    : [];
  const proxyNameOf = (pid: string) => proxyPeople.find((p) => p.id === pid)?.name ?? null;
  const proxiesWithNames = proxies.map((p) => ({
    ...p,
    principalName: proxyNameOf(p.principalId),
    holderName: proxyNameOf(p.holderId),
    used: records.some((r) => r.personId === p.principalId && r.castBy === p.holderId),
  }));
  // The grants the current user holds — drives the "you hold a proxy for Y"
  // voting UI. hasVoted covers ANY ballot for the principal (own or proxy).
  const myProxies = proxiesWithNames
    .filter((p) => p.holderId === user.id)
    .map((p) => ({
      proxyId: p.id,
      principalId: p.principalId,
      principalName: p.principalName,
      hasVoted: records.some((r) => r.personId === p.principalId),
    }));

  const voteRecordsWithPeople = await Promise.all(
    records.map(async (r) => {
      const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, r.personId!));
      const { passwordHash: _, ...safePerson } = person || { passwordHash: "" };
      const [castByPerson] = r.castBy
        ? await db.select().from(peopleTable).where(eq(peopleTable.id, r.castBy))
        : [null];
      return { ...r, person: safePerson, castByName: castByPerson?.name ?? null };
    })
  );

  const boardMembersWithPeople = await Promise.all(
    members.map(async (m) => {
      const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, m.personId!));
      const { passwordHash: _, ...safePerson } = person || { passwordHash: "" };
      return { ...m, person: safePerson };
    })
  );

  const [approvalRule] = await db
    .select()
    .from(approvalRulesTable)
    .where(eq(approvalRulesTable.voteId, id));

  const ruleRecusals = approvalRule
    ? await db.select().from(approvalRuleRecusalsTable).where(eq(approvalRuleRecusalsTable.ruleId, approvalRule.id))
    : [];
  const ruleRequiredVoters = approvalRule
    ? await db.select().from(approvalRuleRequiredVotersTable).where(eq(approvalRuleRequiredVotersTable.ruleId, approvalRule.id))
    : [];

  const ruleWithSummary = approvalRule
    ? {
        ...approvalRule,
        summaryText: buildApprovalSummary({
          type: approvalRule.type,
          minApprovals: approvalRule.minApprovals,
          quorum: approvalRule.quorum,
          weighted: approvalRule.weighted || false,
          deadlineBehavior: approvalRule.deadlineBehavior || "lapse",
        }),
        recusedIds: ruleRecusals.map((r) => r.personId),
        requiredVoterIds: ruleRequiredVoters.map((r) => r.personId),
      }
    : null;

  const docs = await db
    .select()
    .from(voteDocumentsTable)
    .where(eq(voteDocumentsTable.voteId, id));

  const docsWithUploader = await Promise.all(
    docs.map(async (d) => {
      const [uploader] = d.uploadedBy
        ? await db.select().from(peopleTable).where(eq(peopleTable.id, d.uploadedBy))
        : [null];
      const { passwordHash: _, ...safeUploader } = uploader || ({ passwordHash: "" } as any);
      return { ...d, uploaderName: uploader?.name || null };
    })
  );

  const thisStage = await db
    .select()
    .from(workflowStagesTable)
    .where(eq(workflowStagesTable.voteId, id))
    .then((rows) => rows[0] || null);

  let workflowContext: Record<string, unknown> | null = null;
  if (thisStage) {
    const [wf] = await db
      .select()
      .from(approvalWorkflowsTable)
      .where(eq(approvalWorkflowsTable.id, thisStage.workflowId));

    const allWfStages = await db
      .select()
      .from(workflowStagesTable)
      .where(eq(workflowStagesTable.workflowId, thisStage.workflowId));

    const stagesWithBoard = await Promise.all(
      allWfStages.map(async (s) => {
        const [b] = s.boardId
          ? await db.select().from(boardsTable).where(eq(boardsTable.id, s.boardId))
          : [null];
        const voteStats = s.voteId
          ? await (async () => {
              const recs = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, s.voteId!));
              const mems = s.boardId
                ? await db.select().from(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, s.boardId!))
                : [];
              return {
                votesCast: recs.length,
                approvalsCount: recs.filter((r) => r.decision.startsWith("approved")).length,
                totalVoters: mems.length,
              };
            })()
          : null;
        return {
          id: s.id,
          stageIndex: s.stageIndex,
          stageGroup: s.stageGroup,
          title: s.title,
          description: s.description,
          status: s.status,
          boardId: s.boardId,
          boardName: b?.name || null,
          boardAbbreviation: b?.abbreviation || null,
          approvalType: s.approvalType,
          completedAt: s.completedAt,
          voteId: s.voteId,
          isCurrentVote: s.voteId === id,
          voteStats,
        };
      })
    );

    workflowContext = {
      workflowId: wf?.id || thisStage.workflowId,
      workflowTitle: wf?.title || "Approval Workflow",
      workflowStatus: wf?.status || "active",
      stages: stagesWithBoard,
      thisStageGroup: thisStage.stageGroup,
      thisStageIndex: thisStage.stageIndex,
    };
  }

  res.json({
    ...vote,
    boardName: board?.name || null,
    boardAbbreviation: board?.abbreviation || null,
    totalVoters: members.length,
    votescast: records.length,
    approvalsCount: approvals,
    ...weightedFields(members, records, new Set(ruleRecusals.map((r) => r.personId))),
    hasVoted: !!myRecord,
    myVote: myRecord
      ? {
          ...myRecord,
          person: (() => {
            const { passwordHash: _, ...p } = { passwordHash: "", ...myRecord } as any;
            return p;
          })(),
        }
      : null,
    // Secret-ballot masking: a non-admin sees only ballots they are already
    // party to — their own, and any they cast as proxy holder (they know that
    // ballot's content because they cast it; once the principal supersedes it,
    // castBy resets and the holder loses visibility of the new ballot).
    voteRecords: vote.secret && user.role !== "admin"
      ? voteRecordsWithPeople.filter((r) => r.personId === user.id || r.castBy === user.id)
      : voteRecordsWithPeople,
    proxies: proxiesWithNames,
    myProxies,
    boardMembers: boardMembersWithPeople,
    approvalRule: ruleWithSummary,
    certificateHash: vote.certificateHash,
    documents: docsWithUploader,
    workflowContext,
  });
});

router.patch("/votes/:id", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { title, resolutionText, deadline, status, secret } = pick(req.body, ["title", "resolutionText", "deadline", "status", "secret"] as (keyof typeof req.body)[]) as { title?: string; resolutionText?: string; deadline?: string; status?: string; secret?: boolean };
  if (status != null && !VALID_VOTE_STATUSES.includes(status)) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_VOTE_STATUSES.join(", ")}` });
    return;
  }
  // Governance integrity: "approved"/"rejected" are OUTCOMES — they may only be
  // set by the vote-evaluation path (all eligible members voted → evaluateByRule),
  // never forced directly by an admin. An admin may still cancel or lapse an open vote.
  if (status === "approved" || status === "rejected") {
    await audit(req, "vote_force_status_blocked", "vote", id, { attemptedStatus: status });
    res.status(403).json({ error: "A vote's approved/rejected outcome is determined by the votes cast, not set manually. You can cancel or lapse an open vote." });
    return;
  }
  if (status != null && ["lapsed", "cancelled"].includes(status)) {
    const [current] = await db.select({ status: votesTable.status }).from(votesTable).where(eq(votesTable.id, id));
    if (!current) {
      res.status(404).json({ error: "Vote not found" });
      return;
    }
    if (current.status !== "open") {
      res.status(409).json({ error: `Cannot change status of a vote that is already closed (current status: ${current.status})` });
      return;
    }
  }
  const updates: Record<string, unknown> = {};
  if (title != null) updates.title = sanitizeText(title);
  if (resolutionText != null) updates.resolutionText = sanitizeText(resolutionText);
  if (deadline != null) updates.deadline = new Date(deadline);
  if (secret != null) updates.secret = secret;
  if (status != null) {
    updates.status = status;
    if (["approved", "rejected", "lapsed", "cancelled"].includes(status)) {
      const closedAt = new Date();
      updates.closedAt = closedAt;
      // Only generate certificate hash for finalized (non-cancelled) statuses.
      // Same instant for the hash and the stored column so it stays verifiable.
      if (["approved", "rejected", "lapsed"].includes(status)) {
        const records = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, id));
        updates.certificateHash = computeCertificateHash(id, status, closedAt, records);
      }
    }
  }

  const [vote] = await db.update(votesTable).set(updates).where(eq(votesTable.id, id)).returning();
  if (!vote) {
    res.status(404).json({ error: "Vote not found" });
    return;
  }

  await audit(req, "vote_updated", "vote", id, { changed: Object.keys(updates), status: status ?? undefined });
  emitInvalidate("votes", { boardId: vote.boardId, id });

  if (status && ["approved", "rejected"].includes(status)) {
    setImmediate(() => triggerWorkflowNextStage(id, status).catch((err) => logger.error({ err, voteId: id }, "Workflow trigger failed")));
  }

  const [board] = vote.boardId
    ? await db.select().from(boardsTable).where(eq(boardsTable.id, vote.boardId))
    : [null];

  const records = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, id));
  const approvals = records.filter((r) => r.decision.startsWith("approved")).length;
  const members = vote.boardId
    ? await db.select().from(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, vote.boardId))
    : [];

  res.json({
    ...vote,
    boardName: board?.name,
    boardAbbreviation: board?.abbreviation,
    totalVoters: members.length,
    votescast: records.length,
    approvalsCount: approvals,
    ...weightedFields(members, records),
    hasVoted: false,
  });
});

router.delete("/votes/:id", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [vote] = await db.select().from(votesTable).where(eq(votesTable.id, id));
  if (!vote) {
    res.status(404).json({ error: "Vote not found" });
    return;
  }

  const records = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, id));
  if (records.length > 0) {
    res.status(409).json({ error: "Cannot delete a vote that has received votes. Use Cancel Vote instead." });
    return;
  }

  // Delete vote_documents (files + DB rows)
  const docs = await db.select().from(voteDocumentsTable).where(eq(voteDocumentsTable.voteId, id));
  const proxies = await db.select().from(voteProxiesTable).where(eq(voteProxiesTable.voteId, id));

  // Retain a snapshot of the vote, its documents, and proxy grants before the cascade delete.
  await retainDeleted(req, "vote", id, { vote, documents: docs, proxies });
  await db.delete(voteProxiesTable).where(eq(voteProxiesTable.voteId, id));

  for (const doc of docs) {
    if (doc.filePath && fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
  }
  await db.delete(voteDocumentsTable).where(eq(voteDocumentsTable.voteId, id));

  // Delete approval rule and its children
  const [rule] = await db.select().from(approvalRulesTable).where(eq(approvalRulesTable.voteId, id));
  if (rule) {
    await db.delete(approvalRuleRequiredVotersTable).where(eq(approvalRuleRequiredVotersTable.ruleId, rule.id));
    await db.delete(approvalRuleRecusalsTable).where(eq(approvalRuleRecusalsTable.ruleId, rule.id));
    await db.delete(approvalRulesTable).where(eq(approvalRulesTable.id, rule.id));
  }

  // Delete access control entries
  await db.delete(accessControlTable).where(
    and(eq(accessControlTable.entityType, "vote"), eq(accessControlTable.entityId, id))
  );

  audit(req, "vote_deleted", "vote", id, { title: vote.title });
  await db.delete(votesTable).where(eq(votesTable.id, id));
  emitInvalidate("votes", { boardId: vote.boardId, id });
  res.sendStatus(204);
});

router.post("/votes/:id/cast", requireAuth, writeLimiter, async (req, res): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const user = req.user!;
    const { decision, comment, onBehalfOf } = req.body;

    if (!decision) {
      res.status(400).json({ error: "decision required" });
      return;
    }

    const [vote] = await db.select().from(votesTable).where(eq(votesTable.id, id));
    if (!vote || vote.status !== "open") {
      res.status(400).json({ error: "Vote is not open" });
      return;
    }

    if (!await hasAccess(user.id, user.role, "vote", id)) {
      res.status(403).json({ error: "Access denied — you may be recused from this vote" });
      return;
    }

    const VALID_DECISIONS = ["approved", "approved_with_comments", "not_approved", "not_approved_with_comments"];
    if (!VALID_DECISIONS.includes(decision)) {
      res.status(400).json({ error: `Invalid decision. Must be one of: ${VALID_DECISIONS.join(", ")}` });
      return;
    }

    if (decision.includes("with_comments") && !comment?.trim()) {
      res.status(400).json({ error: "A comment is required when voting with comments" });
      return;
    }

    // Proxy casting: `onBehalfOf` names the PRINCIPAL whose ballot this is.
    // The ballot is recorded against the principal (person_id = principal,
    // cast_by = holder) — the holder is attributed, never masqueraded. Only
    // the designated holder of a recorded per-vote grant may do this.
    let ballotOwnerId = user.id;
    let castBy: string | null = null;
    if (onBehalfOf != null) {
      if (typeof onBehalfOf !== "string" || !UUID_REGEX.test(onBehalfOf)) {
        res.status(400).json({ error: "onBehalfOf must be a valid person id" });
        return;
      }
      if (onBehalfOf === user.id) {
        res.status(400).json({ error: "You cannot hold a proxy for yourself — cast your own ballot without onBehalfOf" });
        return;
      }
      if (!vote.boardId) {
        res.status(400).json({ error: "Proxy voting is only available on board votes" });
        return;
      }
      const [grant] = await db
        .select()
        .from(voteProxiesTable)
        .where(and(
          eq(voteProxiesTable.voteId, id),
          eq(voteProxiesTable.principalId, onBehalfOf),
          eq(voteProxiesTable.holderId, user.id),
        ));
      if (!grant) {
        res.status(403).json({ error: "You do not hold a proxy for this member on this vote" });
        return;
      }
      // The principal's ballot is subject to the principal's own access
      // (recusal/access revocation), exactly as if they cast in person.
      if (!await hasAccess(onBehalfOf, "member", "vote", id)) {
        res.status(403).json({ error: "The member you hold a proxy for does not have access to this vote" });
        return;
      }
      ballotOwnerId = onBehalfOf;
      castBy = user.id;
    }

    // Snapshot the ballot owner's board weight onto the ballot: the tally and
    // the certificate hash use the persisted snapshot, so a later
    // membership-weight edit can never rewrite a cast ballot. A proxy-cast
    // ballot weighs as the PRINCIPAL, never as the holder.
    let ballotWeight = 1;
    if (vote.boardId) {
      const [membership] = await db
        .select()
        .from(boardMembershipsTable)
        .where(and(eq(boardMembershipsTable.boardId, vote.boardId), eq(boardMembershipsTable.personId, ballotOwnerId)));
      const role = membership?.roleInBoard;
      if (!membership || role === "observer" || role === "secretary") {
        res.status(403).json({
          error: castBy
            ? "The member you hold a proxy for is not an eligible voter for this resolution"
            : "You are not an eligible voter for this resolution",
        });
        return;
      }
      ballotWeight = membership.votingWeight ?? 1;

      if (castBy) {
        // The holder must themselves still be an eligible voting member of the board.
        const [holderMembership] = await db
          .select()
          .from(boardMembershipsTable)
          .where(and(eq(boardMembershipsTable.boardId, vote.boardId), eq(boardMembershipsTable.personId, user.id)));
        const holderRole = holderMembership?.roleInBoard;
        if (!holderMembership || holderRole === "observer" || holderRole === "secretary") {
          res.status(403).json({ error: "You are not an eligible voter for this resolution" });
          return;
        }
      }
    }

    const sanitizedComment = comment ? sanitizeText(comment) : null;

    // No double voting, with a defined precedence: a principal casting in
    // person SUPERSEDES their proxy-cast ballot (the standard rule — the
    // member's own voice wins); every other duplicate is rejected, including a
    // proxy cast after the principal has voted. The (voteId, personId) unique
    // constraint backstops this check against races.
    const [existing] = await db
      .select()
      .from(voteRecordsTable)
      .where(and(eq(voteRecordsTable.voteId, id), eq(voteRecordsTable.personId, ballotOwnerId)));

    let record;
    if (existing) {
      if (!castBy && existing.castBy) {
        [record] = await db
          .update(voteRecordsTable)
          .set({ decision, comment: sanitizedComment, weight: ballotWeight, castBy: null, votedAt: new Date() })
          .where(eq(voteRecordsTable.id, existing.id))
          .returning();
        await audit(req, "vote_proxy_superseded", "vote", id, {
          principalId: ballotOwnerId,
          previousCastBy: existing.castBy,
          previousDecision: existing.decision,
          decision,
          voteTitle: vote.title,
        });
      } else {
        res.status(409).json({ error: castBy ? "This member has already voted" : "You have already voted" });
        return;
      }
    } else {
      [record] = await db
        .insert(voteRecordsTable)
        .values({ voteId: id, personId: ballotOwnerId, decision, comment: sanitizedComment, weight: ballotWeight, castBy })
        .returning();
    }

    if (vote.boardId) {
      const allMembers = await db.select().from(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, vote.boardId));
      const eligibleMembers = allMembers.filter((m) => m.roleInBoard !== "observer" && m.roleInBoard !== "secretary");

      // Fetch the approval rule and recusals so we can exclude recused members from quorum
      const [rule] = await db.select().from(approvalRulesTable).where(eq(approvalRulesTable.voteId, id));
      const recusals = rule
        ? await db.select().from(approvalRuleRecusalsTable).where(eq(approvalRuleRecusalsTable.ruleId, rule.id))
        : [];
      const recusedIds = new Set(recusals.map((r) => r.personId));

      // Required voters: if any, ALL of them must have approved
      const requiredVoterRows = rule
        ? await db.select().from(approvalRuleRequiredVotersTable).where(eq(approvalRuleRequiredVotersTable.ruleId, rule.id))
        : [];
      const requiredIds = requiredVoterRows.map((r) => r.personId);

      const allRecords = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, id));
      const validRecords = allRecords.filter((r) => !recusedIds.has(r.personId!));

      // Weighted tally: outcome and quorum are decided over voting WEIGHT.
      // Every weight defaults to 1, so an unweighted board evaluates exactly
      // as the old head-count tally did.
      const tally = computeTally(
        eligibleMembers.map((m) => ({ personId: m.personId, weight: m.votingWeight })),
        allRecords,
        recusedIds,
      );

      if (tally.votesCast >= tally.totalVoters && tally.totalVoters > 0) {
        let newStatus: "approved" | "rejected";
        if (requiredIds.length > 0) {
          const allRequiredApproved = requiredIds.every((pid) =>
            validRecords.some((r) => r.personId === pid && r.decision.startsWith("approved"))
          );
          newStatus = allRequiredApproved ? evaluateByRule(rule, tally.approvalsWeight, tally.totalWeight, tally.castWeight) : "rejected";
        } else {
          newStatus = evaluateByRule(rule, tally.approvalsWeight, tally.totalWeight, tally.castWeight);
        }

        // One instant for both the stored column and the certificate, so the
        // certificate hash can be recomputed and verified later.
        const closedAt = new Date();
        const hash = computeCertificateHash(id, newStatus, closedAt, allRecords);
        await db
          .update(votesTable)
          .set({ status: newStatus as any, closedAt, certificateHash: hash })
          .where(eq(votesTable.id, id));
        setImmediate(() => triggerWorkflowNextStage(id, newStatus).catch((err) => logger.error({ err, voteId: id }, "Workflow trigger failed")));
      }
    }

    // The returned record belongs to the ballot owner (the principal, for a
    // proxy cast) — with the holder attributed via castBy.
    const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, ballotOwnerId));
    const { passwordHash: _, ...safePerson } = person;
    audit(req, "vote_cast", "vote", id, { decision, voteTitle: vote.title, ...(castBy ? { asProxyFor: ballotOwnerId } : {}) });
    emitInvalidate("votes", { boardId: vote.boardId, id });
    res.json({ ...record, person: safePerson });
  } catch (err: unknown) {
    const anyErr = err as { code?: string; message?: string; cause?: { code?: string } };
    const pgCode = anyErr.code ?? anyErr.cause?.code;
    if (pgCode === "23505") {
      res.status(409).json({ error: "You have already voted" });
      return;
    }
    logger.error({ err: anyErr }, "[votes] cast error");
    res.status(500).json({ error: "Failed to record vote" });
  }
});

// Record a proxy grant for one vote: `holderId` may cast on behalf of
// `principalId` for THIS vote only (per-vote grants — the circulation-vote
// model has no meeting session to scope a wider grant to, and per-vote keeps
// the audit trail exact). Secretary/admin records the grant; every governance
// edge is enforced here so the cast path can trust the grant.
router.post("/votes/:id/proxies", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { principalId, holderId } = pick(req.body, ["principalId", "holderId"] as (keyof typeof req.body)[]) as { principalId?: string; holderId?: string };

  if (!principalId || !holderId || !UUID_REGEX.test(principalId) || !UUID_REGEX.test(holderId)) {
    res.status(400).json({ error: "Required: principalId and holderId (person UUIDs)" });
    return;
  }
  if (principalId === holderId) {
    res.status(400).json({ error: "A member cannot hold a proxy for themselves" });
    return;
  }

  const [vote] = await db.select().from(votesTable).where(eq(votesTable.id, id));
  if (!vote) {
    res.status(404).json({ error: "Vote not found" });
    return;
  }
  if (vote.status !== "open") {
    res.status(409).json({ error: "Proxies can only be granted while the vote is open" });
    return;
  }
  if (!vote.boardId) {
    res.status(400).json({ error: "Proxy voting is only available on board votes" });
    return;
  }

  const [board] = await db.select().from(boardsTable).where(eq(boardsTable.id, vote.boardId));
  const proxyLimit = board?.proxyLimit ?? 1;
  if (proxyLimit < 1) {
    res.status(409).json({ error: "Proxy voting is disabled on this board" });
    return;
  }

  // Both parties must be eligible voting members of the vote's board.
  const memberships = await db
    .select()
    .from(boardMembershipsTable)
    .where(and(eq(boardMembershipsTable.boardId, vote.boardId), inArray(boardMembershipsTable.personId, [principalId, holderId])));
  for (const [pid, who] of [[principalId, "principal"], [holderId, "proxy holder"]] as const) {
    const m = memberships.find((row) => row.personId === pid);
    if (!m || m.roleInBoard === "observer" || m.roleInBoard === "secretary") {
      res.status(400).json({ error: `The ${who} is not an eligible voting member of this board` });
      return;
    }
  }

  // Neither party may be recused from this vote.
  const [rule] = await db.select().from(approvalRulesTable).where(eq(approvalRulesTable.voteId, id));
  if (rule) {
    const recusals = await db.select().from(approvalRuleRecusalsTable).where(eq(approvalRuleRecusalsTable.ruleId, rule.id));
    const recused = new Set(recusals.map((r) => r.personId));
    if (recused.has(principalId)) {
      res.status(409).json({ error: "The principal is recused from this vote" });
      return;
    }
    if (recused.has(holderId)) {
      res.status(409).json({ error: "The proxy holder is recused from this vote" });
      return;
    }
  }

  // A proxy is for an ABSENT member: pointless (and confusing) once the
  // principal has already voted.
  const [existingBallot] = await db
    .select()
    .from(voteRecordsTable)
    .where(and(eq(voteRecordsTable.voteId, id), eq(voteRecordsTable.personId, principalId)));
  if (existingBallot) {
    res.status(409).json({ error: "This member has already voted on this resolution" });
    return;
  }

  const grants = await db.select().from(voteProxiesTable).where(eq(voteProxiesTable.voteId, id));
  if (grants.some((g) => g.principalId === principalId)) {
    res.status(409).json({ error: "This member has already granted a proxy for this vote" });
    return;
  }
  // A member who has delegated their own ballot away cannot collect proxies.
  if (grants.some((g) => g.principalId === holderId)) {
    res.status(409).json({ error: "The proxy holder has delegated their own ballot for this vote and cannot hold proxies" });
    return;
  }
  const held = grants.filter((g) => g.holderId === holderId).length;
  if (held >= proxyLimit) {
    res.status(409).json({ error: `A member may hold at most ${proxyLimit} prox${proxyLimit === 1 ? "y" : "ies"} on this board` });
    return;
  }

  const [proxy] = await db
    .insert(voteProxiesTable)
    .values({ voteId: id, principalId, holderId, createdBy: req.user!.id })
    .returning();

  const namedPeople = await db.select().from(peopleTable).where(inArray(peopleTable.id, [principalId, holderId]));
  const nameOf = (pid: string) => namedPeople.find((p) => p.id === pid)?.name ?? null;

  await audit(req, "vote_proxy_granted", "vote", id, { principalId, holderId, voteTitle: vote.title });
  emitInvalidate("votes", { boardId: vote.boardId, id, userIds: [principalId, holderId] });
  res.status(201).json({ ...proxy, principalName: nameOf(principalId), holderName: nameOf(holderId), used: false });
});

// Revoke an unused proxy grant while the vote is open. A grant whose ballot
// has already been cast cannot be silently revoked — the principal supersedes
// it by casting in person instead (audit-logged precedence rule).
router.delete("/votes/:id/proxies/:proxyId", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const proxyId = Array.isArray(req.params.proxyId) ? req.params.proxyId[0] : req.params.proxyId;

  const [proxy] = await db.select().from(voteProxiesTable).where(eq(voteProxiesTable.id, proxyId));
  if (!proxy || proxy.voteId !== id) {
    res.status(404).json({ error: "Proxy grant not found" });
    return;
  }
  const [vote] = await db.select().from(votesTable).where(eq(votesTable.id, id));
  if (!vote || vote.status !== "open") {
    res.status(409).json({ error: "Proxies can only be revoked while the vote is open" });
    return;
  }
  const [usedBallot] = await db
    .select()
    .from(voteRecordsTable)
    .where(and(
      eq(voteRecordsTable.voteId, id),
      eq(voteRecordsTable.personId, proxy.principalId),
      eq(voteRecordsTable.castBy, proxy.holderId),
    ));
  if (usedBallot) {
    res.status(409).json({ error: "This proxy has already been used. The principal can override it by casting their own ballot." });
    return;
  }

  await db.delete(voteProxiesTable).where(eq(voteProxiesTable.id, proxyId));
  await audit(req, "vote_proxy_revoked", "vote", id, { principalId: proxy.principalId, holderId: proxy.holderId });
  emitInvalidate("votes", { boardId: vote.boardId, id, userIds: [proxy.principalId, proxy.holderId] });
  res.sendStatus(204);
});

router.get("/votes/:id/documents", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const [vote] = await db.select().from(votesTable).where(eq(votesTable.id, id));
  if (!vote) {
    res.status(404).json({ error: "Vote not found" });
    return;
  }

  if (!await hasAccess(user.id, user.role, "vote", id)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const docs = await db.select().from(voteDocumentsTable).where(eq(voteDocumentsTable.voteId, id));
  const docsWithUploader = await Promise.all(
    docs.map(async (d) => {
      const [uploader] = d.uploadedBy
        ? await db.select().from(peopleTable).where(eq(peopleTable.id, d.uploadedBy))
        : [null];
      return { ...d, uploaderName: uploader?.name || null };
    })
  );

  res.json(docsWithUploader);
});

router.post("/votes/:id/documents", requireAuth, writeLimiter, (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || "Upload failed" });
      return;
    }
    next();
  });
}, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const [vote] = await db.select().from(votesTable).where(eq(votesTable.id, id));
  if (!vote) {
    res.status(404).json({ error: "Vote not found" });
    return;
  }

  if (user.role !== "admin" && !await hasAccess(user.id, user.role, "vote", id)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const { originalname, path: filePath, size, mimetype } = req.file;
  const title = (req.body.title as string) || originalname;

  const [doc] = await db
    .insert(voteDocumentsTable)
    .values({
      voteId: id,
      title,
      filename: originalname,
      filePath,
      fileSize: size,
      mimeType: mimetype,
      uploadedBy: user.id,
    })
    .returning();

  audit(req, "vote_material_uploaded", "vote", id, { filename: originalname, title, voteTitle: vote.title });
  res.status(201).json({ ...doc, uploaderName: user.name || null });
});

router.delete("/votes/:id/documents/:docId", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const docId = Array.isArray(req.params.docId) ? req.params.docId[0] : req.params.docId;

  const [doc] = await db.select().from(voteDocumentsTable).where(eq(voteDocumentsTable.id, docId));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (doc.filePath && fs.existsSync(doc.filePath)) {
    fs.unlinkSync(doc.filePath);
  }

  await db.delete(voteDocumentsTable).where(eq(voteDocumentsTable.id, docId));
  res.sendStatus(204);
});

router.get("/votes/:id/documents/:docId/download", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const docId = Array.isArray(req.params.docId) ? req.params.docId[0] : req.params.docId;
  const user = req.user!;

  if (!await hasAccess(user.id, user.role, "vote", id)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const [doc] = await db.select().from(voteDocumentsTable).where(eq(voteDocumentsTable.id, docId));
  if (!doc || doc.voteId !== id || !doc.filePath || !fs.existsSync(doc.filePath)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  // Defense in depth: never stream a file that resolved outside the uploads dir.
  const resolvedPath = path.resolve(doc.filePath);
  if (!resolvedPath.startsWith(path.resolve(UPLOADS_DIR) + path.sep)) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  audit(req, "vote_material_downloaded", "vote", req.params.id as string, { filename: doc.filename, docId });
  const safeFilename = doc.filename.replace(/[^\w.\-]/g, "_");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
  res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
  fs.createReadStream(doc.filePath).pipe(res);
});

router.get("/votes/:id/certificate", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const [vote] = await db.select().from(votesTable).where(eq(votesTable.id, id));
  if (!vote) {
    res.status(404).json({ error: "Vote not found" });
    return;
  }

  if (!await hasAccess(user.id, user.role, "vote", id)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const [board] = vote.boardId
    ? await db.select().from(boardsTable).where(eq(boardsTable.id, vote.boardId))
    : [null];

  const records = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, id));
  const recordsWithPeople = await Promise.all(
    records.map(async (r) => {
      const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, r.personId!));
      const { passwordHash: _, ...safePerson } = person || { passwordHash: "" };
      const [castByPerson] = r.castBy
        ? await db.select().from(peopleTable).where(eq(peopleTable.id, r.castBy))
        : [null];
      return { ...r, person: safePerson, castByName: castByPerson?.name ?? null };
    })
  );

  // Proxy relationships on the certificate — disclosed for OPEN (non-secret)
  // ballots only. On a secret ballot the certificate already withholds the
  // individual records from non-admins; the proxy list is withheld with them
  // so the certificate never says more than the ballot rules allow.
  const showIndividualData = !vote.secret || user.role === "admin";
  const proxies = showIndividualData
    ? await db.select().from(voteProxiesTable).where(eq(voteProxiesTable.voteId, id))
    : [];
  const proxyPersonIds = [...new Set(proxies.flatMap((p) => [p.principalId, p.holderId]))];
  const proxyPeople = proxyPersonIds.length
    ? await db.select().from(peopleTable).where(inArray(peopleTable.id, proxyPersonIds))
    : [];
  const proxiesWithNames = proxies.map((p) => ({
    ...p,
    principalName: proxyPeople.find((q) => q.id === p.principalId)?.name ?? null,
    holderName: proxyPeople.find((q) => q.id === p.holderId)?.name ?? null,
    used: records.some((r) => r.personId === p.principalId && r.castBy === p.holderId),
  }));

  const [approvalRule] = await db
    .select()
    .from(approvalRulesTable)
    .where(eq(approvalRulesTable.voteId, id));
  const ruleRecusals = approvalRule
    ? await db.select().from(approvalRuleRecusalsTable).where(eq(approvalRuleRecusalsTable.ruleId, approvalRule.id))
    : [];
  const members = vote.boardId
    ? await db.select().from(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, vote.boardId))
    : [];

  res.json({
    voteId: vote.id,
    resolutionNumber: vote.resolutionNumber,
    title: vote.title,
    resolutionText: vote.resolutionText,
    status: vote.status,
    secret: vote.secret,
    boardName: board?.name || "Unknown Board",
    closedAt: vote.closedAt,
    deadline: vote.deadline,
    hash: vote.certificateHash,
    // Weighted totals (safe under secret ballots — aggregates only, same
    // disclosure level as the existing head counts).
    ...weightedFields(members, records, new Set(ruleRecusals.map((r) => r.personId))),
    approvalRule: approvalRule ? {
      ...approvalRule,
      summaryText: buildApprovalSummary({
        type: approvalRule.type,
        minApprovals: approvalRule.minApprovals,
        quorum: approvalRule.quorum,
        weighted: approvalRule.weighted || false,
        deadlineBehavior: approvalRule.deadlineBehavior || "lapse",
      }),
    } : null,
    voteRecords: showIndividualData ? recordsWithPeople : [],
    proxies: proxiesWithNames,
  });
});

// Recompute the certificate hash from persisted data and compare it to the
// stored hash — proves the vote record hasn't been altered since it closed.
router.get("/votes/:id/certificate/verify", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const [vote] = await db.select().from(votesTable).where(eq(votesTable.id, id));
  if (!vote) {
    res.status(404).json({ error: "Vote not found" });
    return;
  }
  if (!await hasAccess(user.id, user.role, "vote", id)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }
  if (!vote.certificateHash || !vote.closedAt) {
    res.json({ verified: false, reason: "not_finalized" });
    return;
  }
  const closedAt = vote.closedAt;

  const records = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, id));
  const recomputed = computeCertificateHash(id, vote.status ?? "", closedAt, records);
  if (recomputed === vote.certificateHash) {
    res.json({ verified: true, storedHash: vote.certificateHash, recomputedHash: recomputed, hashVersion: 2 });
    return;
  }
  // Votes closed before weighted/proxy voting were hashed with the v1 format —
  // fall back so those certificates still verify against their stored hash.
  const legacy = computeLegacyCertificateHash(id, vote.status ?? "", closedAt, records);
  res.json({
    verified: legacy === vote.certificateHash,
    storedHash: vote.certificateHash,
    recomputedHash: legacy === vote.certificateHash ? legacy : recomputed,
    hashVersion: legacy === vote.certificateHash ? 1 : null,
  });
});

export default router;
