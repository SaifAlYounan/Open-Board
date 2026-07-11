import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import {
  db,
  documentsTable,
  pendingActionsTable,
  peopleTable,
  accessControlTable,
  boardsTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { callAI, getDatabaseContext, aiConfigured, CLASSIFY_PROMPT } from "../lib/ai";
import { validateActionData, type ClassifyResponse } from "../lib/aiSchemas";
import { extractText, truncateText, UPLOADS_DIR } from "../lib/extractText";
import { wrapUntrusted, quotePresent } from "../lib/promptInjection";
import { grantDefaultAccess, hasAccess, setAccess, accessibleEntityIds, isBoardMember } from "../lib/access";
import { isUnderHold } from "../lib/legalHold";
import { audit, auditInTx } from "../lib/auditLog";
import { retainDeleted } from "../lib/retention";
import { logger } from "../lib/logger";
import { writeLimiter } from "../lib/rateLimiters";
import { emitInvalidate } from "../lib/realtime";

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
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

/**
 * Extract → persist the extracted text → classify → store classification →
 * queue validated pending actions. Every failure path writes a structured
 * error into aiClassification so the frontend polling can show the real state
 * (never a silent timeout).
 *
 * P0.5: the extracted text is persisted on the document row BEFORE anything
 * else (empty string when extraction failed), with or without an AI key —
 * source_quote checks and later re-verification are impossible otherwise.
 */
async function classifyDocument(docId: string, filePath: string, mimeType: string, originalName: string, userId: string, role: string): Promise<void> {
  const extraction = await extractText(filePath, mimeType, originalName);

  await db
    .update(documentsTable)
    .set({ extractedText: extraction.ok ? extraction.text : "", extractedAt: new Date() })
    .where(eq(documentsTable.id, docId));

  if (!aiConfigured()) {
    // Extraction persisted; nothing to classify without a configured provider.
    emitInvalidate("documents", { id: docId });
    return;
  }

  if (!extraction.ok) {
    await db
      .update(documentsTable)
      .set({ aiClassification: { error: "extraction_failed", message: extraction.error } })
      .where(eq(documentsTable.id, docId));
    return;
  }

  const { text: truncated, truncated: wasTruncated } = truncateText(extraction.text);
  const dbContext = await getDatabaseContext(userId, role);

  // DB-state as a cached block; only the document text is per-call. The text
  // is fenced as untrusted DATA (P0.5 channel separation — see promptInjection.ts).
  const result = await callAI("CLASSIFY", CLASSIFY_PROMPT, wrapUntrusted("DOCUMENT TEXT", truncated), dbContext);

  if (!result.success || !result.data) {
    await db
      .update(documentsTable)
      .set({ aiClassification: { error: result.error || "unknown", message: result.message || "Classification failed." } })
      .where(eq(documentsTable.id, docId));
    return;
  }

  const classified = result.data as ClassifyResponse;
  const validActions: Array<{ actionType: string; actionData: Record<string, unknown> }> = [];
  const skipped: string[] = [];
  // Quote-presence check against exactly what the model saw. HALLUCINATION
  // guard only — an injecting document can quote itself; see promptInjection.ts.
  let unverifiedQuotes = 0;

  for (const action of classified.proposed_actions ?? []) {
    const quoteVerified = action.source_quote ? quotePresent(action.source_quote, truncated) : false;
    if (!quoteVerified) unverifiedQuotes++;
    const actionData = {
      ...(action.details ?? {}),
      description: action.description,
      source_quote: action.source_quote ?? undefined,
      source_quote_verified: quoteVerified,
      confidence: classified.confidence,
    };
    const validation = validateActionData(action.action_type, actionData);
    if (validation.ok) {
      validActions.push({ actionType: action.action_type, actionData: validation.data });
    } else {
      skipped.push(`${action.action_type}: ${validation.error}`);
      logger.warn({ docId, actionType: action.action_type, error: validation.error }, "[ai] skipped invalid proposed action");
    }
  }

  await db
    .update(documentsTable)
    .set({
      aiClassification: {
        ...classified,
        truncated: wasTruncated || undefined,
        skipped_actions: skipped.length ? skipped : undefined,
        unverified_quote_actions: unverifiedQuotes || undefined,
      } as any,
    })
    .where(eq(documentsTable.id, docId));

  if (validActions.length) {
    await db.insert(pendingActionsTable).values(
      validActions.map((a) => ({
        documentId: docId,
        actionType: a.actionType as any,
        actionData: a.actionData,
        status: "pending" as const,
      }))
    );
    emitInvalidate("pendingActions", {});
  }
  // Classification finished — the document row changed either way.
  emitInvalidate("documents", { id: docId });

  // A document's board can be set at upload, changed via PATCH /documents/:id,
  // or set when a Secretary approves an AI-proposed action that files it to a
  // board. Board members then see it via live membership (lib/access.ts).
}

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param("id", (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid id format" });
    return;
  }
  next();
});

router.post("/documents/upload", requireAuth, writeLimiter, (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      const msg = err.message || "Upload failed";
      if (msg.includes("allowed") || msg.includes("Only")) {
        res.status(400).json({ error: "File type not allowed. Please upload a PDF, DOCX, or TXT file." });
      } else if (msg.includes("too large") || msg.includes("LIMIT_FILE_SIZE")) {
        res.status(400).json({ error: "File too large. Maximum size is 10 MB." });
      } else {
        res.status(400).json({ error: msg });
      }
      return;
    }
    next();
  });
}, async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  const user = req.user!;
  const { originalname, path: filePath, size, mimetype } = req.file;

  const safeFilename = (originalname || "document")
    .replace(/[^\w.\-\s]/g, "_")
    .replace(/\s+/g, "_")
    .substring(0, 255);

  // Optional board assignment (P0.7/A1). If a boardId is supplied, the document
  // belongs to that board and all its members can see it via live membership.
  // The uploader must be an admin or a member of that board, so a member cannot
  // plant a document into a board they do not sit on.
  const rawBoardId = typeof req.body?.boardId === "string" ? req.body.boardId.trim() : "";
  let boardId: string | null = null;
  if (rawBoardId) {
    if (!UUID_REGEX.test(rawBoardId)) {
      res.status(400).json({ error: "Invalid boardId" });
      return;
    }
    const [board] = await db.select({ id: boardsTable.id }).from(boardsTable).where(eq(boardsTable.id, rawBoardId));
    if (!board) {
      res.status(400).json({ error: "Board not found" });
      return;
    }
    if (user.role !== "admin" && !(await isBoardMember(user.id, rawBoardId))) {
      res.status(403).json({ error: "You are not a member of that board" });
      return;
    }
    boardId = rawBoardId;
  }

  // Store document. Fail-closed (P0.6): the document row, the uploader's access
  // grant, and the audit entry commit together — if the upload cannot be
  // audited, no document appears (the file on disk is orphaned, never visible).
  const doc = await db.transaction(async (tx) => {
    const [d] = await tx
      .insert(documentsTable)
      .values({
        title: safeFilename,
        filename: safeFilename,
        filePath,
        fileSize: size,
        mimeType: mimetype,
        uploadedBy: user.id,
        boardId,
      })
      .returning();

    // Always grant the uploader explicit access — covers board-less documents
    // (admin/uploader-only) and preserves the uploader's access if they later
    // leave the board. Board members see board documents via live membership.
    await tx
      .insert(accessControlTable)
      .values({ entityType: "document", entityId: d.id, personId: user.id, hasAccess: true })
      .onConflictDoNothing();

    await auditInTx(tx, req, "document_uploaded", "document", d.id, { filename: originalname, fileSize: size });
    return d;
  });

  // Respond immediately — don't wait for AI
  res.json({ document: doc, classifying: aiConfigured() });
  emitInvalidate("documents", { id: doc.id });

  // Extraction (P0.5, always) + AI classification (when configured) run in the
  // background; classifyDocument records every failure into aiClassification so
  // the client polling sees the real state.
  setImmediate(async () => {
    try {
      await classifyDocument(doc.id, filePath, mimetype, originalname, user.id, user.role);
    } catch (err: any) {
      logger.error({ err: err?.message, docId: doc.id }, "[ai] background extraction/classification crashed");
      await db
        .update(documentsTable)
        .set({ aiClassification: { error: "unknown", message: "Classification failed unexpectedly. Use Retry Classification." } })
        .where(eq(documentsTable.id, doc.id))
        .catch(() => {});
    }
  });
});

router.get("/documents", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { boardId } = req.query;

  const conds = [];
  if (typeof boardId === "string") conds.push(eq(documentsTable.boardId, boardId));
  if (user.role !== "admin") {
    const ids = await accessibleEntityIds(user.id, "document");
    if (ids.length === 0) {
      res.json([]);
      return;
    }
    conds.push(inArray(documentsTable.id, ids));
  }

  const docs = await db
    .select()
    .from(documentsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(documentsTable.createdAt);

  // Batch the uploader names (was one query per document).
  const uploaderIds = [...new Set(docs.map((d) => d.uploadedBy).filter((v): v is string => v != null))];
  const uploaders = uploaderIds.length
    ? await db.select({ id: peopleTable.id, name: peopleTable.name }).from(peopleTable).where(inArray(peopleTable.id, uploaderIds))
    : [];
  const nameById = new Map(uploaders.map((u) => [u.id, u.name]));

  const result = docs.map((d) => ({
    ...d,
    uploaderName: d.uploadedBy ? nameById.get(d.uploadedBy) ?? null : null,
  }));

  res.json(result);
});

router.get("/documents/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (!(await hasAccess(user.id, user.role, "document", id))) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const uploader = doc.uploadedBy
    ? await db.select().from(peopleTable).where(eq(peopleTable.id, doc.uploadedBy))
    : [];
  // Fail-closed (P0.6): a view that cannot be audited is not served.
  await audit(req, "document_viewed", "document", id, { filename: doc.filename });
  res.json({ ...doc, uploaderName: uploader[0]?.name || null });
});

router.get("/documents/:id/download", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (!(await hasAccess(user.id, user.role, "document", id))) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (!doc.filePath) {
    res.status(404).json({ error: "File not available" });
    return;
  }

  const UPLOADS_DIR = path.join(process.cwd(), "uploads");
  const resolvedPath = path.resolve(doc.filePath);
  const resolvedUploadsDir = path.resolve(UPLOADS_DIR);
  if (!resolvedPath.startsWith(resolvedUploadsDir + path.sep) && resolvedPath !== resolvedUploadsDir) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (!fs.existsSync(resolvedPath)) {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

  // Fail-closed (P0.6): a download that cannot be audited is not served.
  await audit(req, "document_downloaded", "document", id, { filename: doc.filename });

  const safeFilename = doc.filename.replace(/[\r\n\\";\x00-\x1f]/g, "").replace(/^\.+/, "") || "download";
  res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
  fs.createReadStream(resolvedPath).pipe(res);
});

// P0.7/A1 — assign or reassign a document to a board (admin). Setting a board
// makes the document visible to that board's members via live membership;
// clearing it (boardId: null) makes it board-less (admin + uploader only).
router.patch("/documents/:id", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { boardId } = req.body ?? {};

  let newBoardId: string | null;
  if (boardId === null || boardId === undefined || boardId === "") {
    newBoardId = null;
  } else if (typeof boardId === "string" && UUID_REGEX.test(boardId)) {
    const [board] = await db.select({ id: boardsTable.id }).from(boardsTable).where(eq(boardsTable.id, boardId));
    if (!board) {
      res.status(400).json({ error: "Board not found" });
      return;
    }
    newBoardId = boardId;
  } else {
    res.status(400).json({ error: "boardId must be a board UUID or null" });
    return;
  }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  // Fail-closed (P0.6): the reassignment and its audit entry commit together.
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(documentsTable)
      .set({ boardId: newBoardId })
      .where(eq(documentsTable.id, id))
      .returning();
    await auditInTx(tx, req, "document_board_assigned", "document", id, { boardId: newBoardId });
    return rows;
  });

  emitInvalidate("documents", { id });
  res.json(updated);
});

router.get("/documents/:id/access", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  const rows = await db
    .select({
      personId: accessControlTable.personId,
      hasAccess: accessControlTable.hasAccess,
      personName: peopleTable.name,
      personEmail: peopleTable.email,
      personRole: peopleTable.role,
    })
    .from(accessControlTable)
    .leftJoin(peopleTable, eq(accessControlTable.personId, peopleTable.id))
    .where(
      and(
        eq(accessControlTable.entityType, "document"),
        eq(accessControlTable.entityId, id)
      )
    );

  res.json(rows);
});

router.patch("/documents/:id/access", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { personId, hasAccess: grant } = req.body;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: "Invalid document ID" });
    return;
  }

  if (!personId || typeof grant !== "boolean") {
    res.status(400).json({ error: "Required: personId (string), hasAccess (boolean)" });
    return;
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personId)) {
    res.status(400).json({ error: "Invalid person ID" });
    return;
  }

  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  // Upsert an explicit exception. `grant=false` is a recusal (deny) that takes
  // precedence over board membership, so it works even when the person has no
  // prior row — which is the normal case for a board member being recused.
  // Fail-closed (P0.6): the access change and its audit entry commit together.
  await db.transaction(async (tx) => {
    await setAccess("document", id, personId, grant, tx, req.user!.id);
    await auditInTx(tx, req, grant ? "document_access_granted" : "document_access_revoked", "document", id, { personId });
  });
  res.json({ success: true, personId, hasAccess: grant });
});

router.delete("/documents/:id", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (doc && (await isUnderHold("document", id, doc.boardId))) {
    res.status(409).json({ error: "This document is under a legal hold and cannot be deleted." });
    return;
  }
  // Fail-closed (P0.6): retention snapshot, delete, and audit commit together.
  await db.transaction(async (tx) => {
    if (doc) await retainDeleted(req, "document", id, doc, tx);
    await tx.delete(documentsTable).where(eq(documentsTable.id, id));
    await auditInTx(tx, req, "document_deleted", "document", id, { filename: doc?.filename });
  });
  emitInvalidate("documents", { boardId: doc?.boardId, id });
  res.sendStatus(204);
});

router.post("/documents/:id/reclassify", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (!aiConfigured()) {
    res.json({ ...doc, error: "no_api_key" });
    return;
  }

  if (!doc.filePath) {
    res.status(400).json({ error: "No file path stored" });
    return;
  }

  const reclassifyUser = req.user!;
  try {
    await classifyDocument(id, doc.filePath, doc.mimeType || "text/plain", doc.filename, reclassifyUser.id, reclassifyUser.role);
  } catch (err: any) {
    logger.error({ err: err?.message, docId: id }, "[ai] reclassification crashed");
    res.status(500).json({ error: "Reclassification failed — see server logs" });
    return;
  }

  const [updatedDoc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  const classification = updatedDoc?.aiClassification as { error?: string; message?: string } | null;
  if (classification?.error) {
    res.json({ ...updatedDoc, classificationError: classification.message });
    return;
  }
  res.json(updatedDoc);
});

export default router;
