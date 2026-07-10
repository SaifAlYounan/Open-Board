import "./loadEnv"; // must be first — populates process.env before app/config read it
import http from "http";
import { runMigrations } from "@workspace/db/migrate";
import app, { originValidator } from "./app";
import { logger } from "./lib/logger";
import { logMailerStatus } from "./lib/mailer";
import { attachRealtime } from "./lib/realtime";
import { checkStartupConfig } from "./lib/startupChecks";
import { seed } from "./seed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

// Socket.io for real-time cache invalidation (votes, tasks, documents,
// meetings, pending actions). Auth + room rules live in lib/realtime.ts.
export const io = attachRealtime(server, originValidator);

async function boot(): Promise<void> {
  // Fail fast on unsafe production configuration (default DB password, or a
  // DOMAIN set without NODE_ENV=production). Must run before we touch the DB or
  // accept traffic.
  checkStartupConfig();

  // Versioned migrations (issue #17): journaled, transactional, ordered — and
  // race-safe under multiple containers via a Postgres advisory lock. The
  // server must not accept traffic on an unmigrated schema, so this is fatal.
  logger.info("Applying database migrations…");
  await runMigrations();
  logger.info("Database migrations up to date");

  server.listen(port, async () => {
    logger.info({ port }, "Server listening");
    logMailerStatus();

    try {
      await seed();
    } catch (err) {
      logger.error({ err }, "Seed failed — non-fatal");
    }
  });
}

boot().catch((err) => {
  logger.error({ err }, "Database migration failed — refusing to start");
  process.exit(1);
});
