import path from "path";
import fs from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

export const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export type ExtractResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

async function extractTextFromPdf(filePath: string): Promise<string> {
  // Validate the file path is within the uploads directory
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

/**
 * Extract text from an uploaded file. Failures are returned as errors — never
 * as prose masquerading as document content that would then get "classified".
 */
export async function extractText(filePath: string, mimeType: string, originalName: string): Promise<ExtractResult> {
  const ext = path.extname(originalName).toLowerCase();
  try {
    if (ext === ".txt" || mimeType === "text/plain") {
      return { ok: true, text: fs.readFileSync(filePath, "utf-8") };
    }
    if (ext === ".pdf" || mimeType === "application/pdf") {
      const text = await extractTextFromPdf(filePath);
      if (text.trim()) return { ok: true, text };
      return { ok: false, error: "Could not extract text from this PDF — it may be scanned/image-only or encrypted." };
    }
    if (ext === ".docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ path: filePath });
      if (result.value?.trim()) return { ok: true, text: result.value };
      return { ok: false, error: "Could not extract text from this DOCX file." };
    }
  } catch (err) {
    logger.error({ err }, "[extractText] unexpected error");
  }
  return { ok: false, error: "Could not extract text from this document." };
}

/** Middle-out truncation with an explicit flag so the UI can disclose it. */
export function truncateText(text: string, maxChars = 48000): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  const half = maxChars / 2;
  return {
    text: text.slice(0, half) + "\n...[middle of document omitted]...\n" + text.slice(-half),
    truncated: true,
  };
}
