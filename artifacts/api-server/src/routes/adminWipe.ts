import { Router } from "express";
import path from "path";
import fs from "fs";
import {
  db,
  minutesSignaturesTable,
  minutesSuggestionsTable,
  minutesTable,
  agendaItemsTable,
  attendanceTable,
  pendingActionsTable,
  voteRecordsTable,
  approvalRuleWeightsTable,
  approvalRuleRecusalsTable,
  approvalRuleRequiredVotersTable,
  approvalRulesTable,
  votesTable,
  meetingsTable,
  documentsTable,
  tasksTable,
  taskEvidenceTable,
  voteDocumentsTable,
} from "@workspace/db";

const router = Router();
const WIPE_SECRET = "clear-demo-data-2026";

router.post("/admin/clear-demo", async (req, res): Promise<void> => {
  if (req.headers["x-admin-secret"] !== WIPE_SECRET) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  try {
    // Delete uploaded vote document files
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (fs.existsSync(uploadsDir)) {
      for (const f of fs.readdirSync(uploadsDir)) {
        fs.unlinkSync(path.join(uploadsDir, f));
      }
    }

    // Clear all demo data tables (preserve people, boards, board_memberships, organizations)
    await db.delete(minutesSignaturesTable);
    await db.delete(minutesSuggestionsTable);
    await db.delete(minutesTable);
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
    await db.delete(meetingsTable);
    await db.delete(documentsTable);
    await db.delete(taskEvidenceTable);
    await db.delete(tasksTable);

    res.json({ ok: true, message: "Demo data cleared. People, boards, and board memberships preserved." });
  } catch (err: any) {
    console.error("[admin/clear-demo]", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
