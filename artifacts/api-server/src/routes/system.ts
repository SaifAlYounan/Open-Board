import { Router } from "express";
import path from "path";
import fs from "fs";
import {
  db,
  minutesSignaturesTable,
  minutesSuggestionsTable,
  minutesTable,
  agendaDocumentsTable,
  agendaItemsTable,
  attendanceTable,
  pendingActionsTable,
  voteRecordsTable,
  approvalRuleWeightsTable,
  approvalRuleRecusalsTable,
  approvalRuleRequiredVotersTable,
  approvalRulesTable,
  voteDocumentsTable,
  votesTable,
  taskEvidenceTable,
  tasksTable,
  meetingsTable,
  documentsTable,
  accessControlTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";

const router = Router();

router.post("/system/reset-data", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  try {
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (fs.existsSync(uploadsDir)) {
      for (const f of fs.readdirSync(uploadsDir)) {
        fs.unlinkSync(path.join(uploadsDir, f));
      }
    }

    // Delete in FK-safe order — children before parents
    await db.delete(minutesSignaturesTable);
    await db.delete(minutesSuggestionsTable);
    await db.delete(minutesTable);
    await db.delete(agendaDocumentsTable);
    await db.delete(agendaItemsTable);
    await db.delete(attendanceTable);
    await db.delete(pendingActionsTable);
    await db.delete(voteRecordsTable);
    await db.delete(approvalRuleWeightsTable);
    await db.delete(approvalRuleRecusalsTable);
    await db.delete(approvalRuleRequiredVotersTable);
    await db.delete(approvalRulesTable);
    await db.delete(voteDocumentsTable);
    await db.delete(votesTable);
    await db.delete(taskEvidenceTable);
    await db.delete(tasksTable);
    await db.delete(meetingsTable);
    await db.delete(documentsTable);

    // Remove access control entries for transactional entities only
    await db.delete(accessControlTable).where(eq(accessControlTable.entityType, "vote"));
    await db.delete(accessControlTable).where(eq(accessControlTable.entityType, "meeting"));
    await db.delete(accessControlTable).where(eq(accessControlTable.entityType, "minutes"));
    await db.delete(accessControlTable).where(eq(accessControlTable.entityType, "task"));
    await db.delete(accessControlTable).where(eq(accessControlTable.entityType, "document"));

    res.json({
      ok: true,
      message: "All transactional data cleared. Company, people, and board rooms are preserved.",
    });
  } catch (err: any) {
    console.error("[system/reset-data]", err.message, err.cause?.message);
    res.status(500).json({ error: err.cause?.message || err.message });
  }
});

export default router;
