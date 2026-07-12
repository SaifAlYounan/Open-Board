import {
  db,
  votesTable,
  boardsTable,
  boardMembershipsTable,
  approvalWorkflowsTable,
  workflowStagesTable,
  accessControlTable,
  approvalRulesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { grantDefaultAccess } from "./access";
import { nextResolutionNumber } from "./numbering";

/**
 * Called after a vote status changes to "approved" or "rejected".
 *
 * Parallel-group logic:
 *  - Stages share a stageGroup (integer). All stages in the same group run in parallel.
 *  - When every stage in a group is approved → activate all stages in the next group.
 *  - When any stage is rejected → cancel the rest and close the workflow.
 */
export async function triggerWorkflowNextStage(voteId: string, newStatus: string): Promise<void> {
  if (newStatus !== "approved" && newStatus !== "rejected") return;

  const [stage] = await db
    .select()
    .from(workflowStagesTable)
    .where(and(eq(workflowStagesTable.voteId, voteId), eq(workflowStagesTable.status, "active")));

  if (!stage) return;

  if (newStatus === "rejected") {
    await db
      .update(workflowStagesTable)
      .set({ status: "rejected", completedAt: new Date() })
      .where(eq(workflowStagesTable.id, stage.id));

    const allStages = await db
      .select()
      .from(workflowStagesTable)
      .where(eq(workflowStagesTable.workflowId, stage.workflowId));

    const cancelIds = allStages
      .filter((s) => s.id !== stage.id && s.status === "pending")
      .map((s) => s.id);

    for (const sid of cancelIds) {
      await db
        .update(workflowStagesTable)
        .set({ status: "cancelled" })
        .where(eq(workflowStagesTable.id, sid));
    }

    await db
      .update(approvalWorkflowsTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(approvalWorkflowsTable.id, stage.workflowId));

    return;
  }

  // approved
  await db
    .update(workflowStagesTable)
    .set({ status: "approved", completedAt: new Date() })
    .where(eq(workflowStagesTable.id, stage.id));

  const allStages = await db
    .select()
    .from(workflowStagesTable)
    .where(eq(workflowStagesTable.workflowId, stage.workflowId));

  const currentGroupStages = allStages.filter((s) => s.stageGroup === stage.stageGroup);
  const updatedCurrentGroup = currentGroupStages.map((s) =>
    s.id === stage.id ? { ...s, status: "approved" } : s
  );
  const allGroupApproved = updatedCurrentGroup.every((s) => s.status === "approved");

  if (!allGroupApproved) {
    await db
      .update(approvalWorkflowsTable)
      .set({ updatedAt: new Date() })
      .where(eq(approvalWorkflowsTable.id, stage.workflowId));
    return;
  }

  const nextGroupIndex = stage.stageGroup + 1;
  const nextGroupStages = allStages.filter((s) => s.stageGroup === nextGroupIndex);

  if (nextGroupStages.length === 0) {
    await db
      .update(approvalWorkflowsTable)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(approvalWorkflowsTable.id, stage.workflowId));
    return;
  }

  const [workflow] = await db
    .select()
    .from(approvalWorkflowsTable)
    .where(eq(approvalWorkflowsTable.id, stage.workflowId));

  for (const nextStage of nextGroupStages) {
    const abbrev = nextStage.boardId
      ? (await db.select().from(boardsTable).where(eq(boardsTable.id, nextStage.boardId)))[0]?.abbreviation || "GEN"
      : "GEN";

    const resNum = await nextResolutionNumber(db, abbrev);

    const [newVote] = await db
      .insert(votesTable)
      .values({
        boardId: nextStage.boardId,
        resolutionNumber: resNum,
        title: `${nextStage.title} — ${workflow?.title || "Approval Workflow"}`,
        resolutionText: nextStage.description || workflow?.description || "To be determined",
        type: "circulation",
        deadline: null,
      })
      .returning();

    // The stage's promised approval type becomes the vote's actual rule — it
    // was stored and displayed but never applied, so every stage vote silently
    // evaluated as simple majority (dead-config class, external-review item 4;
    // caught by scripts/check-dead-config.mjs).
    await db.insert(approvalRulesTable).values({
      voteId: newVote.id,
      type: (nextStage.approvalType as "unanimous" | "majority" | "two_thirds" | "three_quarters" | "custom") ?? "majority",
    });

    if (nextStage.boardId) {
      await grantDefaultAccess("vote", newVote.id, nextStage.boardId);
    }

    await db
      .update(workflowStagesTable)
      .set({ voteId: newVote.id, status: "active" })
      .where(eq(workflowStagesTable.id, nextStage.id));
  }

  await db
    .update(approvalWorkflowsTable)
    .set({ updatedAt: new Date() })
    .where(eq(approvalWorkflowsTable.id, stage.workflowId));
}
