// Loads environment variables from a local `.env` file into process.env.
//
// This MUST be the first import in the server entrypoint so that variables are
// available before any module that reads them at import time (e.g. the CORS
// origin validator in app.ts, or the PORT check in index.ts).
//
// Uses Node's built-in env-file loader (Node 20.12+/21.7+) — no dependency.
// Real environment variables already set by the shell / container take
// precedence; the file only fills in what is missing. A missing file is fine.
import path from "path";

const loadEnvFile = (process as { loadEnvFile?: (p: string) => void }).loadEnvFile;

if (typeof loadEnvFile === "function") {
  // Repo-root `.env` first, then a workspace-local `.env` (which wins on overlap).
  for (const candidate of [
    path.resolve(process.cwd(), "../../.env"),
    path.resolve(process.cwd(), ".env"),
  ]) {
    try {
      loadEnvFile(candidate);
    } catch {
      // No file at this path — expected in production, ignore.
    }
  }
}
