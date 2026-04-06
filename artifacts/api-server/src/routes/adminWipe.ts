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
  votesTable,
  voteDocumentsTable,
  taskEvidenceTable,
  tasksTable,
  meetingsTable,
  documentsTable,
} from "@workspace/db";

const router = Router();
const WIPE_SECRET = "clear-demo-data-2026";

router.post("/admin/clear-demo", async (req, res): Promise<void> => {
  if (req.headers["x-admin-secret"] !== WIPE_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (fs.existsSync(uploadsDir)) {
      for (const f of fs.readdirSync(uploadsDir)) {
        fs.unlinkSync(path.join(uploadsDir, f));
      }
    }

    // Delete in FK-safe order (children before parents)
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

    res.json({ ok: true, message: "Demo data cleared. People, boards, and board memberships preserved." });
  } catch (err: any) {
    console.error("[admin/clear-demo]", err.message, err.cause?.message);
    res.status(500).json({ error: err.cause?.message || err.message });
  }
});

export default router;
