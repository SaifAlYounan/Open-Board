import { Router } from "express";
import crypto from "crypto";
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
  voteDocumentsTable,
  workflowStagesTable,
  approvalWorkflowsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { sanitizeText } from "../lib/sanitize";
import { pick } from "../lib/pick";
import { parsePagination } from "../lib/pagination";
import { grantDefaultAccess, hasAccess } from "../lib/access";
import { audit } from "../lib/auditLog";
import { triggerWorkflowNextStage } from "../lib/workflowTrigger";
import { logger } from "../lib/logger";
import { writeLimiter } from "../lib/rateLimiters";

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

function evaluateByRule(
  rule: { type: string; minApprovals: number | null; quorum: number | null } | null,
  approvals: number,
  totalVoters: number
): "approved" | "rejected" {
  if (!rule) return approvals > totalVoters / 2 ? "approved" : "rejected";
  switch (rule.type) {
    case "unanimous":      return approvals === totalVoters ? "approved" : "rejected";
    case "two_thirds":     return approvals >= Math.ceil(totalVoters * 2 / 3) ? "approved" : "rejected";
    case "three_quarters": return approvals >= Math.ceil(totalVoters * 3 / 4) ? "approved" : "rejected";
    case "custom":         return rule.minApprovals ? (approvals >= rule.minApprovals ? "approved" : "rejected") : (approvals > totalVoters / 2 ? "approved" : "rejected");
    default:               return approvals > totalVoters / 2 ? "approved" : "rejected";
  }
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
  const quorumNote = rule.quorum ? `, quorum: ${rule.quorum}` : "";
  const behaviorNote = behaviors[rule.deadlineBehavior] || rule.deadlineBehavior;
  return `${desc}${quorumNote}. Vote ${behaviorNote}.`;
}

router.get("/votes", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { boardId, status } = req.query;
  const { limit, offset } = parsePagination(req.query);

  let votes = await db.select().from(votesTable).orderBy(votesTable.createdAt);

  if (boardId) votes = votes.filter((v) => v.boardId === boardId);
  if (status) votes = votes.filter((v) => v.status === status);

  if (user.role !== "admin") {
    const accessible = await db
      .select()
      .from(accessControlTable)
      .where(
        and(
          eq(accessControlTable.entityType, "vote"),
          eq(accessControlTable.personId, user.id),
          eq(accessControlTable.hasAccess, true)
        )
      );
    const accessibleIds = new Set(accessible.map((a) => a.entityId));
    votes = votes.filter((v) => accessibleIds.has(v.id));
  }

  votes = votes.slice(offset, offset + limit);

  const allStages = await db.select().from(workflowStagesTable);
  const allWorkflows = await db.select().from(approvalWorkflowsTable);
  const stageByVoteId = new Map(allStages.filter((s) => s.voteId).map((s) => [s.voteId!, s]));
  const workflowById = new Map(allWorkflows.map((w) => [w.id, w]));

  const result = await Promise.all(
    votes.map(async (v) => {
      const [board] = v.boardId
        ? await db.select().from(boardsTable).where(eq(boardsTable.id, v.boardId))
        : [null];

      const records = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, v.id));
      const approvals = records.filter((r) => r.decision.startsWith("approved")).length;

      const members = v.boardId
        ? await db.select().from(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, v.boardId))
        : [];

      const myRecord = records.find((r) => r.personId === user.id);

      const docs = await db.select().from(voteDocumentsTable).where(eq(voteDocumentsTable.voteId, v.id));

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
        totalVoters: members.length,
        votescast: records.length,
        approvalsCount: approvals,
        hasVoted: !!myRecord,
        documentCount: docs.length,
        workflowStage,
      };
    })
  );

  res.json(result);
});

const VALID_VOTE_STATUSES = ["open", "approved", "rejected", "lapsed", "cancelled"];

router.post("/votes", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const { boardId, meetingId, resolutionNumber: rawResolutionNumber, title, resolutionText, type, deadline, approvalRule, secret } = pick(req.body, ["boardId", "meetingId", "resolutionNumber", "title", "resolutionText", "type", "deadline", "approvalRule", "secret"] as (keyof typeof req.body)[]) as { boardId?: string; meetingId?: string; resolutionNumber?: string; title?: string; resolutionText?: string; type?: string; deadline?: string; approvalRule?: unknown; secret?: boolean };
  if (!boardId || !title || !resolutionText || !type) {
    res.status(400).json({ error: "Required: boardId, title, resolutionText, type" });
    return;
  }

  const VALID_VOTE_TYPES = ["circulation", "meeting", "simple", "resolution", "election", "special"];
  if (!VALID_VOTE_TYPES.includes(type)) {
    res.status(400).json({ error: `Invalid vote type. Must be one of: ${VALID_VOTE_TYPES.join(", ")}` });
    return;
  }

  const cleanTitle = sanitizeText(title);
  const cleanResolutionText = sanitizeText(resolutionText);

  // Generate resolution number server-side if not provided
  let resolutionNumber = rawResolutionNumber;
  if (!resolutionNumber) {
    const [board] = await db.select().from(boardsTable).where(eq(boardsTable.id, boardId));
    const abbrev = board?.abbreviation || "GEN";
    const year = new Date().getFullYear();
    const existing = await db.select().from(votesTable).where(eq(votesTable.boardId, boardId));
    const count = existing.length + 1;
    resolutionNumber = `RES-${abbrev}-${year}-${String(count).padStart(3, "0")}`;
  }

  const [vote] = await db
    .insert(votesTable)
    .values({
      boardId,
      meetingId,
      resolutionNumber,
      title: cleanTitle,
      resolutionText: cleanResolutionText,
      type,
      deadline: deadline ? new Date(deadline) : null,
      secret: secret === true,
    })
    .returning();

  if (approvalRule) {
    const [rule] = await db
      .insert(approvalRulesTable)
      .values({
        voteId: vote.id,
        type: approvalRule.type || "majority",
        minApprovals: approvalRule.minApprovals,
        quorum: approvalRule.quorum,
        weighted: approvalRule.weighted || false,
        deadlineBehavior: approvalRule.deadlineBehavior || "lapse",
      })
      .returning();

    if (approvalRule.requiredVoterIds?.length) {
      await db.insert(approvalRuleRequiredVotersTable).values(
        approvalRule.requiredVoterIds.map((pid: string) => ({ ruleId: rule.id, personId: pid }))
      );
    }
    if (approvalRule.recusedIds?.length) {
      await db.insert(approvalRuleRecusalsTable).values(
        approvalRule.recusedIds.map((pid: string) => ({ ruleId: rule.id, personId: pid }))
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
  res.status(201).json({
    ...vote,
    boardName: board?.name || null,
    boardAbbreviation: board?.abbreviation || null,
    totalVoters: members.length,
    votescast: 0,
    approvalsCount: 0,
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

  const voteRecordsWithPeople = await Promise.all(
    records.map(async (r) => {
      const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, r.personId!));
      const { passwordHash: _, ...safePerson } = person || { passwordHash: "" };
      return { ...r, person: safePerson };
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
    voteRecords: vote.secret && user.role !== "admin"
      ? voteRecordsWithPeople.filter((r) => r.personId === user.id)
      : voteRecordsWithPeople,
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
  const updates: Record<string, unknown> = {};
  if (title != null) updates.title = sanitizeText(title);
  if (resolutionText != null) updates.resolutionText = sanitizeText(resolutionText);
  if (deadline != null) updates.deadline = new Date(deadline);
  if (secret != null) updates.secret = secret;
  if (status != null) {
    updates.status = status;
    if (["approved", "rejected", "lapsed", "cancelled"].includes(status)) {
      updates.closedAt = new Date();
      // Only generate certificate hash for finalized (non-cancelled) statuses
      if (["approved", "rejected", "lapsed"].includes(status)) {
        const records = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, id));
        const approvals = records.filter((r) => r.decision.startsWith("approved")).length;
        const hash = crypto
          .createHash("sha256")
          .update(JSON.stringify({ id, status, approvals, total: records.length, closedAt: new Date().toISOString() }))
          .digest("hex");
        updates.certificateHash = hash;
      }
    }
  }

  const [vote] = await db.update(votesTable).set(updates).where(eq(votesTable.id, id)).returning();
  if (!vote) {
    res.status(404).json({ error: "Vote not found" });
    return;
  }

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
  res.sendStatus(204);
});

router.post("/votes/:id/cast", requireAuth, writeLimiter, async (req, res): Promise<void> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const user = req.user!;
    const { decision, comment } = req.body;

    if (!decision) {
      res.status(400).json({ error: "decision required" });
      return;
    }

    const [vote] = await db.select().from(votesTable).where(eq(votesTable.id, id));
    if (!vote || vote.status !== "open") {
      res.status(400).json({ error: "Vote is not open" });
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

    if (vote.boardId) {
      const membership = await db
        .select()
        .from(boardMembershipsTable)
        .where(and(eq(boardMembershipsTable.boardId, vote.boardId), eq(boardMembershipsTable.personId, user.id)));
      const role = membership[0]?.roleInBoard;
      if (!membership.length || role === "observer" || role === "secretary") {
        res.status(403).json({ error: "You are not an eligible voter for this resolution" });
        return;
      }
    }

    const sanitizedComment = comment ? sanitizeText(comment) : null;
    const [record] = await db
      .insert(voteRecordsTable)
      .values({ voteId: id, personId: user.id, decision, comment: sanitizedComment })
      .returning();

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

      const votingMembers = eligibleMembers.filter((m) => !recusedIds.has(m.personId!));
      const allRecords = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, id));
      const validRecords = allRecords.filter((r) => !recusedIds.has(r.personId!));

      if (validRecords.length >= votingMembers.length && votingMembers.length > 0) {
        const approvals = validRecords.filter((r) => r.decision.startsWith("approved")).length;

        let newStatus: "approved" | "rejected";
        if (requiredIds.length > 0) {
          const allRequiredApproved = requiredIds.every((pid) =>
            validRecords.some((r) => r.personId === pid && r.decision.startsWith("approved"))
          );
          newStatus = allRequiredApproved ? evaluateByRule(rule, approvals, votingMembers.length) : "rejected";
        } else {
          newStatus = evaluateByRule(rule, approvals, votingMembers.length);
        }

        const hash = crypto
          .createHash("sha256")
          .update(JSON.stringify({ id, status: newStatus, approvals, total: validRecords.length, closedAt: new Date().toISOString() }))
          .digest("hex");
        await db
          .update(votesTable)
          .set({ status: newStatus as any, closedAt: new Date(), certificateHash: hash })
          .where(eq(votesTable.id, id));
        setImmediate(() => triggerWorkflowNextStage(id, newStatus).catch((err) => logger.error({ err, voteId: id }, "Workflow trigger failed")));
      }
    }

    const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, user.id));
    const { passwordHash: _, ...safePerson } = person;
    audit(req, "vote_cast", "vote", id, { decision, voteTitle: vote.title });
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
  if (!doc || !doc.filePath || !fs.existsSync(doc.filePath)) {
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
      return { ...r, person: safePerson };
    })
  );

  const [approvalRule] = await db
    .select()
    .from(approvalRulesTable)
    .where(eq(approvalRulesTable.voteId, id));

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
    voteRecords: vote.secret && req.user?.role !== "admin"
      ? []
      : recordsWithPeople,
  });
});

export default router;
