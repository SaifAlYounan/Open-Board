import { Router } from "express";
import crypto from "crypto";
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
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { grantDefaultAccess } from "../lib/access";

const router = Router();

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
    notify: "notifies Secretary when deadline passes",
  };
  const behavior = behaviors[rule.deadlineBehavior] || rule.deadlineBehavior;

  switch (rule.type) {
    case "unanimous":
      return `This resolution passes when ALL eligible voters approve. ${behavior}.`;
    case "majority":
      return `This resolution passes when more than 50% of eligible voters approve. ${behavior}.`;
    case "two_thirds":
      return `This resolution passes when at least two-thirds (66.7%) of eligible voters approve. ${behavior}.`;
    case "three_quarters":
      return `This resolution passes when at least three-quarters (75%) of eligible voters approve. ${behavior}.`;
    case "custom":
      return `This resolution passes when at least ${rule.minApprovals || "?"} voters approve${rule.quorum ? `, with quorum of ${rule.quorum}` : ""}. ${behavior}.`;
    default:
      return `Approval by ${rule.type}. ${behavior}.`;
  }
}

router.get("/votes", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { boardId, status } = req.query;

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

      return {
        ...v,
        boardName: board?.name || null,
        boardAbbreviation: board?.abbreviation || null,
        totalVoters: members.length,
        votescast: records.length,
        approvalsCount: approvals,
        hasVoted: !!myRecord,
      };
    })
  );

  res.json(result);
});

router.post("/votes", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { boardId, meetingId, resolutionNumber, title, resolutionText, type, deadline, approvalRule } = req.body;
  if (!boardId || !resolutionNumber || !title || !resolutionText || !type) {
    res.status(400).json({ error: "Required: boardId, resolutionNumber, title, resolutionText, type" });
    return;
  }

  const [vote] = await db
    .insert(votesTable)
    .values({
      boardId,
      meetingId,
      resolutionNumber,
      title,
      resolutionText,
      type,
      deadline: deadline ? new Date(deadline) : null,
    })
    .returning();

  // Create approval rule
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

  // Grant access
  await grantDefaultAccess("vote", vote.id, boardId);

  const [board] = boardId
    ? await db.select().from(boardsTable).where(eq(boardsTable.id, boardId))
    : [null];

  const members = boardId
    ? await db.select().from(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, boardId))
    : [];

  res.status(201).json({
    ...vote,
    boardName: board?.name || null,
    boardAbbreviation: board?.abbreviation || null,
    totalVoters: members.length,
    votescast: 0,
    approvalsCount: 0,
    hasVoted: false,
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

  const [approvalRule] = await db
    .select()
    .from(approvalRulesTable)
    .where(eq(approvalRulesTable.voteId, id));

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
      }
    : null;

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
    voteRecords: voteRecordsWithPeople,
    approvalRule: ruleWithSummary,
    certificateHash: vote.certificateHash,
  });
});

router.patch("/votes/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { title, resolutionText, deadline, status } = req.body;
  const updates: Record<string, unknown> = {};
  if (title != null) updates.title = title;
  if (resolutionText != null) updates.resolutionText = resolutionText;
  if (deadline != null) updates.deadline = new Date(deadline);
  if (status != null) {
    updates.status = status;
    if (["approved", "rejected", "lapsed"].includes(status)) {
      updates.closedAt = new Date();
    }
  }

  const [vote] = await db.update(votesTable).set(updates).where(eq(votesTable.id, id)).returning();
  if (!vote) {
    res.status(404).json({ error: "Vote not found" });
    return;
  }

  const [board] = vote.boardId
    ? await db.select().from(boardsTable).where(eq(boardsTable.id, vote.boardId))
    : [null];

  res.json({ ...vote, boardName: board?.name, boardAbbreviation: board?.abbreviation, totalVoters: 0, votescast: 0, approvalsCount: 0, hasVoted: false });
});

router.delete("/votes/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  await db.delete(votesTable).where(eq(votesTable.id, id));
  res.sendStatus(204);
});

router.post("/votes/:id/cast", requireAuth, async (req, res): Promise<void> => {
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

  // Verify user is a voting member of this board (non-observer, non-secretary)
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

  try {
    const [record] = await db
      .insert(voteRecordsTable)
      .values({ voteId: id, personId: user.id, decision, comment })
      .returning();

    // Auto-resolve vote if all eligible voters have cast
    if (vote.boardId) {
      const allMembers = await db.select().from(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, vote.boardId));
      const votingMembers = allMembers.filter((m) => m.roleInBoard !== "observer" && m.roleInBoard !== "secretary");
      const allRecords = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, id));

      if (allRecords.length >= votingMembers.length && votingMembers.length > 0) {
        const approvals = allRecords.filter((r) => r.decision.startsWith("approved")).length;
        const threshold = Math.ceil(votingMembers.length / 2);
        const newStatus = approvals >= threshold ? "approved" : "rejected";
        await db.update(votesTable).set({ status: newStatus as any, closedAt: new Date() }).where(eq(votesTable.id, id));
      }
    }

    const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, user.id));
    const { passwordHash: _, ...safePerson } = person;
    res.json({ ...record, person: safePerson });
  } catch (err: unknown) {
    const anyErr = err as { code?: string; message?: string };
    if (anyErr.code === "23505") {
      res.status(409).json({ error: "You have already voted on this resolution" });
      return;
    }
    console.error("[votes] cast error:", anyErr.message);
    res.status(500).json({ error: "Failed to record vote" });
  }
});

router.get("/votes/:id/certificate", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [vote] = await db.select().from(votesTable).where(eq(votesTable.id, id));
  if (!vote) {
    res.status(404).json({ error: "Vote not found" });
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

  res.json({
    voteId: vote.id,
    resolutionNumber: vote.resolutionNumber,
    title: vote.title,
    status: vote.status,
    boardName: board?.name || "Unknown Board",
    closedAt: vote.closedAt,
    hash: vote.certificateHash,
    voteRecords: recordsWithPeople,
  });
});

export default router;
