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
import { eq, and, sql, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { sanitizeText } from "../lib/sanitize";
import { createTaskBody, updateTaskBody, parseBody } from "../lib/governanceSchemas";
import { parsePagination } from "../lib/pagination";
import { pick } from "../lib/pick";
import { callAI, REVIEW_PROMPT } from "../lib/ai";
import { extractText, UPLOADS_DIR } from "../lib/extractText";
import { grantDefaultAccess } from "../lib/access";
import { audit } from "../lib/auditLog";
import { retainDeleted } from "../lib/retention";
import { logger } from "../lib/logger";
import { writeLimiter } from "../lib/rateLimiters";
import { emitInvalidate } from "../lib/realtime";

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "text/plain"];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(file.mimetype) || [".pdf", ".docx", ".txt"].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, DOCX, and TXT files are allowed"));
    }
  },
});

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
  const result = await db.execute(sql`SELECT nextval('task_seq')::int AS seq`);
  const row = result.rows[0] as Record<string, unknown>;
  const seq = String(typeof row?.seq === "number" ? row.seq : 1).padStart(3, "0");
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

  const conds = [];
  if (typeof boardId === "string") conds.push(eq(tasksTable.boardId, boardId));
  if (typeof assigneeId === "string") conds.push(eq(tasksTable.assigneeId, assigneeId));
  if (typeof status === "string") conds.push(eq(tasksTable.status, status as never));

  if (user.role !== "admin" && user.role !== "management") {
    const accessible = await db
      .select({ id: accessControlTable.entityId })
      .from(accessControlTable)
      .where(
        and(
          eq(accessControlTable.entityType, "task"),
          eq(accessControlTable.personId, user.id),
          eq(accessControlTable.hasAccess, true)
        )
      );
    const ids = accessible.map((a) => a.id).filter((v): v is string => v != null);
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    conds.push(inArray(tasksTable.id, ids));
  }

  // Management only ever sees the tasks assigned to them.
  if (user.role === "management") conds.push(eq(tasksTable.assigneeId, user.id));

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(tasksTable.createdAt)
    .limit(limit)
    .offset(offset);

  // Batch assignees + source meetings (was two queries per task).
  const assigneeIds = [...new Set(tasks.map((t) => t.assigneeId).filter((v): v is string => v != null))];
  const meetingIds = [...new Set(tasks.map((t) => t.sourceMeetingId).filter((v): v is string => v != null))];
  const assignees = assigneeIds.length ? await db.select().from(peopleTable).where(inArray(peopleTable.id, assigneeIds)) : [];
  const meetings = meetingIds.length ? await db.select({ id: meetingsTable.id, title: meetingsTable.title }).from(meetingsTable).where(inArray(meetingsTable.id, meetingIds)) : [];
  const assigneeById = new Map(assignees.map(({ passwordHash: _p, ...safe }) => [safe.id, safe]));
  const meetingTitleById = new Map(meetings.map((m) => [m.id, m.title]));

  const result = tasks.map((t) => ({
    ...t,
    assignee: t.assigneeId ? assigneeById.get(t.assigneeId) ?? null : null,
    sourceMeetingTitle: t.sourceMeetingId ? meetingTitleById.get(t.sourceMeetingId) ?? null : null,
  }));

  res.json(result);
});

router.post("/tasks", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  // Shared contract with the AI-approval path (same size limits/types).
  const parsed = parseBody(createTaskBody, pick(req.body, ["boardId", "title", "description", "assigneeId", "sourceMeetingId", "sourceMinutesId", "dueDate", "sourceParagraph"] as (keyof typeof req.body)[]), res);
  if (!parsed) return;
  const { boardId, title, description, assigneeId, sourceMeetingId, sourceMinutesId, dueDate, sourceParagraph } = parsed;

  const taskNumber = await getNextTaskNumber();
  const [task] = await db
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
  if (!task) { res.status(500).json({ error: "Failed to create task" }); return; }

  // Grant access to assignee + admins
  const additionalIds = assigneeId ? [assigneeId] : [];
  await grantDefaultAccess("task", task.id, boardId, additionalIds);

  const assignee = assigneeId
    ? await db.select().from(peopleTable).where(eq(peopleTable.id, assigneeId))
    : [];
  const { passwordHash: _, ...safeAssignee } = assignee[0] || { passwordHash: "", id: "", email: "", name: "", role: "management" as const, createdAt: new Date() };

  audit(req, "task_created", "task", task.id, { title: task.title, taskNumber: task.taskNumber });
  emitInvalidate("tasks", { boardId: task.boardId, id: task.id, userIds: [task.assigneeId] });
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
  // Shared contract with the AI-approval path (same size limits, enum-checked status).
  const parsed = parseBody(updateTaskBody, pick(req.body, ["title", "description", "assigneeId", "status", "dueDate"] as (keyof typeof req.body)[]), res);
  if (!parsed) return;
  const { title, description, assigneeId, status, dueDate } = parsed;

  // State machine (issue #13): `cancelled` is terminal — a cancelled task is
  // immutable. A `done` task keeps its content immutable too; the only legal
  // move out of `done` is a pure reopen (status → todo/in_progress).
  const [current] = await db.select({ status: tasksTable.status }).from(tasksTable).where(eq(tasksTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const contentEdit = title != null || description != null || assigneeId != null || dueDate != null;
  if (current.status === "cancelled") {
    res.status(409).json({ error: "A cancelled task is immutable" });
    return;
  }
  if (current.status === "done") {
    const isPureReopen = !contentEdit && (status === "todo" || status === "in_progress");
    if (!isPureReopen) {
      res.status(409).json({ error: "A completed task is immutable — reopen it (status: todo or in_progress) before editing" });
      return;
    }
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
  if (status === "cancelled") {
    // Distinct audit event for the lifecycle cancel (cancel ≠ delete — the
    // task row and its history stay on the record).
    await audit(req, "task_cancelled", "task", id, { title: task.title, taskNumber: task.taskNumber });
  }
  emitInvalidate("tasks", { boardId: task.boardId, id, userIds: [task.assigneeId] });
  res.json({ ...task, assignee: assignee[0] ? safeAssignee : null, sourceMeetingTitle: null });
});

router.delete("/tasks/:id", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, id));
  if (task) await retainDeleted(req, "task", id, task);
  await db.delete(tasksTable).where(eq(tasksTable.id, id));
  await audit(req, "task_deleted", "task", id, { title: task?.title });
  emitInvalidate("tasks", { boardId: task?.boardId, id, userIds: [task?.assigneeId] });
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

  // Object-level authorization: only the task's assignee (or an admin) may
  // submit evidence. Without this, any authenticated user who knows a task UUID
  // could attach arbitrary files and feed them into the AI review pipeline.
  if (user.role !== "admin" && task.assigneeId !== user.id) {
    res.status(403).json({ error: "Only the assignee can submit evidence for this task" });
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

  // AI Review — evidence goes through real text extraction (PDF/DOCX/TXT),
  // never a raw-bytes read that feeds the model binary garbage.
  if (process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY) {
    try {
      const extraction = await extractText(filePath, req.file.mimetype || "", originalname);
      const evidenceText = extraction.ok
        ? extraction.text.slice(0, 12000)
        : `[Could not read file contents: ${extraction.error} File: ${originalname}, Size: ${size} bytes. Judge only on the metadata available and lean towards rejection with an explanation.]`;

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
  emitInvalidate("tasks", { boardId: task.boardId, id: taskId, userIds: [task.assigneeId] });
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
  await audit(req, "task_evidence_reviewed", "task", taskId, { evidenceId, decision });
  emitInvalidate("tasks", { id: taskId, userIds: [evidence.submittedBy] });

  const submitter = evidence.submittedBy
    ? await db.select().from(peopleTable).where(eq(peopleTable.id, evidence.submittedBy))
    : [];
  const { passwordHash: _, ...safeSubmitter } = submitter[0] || { passwordHash: "", id: "", email: "", name: "", role: "management" as const, createdAt: new Date() };

  res.json({ ...evidence, submitter: submitter[0] ? safeSubmitter : null });
});

export default router;
