import {
  db,
  votesTable,
  boardsTable,
  boardMembershipsTable,
  approvalWorkflowsTable,
  workflowStagesTable,
  accessControlTable,
} from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { grantDefaultAccess } from "./access";

/**
 * Called after a vote status changes to "approved" or "rejected".
 * If the vote belongs to a workflow stage, advances or closes the workflow accordingly.
 */
export async function triggerWorkflowNextStage(voteId: string, newStatus: string): Promise<void> {
  if (newStatus !== "approved" && newStatus !== "rejected") return;

  const [stage] = await db
    .select()
    .from(workflowStagesTable)
    .where(and(eq(workflowStagesTable.voteId, voteId), eq(workflowStagesTable.status, "active")));

  if (!stage) return;

  if (newStatus === "approved") {
    await db
      .update(workflowStagesTable)
      .set({ status: "approved", completedAt: new Date() })
      .where(eq(workflowStagesTable.id, stage.id));

    const [nextStage] = await db
      .select()
      .from(workflowStagesTable)
      .where(
        and(
          eq(workflowStagesTable.workflowId, stage.workflowId),
          eq(workflowStagesTable.stageIndex, stage.stageIndex + 1)
        )
      );

    if (nextStage) {
      const [workflow] = await db
        .select()
        .from(approvalWorkflowsTable)
        .where(eq(approvalWorkflowsTable.id, stage.workflowId));

      const abbrev = nextStage.boardId
        ? (await db.select().from(boardsTable).where(eq(boardsTable.id, nextStage.boardId)))[0]?.abbreviation || "GEN"
        : "GEN";

      const year = new Date().getFullYear();
      const allVotes = await db.select().from(votesTable);
      const seq = (allVotes.length + 1).toString().padStart(3, "0");
      const resNum = `RES-${abbrev}-${year}-${seq}`;

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

      if (nextStage.boardId) {
        await grantDefaultAccess("vote", newVote.id, nextStage.boardId);
      }

      await db
        .update(workflowStagesTable)
        .set({ voteId: newVote.id, status: "active" })
        .where(eq(workflowStagesTable.id, nextStage.id));

      await db
        .update(approvalWorkflowsTable)
        .set({ updatedAt: new Date() })
        .where(eq(approvalWorkflowsTable.id, stage.workflowId));
    } else {
      await db
        .update(approvalWorkflowsTable)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(approvalWorkflowsTable.id, stage.workflowId));
    }
  } else {
    await db
      .update(workflowStagesTable)
      .set({ status: "rejected", completedAt: new Date() })
      .where(eq(workflowStagesTable.id, stage.id));

    await db
      .update(workflowStagesTable)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(workflowStagesTable.workflowId, stage.workflowId),
          eq(workflowStagesTable.status, "pending")
        )
      );

    await db
      .update(approvalWorkflowsTable)
      .set({ status: "rejected", updatedAt: new Date() })
      .where(eq(approvalWorkflowsTable.id, stage.workflowId));
  }
}
