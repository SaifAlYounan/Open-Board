import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  db,
  documentsTable,
  pendingActionsTable,
  peopleTable,
  accessControlTable,
  boardsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { callAI, getDatabaseContext, CLASSIFY_PROMPT } from "../lib/ai";
import { grantDefaultAccess } from "../lib/access";
import { audit } from "../lib/auditLog";
import { logger } from "../lib/logger";
import { writeLimiter } from "../lib/rateLimiters";

const execFileAsync = promisify(execFile);

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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

async function extractTextFromPdf(filePath: string): Promise<string> {
  // Validate the file path is within the uploads directory (L3)
  const resolvedPath = path.resolve(filePath);
  const resolvedUploadsDir = path.resolve(UPLOADS_DIR);
  if (!resolvedPath.startsWith(resolvedUploadsDir + path.sep) && resolvedPath !== resolvedUploadsDir) {
    throw new Error("Invalid file path: outside uploads directory");
  }

  // Primary: pdftotext (available in development / Linux environments with poppler)
  try {
    const { stdout, stderr } = await execFileAsync(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", filePath, "-"],
      { maxBuffer: 50 * 1024 * 1024 }
    );
    if (stderr) logger.warn({ stderr: stderr.slice(0, 200) }, "[pdf] pdftotext stderr");
    const extracted = stdout?.trim() ?? "";
    if (extracted.length > 0) {
      logger.info({ chars: extracted.length }, "[pdf] pdftotext extracted text");
      return stdout;
    }
  } catch (err) {
    const msg = (err as NodeJS.ErrnoException).code === "ENOENT"
      ? "pdftotext not found in PATH — using pdf-parse fallback"
      : `pdftotext failed: ${(err as Error).message}`;
    logger.warn(`[pdf] ${msg}`);
  }

  // Fallback: pdf-parse v1 (pure JS, works in any Node.js environment)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfParse = (globalThis as any).require("pdf-parse") as (buf: Buffer, opts?: Record<string, unknown>) => Promise<{ text: string }>;
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer, { max: 0 });
    const extracted = data.text?.trim() ?? "";
    if (extracted.length > 0) {
      logger.info({ chars: extracted.length }, "[pdf] pdf-parse extracted text");
      return data.text;
    }
    logger.warn("[pdf] pdf-parse returned empty — PDF may be image-only or encrypted");
  } catch (err) {
    logger.error({ err }, "[pdf] pdf-parse failed");
  }

  return "";
}

async function extractText(filePath: string, mimeType: string, originalName: string): Promise<string> {
  const ext = path.extname(originalName).toLowerCase();
  try {
    if (ext === ".txt" || mimeType === "text/plain") {
      return fs.readFileSync(filePath, "utf-8");
    }
    if (ext === ".pdf" || mimeType === "application/pdf") {
      const text = await extractTextFromPdf(filePath);
      if (text) return text;
      return "Could not extract text from this PDF. The file may be scanned/image-only or encrypted.";
    }
    if (ext === ".docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ path: filePath });
      if (result.value) return result.value;
    }
  } catch (err) {
    logger.error({ err }, "[extractText] unexpected error");
  }
  return "Could not extract text from document.";
}

function truncateText(text: string, maxChars = 48000): string {
  if (text.length <= maxChars) return text;
  const half = maxChars / 2;
  return text.slice(0, half) + "\n...[truncated]...\n" + text.slice(-half);
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

  // Store document
  const [doc] = await db
    .insert(documentsTable)
    .values({
      title: safeFilename,
      filename: safeFilename,
      filePath,
      fileSize: size,
      mimeType: mimetype,
      uploadedBy: user.id,
    })
    .returning();

  // Grant access (admin-only until assigned to board)
  await db
    .insert(accessControlTable)
    .values({ entityType: "document", entityId: doc.id, personId: user.id, hasAccess: true })
    .onConflictDoNothing();

  // Respond immediately — don't wait for AI
  res.json({ document: doc, classifying: !!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY) });
  audit(req, "document_uploaded", "document", doc.id, { filename: originalname, fileSize: size });

  // AI Classification runs in background (fire-and-forget)
  const hasAI = !!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
  if (hasAI) {
    setImmediate(async () => {
      try {
        const text = await extractText(filePath, mimetype, originalname);
        const truncated = truncateText(text);
        const dbContext = await getDatabaseContext(user.id, user.role);
        const userContent = `${dbContext}\n\nDOCUMENT TEXT:\n${truncated}`;

        const result = await callAI("CLASSIFY", CLASSIFY_PROMPT, userContent);

        if (result.success && result.data) {
          await db
            .update(documentsTable)
            .set({ aiClassification: result.data as any })
            .where(eq(documentsTable.id, doc.id));

          const classified = result.data as {
            proposed_actions?: Array<{ action_type: string; description: string; details: unknown }>;
            confidence?: number;
          };
          if (classified.proposed_actions?.length) {
            await db
              .insert(pendingActionsTable)
              .values(
                classified.proposed_actions.map((action) => ({
                  documentId: doc.id,
                  actionType: action.action_type as any,
                  actionData: { ...(action.details as object), description: action.description, confidence: classified.confidence },
                  status: "pending" as const,
                }))
              );
          }

          // Grant document access to board members based on AI-detected board
          const detectedBoardName = (result.data as any)?.board_name || (result.data as any)?.board;
          if (detectedBoardName) {
            const boards = await db
              .select()
              .from(boardsTable)
              .where(eq(boardsTable.name, detectedBoardName));
            if (boards.length) {
              await grantDefaultAccess("document", doc.id, boards[0].id);
            } else {
              const allBoards = await db.select().from(boardsTable);
              const match = allBoards.find(
                (b) =>
                  b.abbreviation?.toLowerCase() === detectedBoardName.toLowerCase() ||
                  b.name.toLowerCase().includes(detectedBoardName.toLowerCase())
              );
              if (match) {
                await grantDefaultAccess("document", doc.id, match.id);
              }
            }
          }
        }
      } catch (err: any) {
        logger.warn({ err: err?.message }, "[ai] background classification failed — document already stored");
      }
    });
  }
});

router.get("/documents", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { boardId } = req.query;

  let docs = await db.select().from(documentsTable).orderBy(documentsTable.createdAt);

  if (boardId) docs = docs.filter((d) => d.boardId === boardId);

  if (user.role !== "admin") {
    const accessible = await db
      .select()
      .from(accessControlTable)
      .where(
        and(
          eq(accessControlTable.entityType, "document"),
          eq(accessControlTable.personId, user.id),
          eq(accessControlTable.hasAccess, true)
        )
      );
    const accessibleIds = new Set(accessible.map((a) => a.entityId));
    docs = docs.filter((d) => accessibleIds.has(d.id));
  }

  const result = await Promise.all(
    docs.map(async (d) => {
      const uploader = d.uploadedBy
        ? await db.select().from(peopleTable).where(eq(peopleTable.id, d.uploadedBy))
        : [];
      return { ...d, uploaderName: uploader[0]?.name || null };
    })
  );

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

  if (user.role !== "admin") {
    const [access] = await db
      .select()
      .from(accessControlTable)
      .where(
        and(
          eq(accessControlTable.entityType, "document"),
          eq(accessControlTable.entityId, id),
          eq(accessControlTable.personId, user.id),
          eq(accessControlTable.hasAccess, true)
        )
      );
    if (!access) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  const uploader = doc.uploadedBy
    ? await db.select().from(peopleTable).where(eq(peopleTable.id, doc.uploadedBy))
    : [];
  audit(req, "document_viewed", "document", id, { filename: doc.filename });
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

  if (user.role !== "admin") {
    const [access] = await db
      .select()
      .from(accessControlTable)
      .where(
        and(
          eq(accessControlTable.entityType, "document"),
          eq(accessControlTable.entityId, id),
          eq(accessControlTable.personId, user.id),
          eq(accessControlTable.hasAccess, true)
        )
      );
    if (!access) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  if (!doc.filePath) {
    res.status(404).json({ error: "File not available" });
    return;
  }

  const UPLOADS_DIR = path.join(process.cwd(), "uploads");
  const resolvedPath = path.resolve(doc.filePath);
  const resolvedUploadsDir = path.resolve(UPLOADS_DIR);
  if (!resolvedPath.startsWith(resolvedUploadsDir)) {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  if (!fs.existsSync(resolvedPath)) {
    res.status(404).json({ error: "File not found on disk" });
    return;
  }

  audit(req, "document_downloaded", "document", id, { filename: doc.filename });

  const safeFilename = doc.filename.replace(/[\r\n\\";\x00-\x1f]/g, "").replace(/^\.+/, "") || "download";
  res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
  fs.createReadStream(resolvedPath).pipe(res);
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

  const result = await db
    .update(accessControlTable)
    .set({ hasAccess: grant })
    .where(
      and(
        eq(accessControlTable.entityType, "document"),
        eq(accessControlTable.entityId, id),
        eq(accessControlTable.personId, personId)
      )
    )
    .returning();

  if (result.length === 0) {
    res.status(404).json({ error: "No access record found for this person on this document" });
    return;
  }

  audit(req, grant ? "document_access_granted" : "document_access_revoked", "document", id, { personId });
  res.json({ success: true, personId, hasAccess: grant });
});

router.delete("/documents/:id", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  audit(req, "document_deleted", "document", id, { filename: doc?.filename });
  res.sendStatus(204);
});

router.post("/documents/:id/reclassify", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }

  if (!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY)) {
    res.json({ ...doc, error: "no_api_key" });
    return;
  }

  if (!doc.filePath) {
    res.status(400).json({ error: "No file path stored" });
    return;
  }

  const text = await extractText(doc.filePath, doc.mimeType || "text/plain", doc.filename);
  const truncated = truncateText(text);
  const reclassifyUser = req.user!;
  const dbContext = await getDatabaseContext(reclassifyUser.id, reclassifyUser.role);
  const result = await callAI("CLASSIFY", CLASSIFY_PROMPT, `${dbContext}\n\nDOCUMENT TEXT:\n${truncated}`);

  if (result.success && result.data) {
    const [updatedDoc] = await db
      .update(documentsTable)
      .set({ aiClassification: result.data as any })
      .where(eq(documentsTable.id, id))
      .returning();
    res.json(updatedDoc);
  } else {
    res.json({ ...doc, classificationError: result.message });
  }
});

export default router;
