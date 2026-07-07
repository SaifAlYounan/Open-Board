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
  workflowStagesTable,
  approvalWorkflowsTable,
  taskEvidenceTable,
  tasksTable,
  meetingsTable,
  documentsTable,
  accessControlTable,
  boardsTable,
  boardMembershipsTable,
  auditTrailTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { peopleTable, organizationsTable } from "@workspace/db";
import { requireAuth, requireAdmin } from "../lib/auth";
import { audit } from "../lib/auditLog";
import { logger } from "../lib/logger";

const router = Router();

// Identity for the UI — replaces hardcoded "Meridian Energy Group" / version strings.
router.get("/organization", requireAuth, async (_req, res): Promise<void> => {
  const [org] = await db.select().from(organizationsTable).limit(1);
  res.json({
    name: org?.name || "Open Board",
    version: process.env.APP_VERSION || "3.0.0",
  });
});

// Full governance-data export — a board must be able to take its records with it.
// Admin-only; returns a single JSON bundle (people are included without password
// hashes). Downloaded as an attachment.
router.get("/system/export", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const [org] = await db.select().from(organizationsTable).limit(1);
  const people = (await db.select().from(peopleTable)).map(({ passwordHash: _p, ...rest }) => rest);

  const bundle = {
    exportedAt: new Date().toISOString(),
    schemaVersion: process.env.APP_VERSION || "3.0.0",
    organization: org ?? null,
    people,
    boards: await db.select().from(boardsTable),
    boardMemberships: await db.select().from(boardMembershipsTable),
    meetings: await db.select().from(meetingsTable),
    agendaItems: await db.select().from(agendaItemsTable),
    attendance: await db.select().from(attendanceTable),
    votes: await db.select().from(votesTable),
    voteRecords: await db.select().from(voteRecordsTable),
    approvalRules: await db.select().from(approvalRulesTable),
    minutes: await db.select().from(minutesTable),
    minutesSignatures: await db.select().from(minutesSignaturesTable),
    minutesComments: await db.select().from(minutesSuggestionsTable),
    tasks: await db.select().from(tasksTable),
    taskEvidence: await db.select().from(taskEvidenceTable),
    documents: await db.select().from(documentsTable),
    workflows: await db.select().from(approvalWorkflowsTable),
    workflowStages: await db.select().from(workflowStagesTable),
    auditTrail: await db.select().from(auditTrailTable),
  };

  await audit(req, "data_exported", undefined, undefined, { by: req.user?.email });
  const filename = `open-board-export-${new Date().toISOString().slice(0, 10)}.json`;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(JSON.stringify(bundle, null, 2));
});

router.post("/system/reset-data", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  if (req.body?.confirm !== "RESET") {
    res.status(400).json({ error: "Confirmation required. Send { confirm: 'RESET' } in the request body." });
    return;
  }
  // The admin must re-authenticate with their own password — verified server-side.
  const password = req.body?.password;
  if (!password || typeof password !== "string") {
    res.status(400).json({ error: "Your admin password is required to reset data." });
    return;
  }
  const [adminRow] = await db.select().from(peopleTable).where(eq(peopleTable.id, req.user!.id));
  if (!adminRow || !(await bcrypt.compare(password, adminRow.passwordHash))) {
    await audit(req, "data_reset_denied", undefined, undefined, { reason: "bad password" });
    res.status(403).json({ error: "Password incorrect." });
    return;
  }
  try {
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (fs.existsSync(uploadsDir)) {
      for (const f of fs.readdirSync(uploadsDir)) {
        fs.unlinkSync(path.join(uploadsDir, f));
      }
    }

    // Wrap all deletes in a transaction for atomicity
    await db.transaction(async (tx) => {
      // Delete in FK-safe order — children before parents
      await tx.delete(minutesSignaturesTable);
      await tx.delete(minutesSuggestionsTable);
      await tx.delete(minutesTable);
      await tx.delete(agendaDocumentsTable);
      await tx.delete(agendaItemsTable);
      await tx.delete(attendanceTable);
      await tx.delete(pendingActionsTable);
      await tx.delete(voteRecordsTable);
      await tx.delete(approvalRuleWeightsTable);
      await tx.delete(approvalRuleRecusalsTable);
      await tx.delete(approvalRuleRequiredVotersTable);
      await tx.delete(approvalRulesTable);
      await tx.delete(voteDocumentsTable);
      await tx.delete(workflowStagesTable);
      await tx.delete(approvalWorkflowsTable);
      await tx.delete(votesTable);
      await tx.delete(taskEvidenceTable);
      await tx.delete(tasksTable);
      await tx.delete(meetingsTable);
      await tx.delete(documentsTable);

      // Remove access control entries for transactional entities only
      await tx.delete(accessControlTable).where(eq(accessControlTable.entityType, "vote"));
      await tx.delete(accessControlTable).where(eq(accessControlTable.entityType, "meeting"));
      await tx.delete(accessControlTable).where(eq(accessControlTable.entityType, "minutes"));
      await tx.delete(accessControlTable).where(eq(accessControlTable.entityType, "task"));
      await tx.delete(accessControlTable).where(eq(accessControlTable.entityType, "document"));
    });

    await audit(req, "data_reset", undefined, undefined, { clearedBy: req.user?.email });
    res.json({
      ok: true,
      message: "All transactional data cleared. Company, people, and board rooms are preserved.",
    });
  } catch (err: any) {
    logger.error({ err }, "[system/reset-data] failed");
    res.status(500).json({ error: "Reset failed — see server logs" });
  }
});

export default router;
