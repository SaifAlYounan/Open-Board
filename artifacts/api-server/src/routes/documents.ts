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
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { callAI, getDatabaseContext, CLASSIFY_PROMPT } from "../lib/ai";
import { grantDefaultAccess } from "../lib/access";
import { audit } from "../lib/auditLog";

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
  try {
    // pdftotext (poppler-utils) — reliable, handles all standard text-based PDFs
    const { stdout, stderr } = await execFileAsync(
      "pdftotext",
      ["-layout", "-enc", "UTF-8", filePath, "-"],
      { maxBuffer: 50 * 1024 * 1024 }
    );
    if (stderr) console.warn("[pdf] pdftotext stderr:", stderr.slice(0, 200));
    const extracted = stdout?.trim() ?? "";
    if (extracted.length > 0) {
      console.log(`[pdf] pdftotext extracted ${extracted.length} chars from ${path.basename(filePath)}`);
      return stdout;
    }
    console.warn("[pdf] pdftotext returned empty — PDF may be image-only or encrypted");
  } catch (err) {
    console.error("[pdf] pdftotext failed:", (err as Error).message);
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
    console.error("[extractText] unexpected error:", (err as Error).message);
  }
  return "Could not extract text from document.";
}

function truncateText(text: string, maxChars = 48000): string {
  if (text.length <= maxChars) return text;
  const half = maxChars / 2;
  return text.slice(0, half) + "\n...[truncated]...\n" + text.slice(-half);
}

const router = Router();

router.post("/documents/upload", requireAuth, (req, res, next) => {
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

  // Store document
  const [doc] = await db
    .insert(documentsTable)
    .values({
      title: originalname,
      filename: originalname,
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
        const dbContext = await getDatabaseContext();
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
        }
      } catch {
        // AI failed silently — document already stored
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
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  if (!doc) {
    res.status(404).json({ error: "Document not found" });
    return;
  }
  const uploader = doc.uploadedBy
    ? await db.select().from(peopleTable).where(eq(peopleTable.id, doc.uploadedBy))
    : [];
  audit(req, "document_viewed", "document", id, { filename: doc.filename });
  res.json({ ...doc, uploaderName: uploader[0]?.name || null });
});

router.delete("/documents/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
  await db.delete(documentsTable).where(eq(documentsTable.id, id));
  audit(req, "document_deleted", "document", id, { filename: doc?.filename });
  res.sendStatus(204);
});

router.post("/documents/:id/reclassify", requireAuth, requireAdmin, async (req, res): Promise<void> => {
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
  const dbContext = await getDatabaseContext();
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
