import { defineConfig } from "drizzle-kit";
import path from "path";

// Load DATABASE_URL from the monorepo-root `.env` if it isn't already set in the
// environment (Node's built-in env-file loader — no dependency). Real env vars win.
const loadEnvFile = (process as { loadEnvFile?: (p: string) => void }).loadEnvFile;
if (typeof loadEnvFile === "function") {
  try {
    loadEnvFile(path.join(__dirname, "../../.env"));
  } catch {
    // No root .env — expected when env is provided directly.
  }
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  // Versioned SQL migrations (issue #17). `drizzle-kit generate` writes here;
  // boot (and CI) apply them with drizzle's journaled migrate().
  // NOTE: `out` MUST be relative — an absolute path trips a drizzle-kit bug that
  // prepends "./" to it and fails to find the meta snapshots. Run drizzle-kit
  // from this package dir (pnpm --filter @workspace/db) so the relative path resolves.
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
