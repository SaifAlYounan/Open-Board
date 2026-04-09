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
import { eq, and, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { sanitizeText } from "../lib/sanitize";
import { parsePagination } from "../lib/pagination";
import { pick } from "../lib/pick";
import { callAI, REVIEW_PROMPT } from "../lib/ai";
import { grantDefaultAccess } from "../lib/access";
import { audit } from "../lib/auditLog";
import { logger } from "../lib/logger";
import { writeLimiter } from "../lib/rateLimiters";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({ dest: UPLOADS_DIR, limits: { fileSize: 10 * 1024 * 1024 } });

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const router = Router();

router.param("id", (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid id format" });
    return;
  }
  next();
});

async function getNextTaskNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const startOfYear = new Date(year, 0, 1).toISOString();
  const result = await db.execute(sql`SELECT COUNT(*)::int AS count FROM tasks WHERE created_at >= ${startOfYear}`);
  const rows = result.rows as { count: number }[];
  const seq = ((rows[0]?.count ?? 0) + 1).toString().padStart(3, "0");
  return `TASK-${year}-${seq}`;
}

router.get("/tasks", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;

  if (user.role === "member" || user.role === "observer") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const { boardId, assigneeId, status } = req.query;
  const { limit, offset } = parsePagination(req.query);

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

  tasks = tasks.slice(offset, offset + limit);

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

router.post("/tasks", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const { boardId, title, description, assigneeId, sourceMeetingId, sourceMinutesId, dueDate, sourceParagraph } = pick(req.body, ["boardId", "title", "description", "assigneeId", "sourceMeetingId", "sourceMinutesId", "dueDate", "sourceParagraph"] as (keyof typeof req.body)[]) as { boardId?: string; title?: string; description?: string; assigneeId?: string; sourceMeetingId?: string; sourceMinutesId?: string; dueDate?: string; sourceParagraph?: string };
  if (!title) {
    res.status(400).json({ error: "title required" });
    return;
  }

  const MAX_RETRIES = 3;
  let task: typeof tasksTable.$inferSelect | undefined;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const taskNumber = await getNextTaskNumber();
      const [inserted] = await db
        .insert(tasksTable)
        .values({
          boardId,
          title: sanitizeText(title),
          description: description ? sanitizeText(description) : undefined,
          assigneeId,
          sourceMeetingId,
          sourceMinutesId,
          dueDate,
          sourceParagraph: sourceParagraph ? sanitizeText(sourceParagraph) : undefined,
          taskNumber,
        })
        .returning();
      task = inserted;
      break;
    } catch (err: any) {
      if (attempt === MAX_RETRIES - 1 || !String(err?.message || "").includes("unique")) throw err;
    }
  }
  if (!task) { res.status(500).json({ error: "Failed to create task" }); return; }

  // Grant access to assignee + admins
  const additionalIds = assigneeId ? [assigneeId] : [];
  await grantDefaultAccess("task", task.id, boardId, additionalIds);

  const assignee = assigneeId
    ? await db.select().from(peopleTable).where(eq(peopleTable.id, assigneeId))
    : [];
  const { passwordHash: _, ...safeAssignee } = assignee[0] || { passwordHash: "", id: "", email: "", name: "", role: "management" as const, createdAt: new Date() };

  audit(req, "task_created", "task", task.id, { title: task.title, taskNumber: task.taskNumber });
  res.status(201).json({
    ...task,
    assignee: assignee[0] ? safeAssignee : null,
    sourceMeetingTitle: null,
  });
});

router.get("/tasks/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  if (user.role === "member" || user.role === "observer") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  if (user.role === "management" && task.assigneeId !== user.id) {
    res.status(403).json({ error: "Access denied" });
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

router.patch("/tasks/:id", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { title, description, assigneeId, status, dueDate } = pick(req.body, ["title", "description", "assigneeId", "status", "dueDate"] as (keyof typeof req.body)[]) as { title?: string; description?: string; assigneeId?: string; status?: string; dueDate?: string };
  const VALID_TASK_STATUSES = ["todo", "in_progress", "done", "blocked"];
  if (status != null && !VALID_TASK_STATUSES.includes(status)) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_TASK_STATUSES.join(", ")}` });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (title != null) updates.title = sanitizeText(title);
  if (description != null) updates.description = sanitizeText(description);
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

  audit(req, "task_updated", "task", id, { status: task.status });
  res.json({ ...task, assignee: assignee[0] ? safeAssignee : null, sourceMeetingTitle: null });
});

router.delete("/tasks/:id", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  audit(req, "task_deleted", "task", id, { title: task?.title });
  res.sendStatus(204);
});

// Evidence upload
router.post("/tasks/:id/evidence", requireAuth, writeLimiter, upload.single("file"), async (req, res): Promise<void> => {
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
  audit(req, "task_evidence_uploaded", "task", taskId, { filename: originalname, taskTitle: task.title });

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
    } catch (err: any) {
      logger.warn({ err: err?.message }, "[ai] evidence review failed — evidence already stored");
    }
  }

  const [updatedEvidence] = await db.select().from(taskEvidenceTable).where(eq(taskEvidenceTable.id, evidence.id));
  const { passwordHash: _, ...safePerson } = user;
  res.json({ ...updatedEvidence, submitter: safePerson });
});

router.post("/tasks/:id/evidence/review", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const taskId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { evidenceId, decision, comment } = req.body;
  if (!evidenceId || !decision) {
    res.status(400).json({ error: "evidenceId and decision required" });
    return;
  }

  const VALID_DECISIONS = ["confirmed", "rejected"];
  if (!VALID_DECISIONS.includes(decision)) {
    res.status(400).json({ error: `Invalid decision. Must be one of: ${VALID_DECISIONS.join(", ")}` });
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
