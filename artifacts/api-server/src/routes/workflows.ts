import { Router } from "express";
import {
  db,
  approvalWorkflowsTable,
  workflowStagesTable,
  votesTable,
  boardsTable,
  voteRecordsTable,
  boardMembershipsTable,
  peopleTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";

const MAX_PAGE_LIMIT = 200;

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param("id", (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid id format" });
    return;
  }
  next();
});

router.get("/workflows", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, MAX_PAGE_LIMIT);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

  const allWorkflows = await db
    .select()
    .from(approvalWorkflowsTable)
    .orderBy(approvalWorkflowsTable.createdAt);

  const workflows = allWorkflows.slice(offset, offset + limit);

  const result = await Promise.all(
    workflows.map(async (wf) => {
      const stages = await db
        .select()
        .from(workflowStagesTable)
        .where(eq(workflowStagesTable.workflowId, wf.id))
        .orderBy(workflowStagesTable.stageIndex);

      const stagesWithBoard = await Promise.all(
        stages.map(async (s) => {
          const [board] = s.boardId
            ? await db.select().from(boardsTable).where(eq(boardsTable.id, s.boardId))
            : [null];
          return { ...s, boardName: board?.name, boardAbbreviation: board?.abbreviation };
        })
      );

      return { ...wf, stages: stagesWithBoard };
    })
  );

  res.json(result);
});

router.get("/workflows/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const [workflow] = await db
    .select()
    .from(approvalWorkflowsTable)
    .where(eq(approvalWorkflowsTable.id, id));

  if (!workflow) {
    res.status(404).json({ error: "Workflow not found" });
    return;
  }

  const stages = await db
    .select()
    .from(workflowStagesTable)
    .where(eq(workflowStagesTable.workflowId, id))
    .orderBy(workflowStagesTable.stageIndex);

  const stagesDetailed = await Promise.all(
    stages.map(async (s) => {
      const [board] = s.boardId
        ? await db.select().from(boardsTable).where(eq(boardsTable.id, s.boardId))
        : [null];

      let vote = null;
      let voteStats = null;
      if (s.voteId) {
        const [v] = await db.select().from(votesTable).where(eq(votesTable.id, s.voteId));
        if (v) {
          const records = await db
            .select()
            .from(voteRecordsTable)
            .where(eq(voteRecordsTable.voteId, v.id));
          const members = v.boardId
            ? await db
                .select()
                .from(boardMembershipsTable)
                .where(
                  and(
                    eq(boardMembershipsTable.boardId, v.boardId),
                  )
                )
            : [];
          const eligible = members.filter(
            (m) => m.roleInBoard !== "observer" && m.roleInBoard !== "secretary"
          );
          const approvals = records.filter((r) => r.decision.startsWith("approved")).length;
          vote = v;
          voteStats = {
            totalVoters: eligible.length,
            votesCast: records.length,
            approvalsCount: approvals,
          };
        }
      }

      return {
        ...s,
        boardName: board?.name,
        boardAbbreviation: board?.abbreviation,
        vote,
        voteStats,
      };
    })
  );

  const [finalBoard] = workflow.boardId
    ? await db.select().from(boardsTable).where(eq(boardsTable.id, workflow.boardId))
    : [null];

  res.json({
    ...workflow,
    boardName: finalBoard?.name,
    stages: stagesDetailed,
  });
});

export default router;
