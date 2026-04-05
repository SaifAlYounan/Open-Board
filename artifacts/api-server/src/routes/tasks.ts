import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  db,
  tasksTable,
  taskEvidenceTable,
  peopleTable,
  meetingsTable,
  accessControlTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { callAI, REVIEW_PROMPT } from "../lib/ai";
import { grantDefaultAccess } from "../lib/access";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();

let taskSequence = 1;
async function getNextTaskNumber(): Promise<string> {
  const tasks = await db.select().from(tasksTable).orderBy(tasksTable.createdAt);
  const year = new Date().getFullYear();
  const seq = (tasks.length + 1).toString().padStart(3, "0");
  return `TASK-${year}-${seq}`;
}

router.get("/tasks", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { boardId, assigneeId, status } = req.query;

  let tasks = await db.select().from(tasksTable).orderBy(tasksTable.createdAt);

  if (boardId) tasks = tasks.filter((t) => t.boardId === boardId);
  if (assigneeId) tasks = tasks.filter((t) => t.assigneeId === assigneeId);
  if (status) tasks = tasks.filter((t) => t.status === status);

  if (user.role !== "admin" && user.role !== "management") {
    const accessible = await db
      .select()
      .from(accessControlTable)
      .where(
        and(
          eq(accessControlTable.entityType, "task"),
          eq(accessControlTable.personId, user.id),
          eq(accessControlTable.hasAccess, true)
        )
      );
    const accessibleIds = new Set(accessible.map((a) => a.entityId));
    tasks = tasks.filter((t) => accessibleIds.has(t.id));
  }

  if (user.role === "management") {
    tasks = tasks.filter((t) => t.assigneeId === user.id);
  }

  const result = await Promise.all(
    tasks.map(async (t) => {
      const assignee = t.assigneeId
        ? await db.select().from(peopleTable).where(eq(peopleTable.id, t.assigneeId))
        : [];
      const meeting = t.sourceMeetingId
        ? await db.select().from(meetingsTable).where(eq(meetingsTable.id, t.sourceMeetingId))
        : [];
      const { passwordHash: _, ...safeAssignee } = assignee[0] || { passwordHash: "", id: "", email: "", name: "", role: "management" as const, createdAt: new Date() };
      return {
        ...t,
        assignee: assignee[0] ? safeAssignee : null,
        sourceMeetingTitle: meeting[0]?.title || null,
      };
    })
  );

  res.json(result);
});

router.post("/tasks", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { boardId, title, description, assigneeId, sourceMeetingId, sourceMinutesId, dueDate, sourceParagraph } = req.body;
  if (!title) {
    res.status(400).json({ error: "title required" });
    return;
  }

  const taskNumber = await getNextTaskNumber();

  const [task] = await db
    .insert(tasksTable)
    .values({
      boardId,
      title,
      description,
      assigneeId,
      sourceMeetingId,
      sourceMinutesId,
      dueDate,
      sourceParagraph,
      taskNumber,
    })
    .returning();

  // Grant access to assignee + admins
  const additionalIds = assigneeId ? [assigneeId] : [];
  await grantDefaultAccess("task", task.id, boardId, additionalIds);

  const assignee = assigneeId
    ? await db.select().from(peopleTable).where(eq(peopleTable.id, assigneeId))
    : [];
  const { passwordHash: _, ...safeAssignee } = assignee[0] || { passwordHash: "", id: "", email: "", name: "", role: "management" as const, createdAt: new Date() };

  res.status(201).json({
    ...task,
    assignee: assignee[0] ? safeAssignee : null,
    sourceMeetingTitle: null,
  });
});

router.get("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const assignee = task.assigneeId
    ? await db.select().from(peopleTable).where(eq(peopleTable.id, task.assigneeId))
    : [];
  const meeting = task.sourceMeetingId
    ? await db.select().from(meetingsTable).where(eq(meetingsTable.id, task.sourceMeetingId))
    : [];

  const evidence = await db.select().from(taskEvidenceTable).where(eq(taskEvidenceTable.taskId, id));
  const evidenceWithPeople = await Promise.all(
    evidence.map(async (e) => {
      const submitter = e.submittedBy
        ? await db.select().from(peopleTable).where(eq(peopleTable.id, e.submittedBy))
        : [];
      const { passwordHash: _, ...safeSubmitter } = submitter[0] || { passwordHash: "", id: "", email: "", name: "", role: "management" as const, createdAt: new Date() };
      return { ...e, submitter: submitter[0] ? safeSubmitter : null };
    })
  );

  const { passwordHash: _, ...safeAssignee } = assignee[0] || { passwordHash: "", id: "", email: "", name: "", role: "management" as const, createdAt: new Date() };

  res.json({
    ...task,
    assignee: assignee[0] ? safeAssignee : null,
    sourceMeetingTitle: meeting[0]?.title || null,
    evidence: evidenceWithPeople,
  });
});

router.patch("/tasks/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { title, description, assigneeId, status, dueDate } = req.body;
  const updates: Record<string, unknown> = {};
  if (title != null) updates.title = title;
  if (description != null) updates.description = description;
  if (assigneeId != null) updates.assigneeId = assigneeId;
  if (status != null) updates.status = status;
  if (dueDate != null) updates.dueDate = dueDate;

  const [task] = await db.update(tasksTable).set(updates).where(eq(tasksTable.id, id)).returning();
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const assignee = task.assigneeId
    ? await db.select().from(peopleTable).where(eq(peopleTable.id, task.assigneeId))
    : [];
  const { passwordHash: _, ...safeAssignee } = assignee[0] || { passwordHash: "", id: "", email: "", name: "", role: "management" as const, createdAt: new Date() };

  res.json({ ...task, assignee: assignee[0] ? safeAssignee : null, sourceMeetingTitle: null });
});

router.delete("/tasks/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  res.sendStatus(204);
});

// Evidence upload
router.post("/tasks/:id/evidence", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
  const taskId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const { originalname, path: filePath, size } = req.file;

  // Get task for AI review context
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  // Create evidence record
  const [evidence] = await db
    .insert(taskEvidenceTable)
    .values({
      taskId,
      submittedBy: user.id,
      filePath,
      fileName: originalname,
      fileSize: size,
      aiVerdict: "pending",
      secretaryDecision: "pending",
    })
    .returning();

  // Update task status
  await db.update(tasksTable).set({ status: "evidence_submitted" }).where(eq(tasksTable.id, taskId));

  // AI Review (async)
  if (process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY) {
    try {
      let evidenceText = "";
      try {
        evidenceText = fs.readFileSync(filePath, "utf-8").slice(0, 8000);
      } catch {
        evidenceText = `[File: ${originalname}, Size: ${size} bytes]`;
      }

      const reviewContent = `TASK_DETAILS:
Task: ${task.title}
Description: ${task.description || "N/A"}
Source from minutes: ${task.sourceParagraph || "N/A"}
Due date: ${task.dueDate || "N/A"}

EVIDENCE:
${evidenceText}`;

      const result = await callAI("REVIEW", REVIEW_PROMPT, reviewContent);
      if (result.success && result.data) {
        const verdict = result.data as { verdict: string; reasoning: string; missing: string[] };
        await db
          .update(taskEvidenceTable)
          .set({
            aiVerdict: verdict.verdict as any,
            aiReasoning: verdict.reasoning,
            aiMissing: verdict.missing as any,
          })
          .where(eq(taskEvidenceTable.id, evidence.id));

        if (verdict.verdict === "approved") {
          await db.update(tasksTable).set({ status: "pending_review" }).where(eq(tasksTable.id, taskId));
        }
      }
    } catch {
      // Evidence stored, AI review skipped
    }
  }

  const [updatedEvidence] = await db.select().from(taskEvidenceTable).where(eq(taskEvidenceTable.id, evidence.id));
  const { passwordHash: _, ...safePerson } = user;
  res.json({ ...updatedEvidence, submitter: safePerson });
});

router.post("/tasks/:id/evidence/review", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const taskId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { evidenceId, decision, comment } = req.body;
  if (!evidenceId || !decision) {
    res.status(400).json({ error: "evidenceId and decision required" });
    return;
  }

  const [evidence] = await db
    .update(taskEvidenceTable)
    .set({ secretaryDecision: decision, secretaryComment: comment, reviewedAt: new Date() })
    .where(eq(taskEvidenceTable.id, evidenceId))
    .returning();

  if (!evidence) {
    res.status(404).json({ error: "Evidence not found" });
    return;
  }

  // Close task if confirmed
  if (decision === "confirmed") {
    await db.update(tasksTable).set({ status: "done" }).where(eq(tasksTable.id, taskId));
  } else {
    await db.update(tasksTable).set({ status: "in_progress" }).where(eq(tasksTable.id, taskId));
  }

  const submitter = evidence.submittedBy
    ? await db.select().from(peopleTable).where(eq(peopleTable.id, evidence.submittedBy))
    : [];
  const { passwordHash: _, ...safeSubmitter } = submitter[0] || { passwordHash: "", id: "", email: "", name: "", role: "management" as const, createdAt: new Date() };

  res.json({ ...evidence, submitter: submitter[0] ? safeSubmitter : null });
});

export default router;
