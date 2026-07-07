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
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
