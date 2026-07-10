import "./loadEnv"; // must be first — populates process.env before app/config read it
import http from "http";
import app, { originValidator } from "./app";
import { logger } from "./lib/logger";
import { logMailerStatus } from "./lib/mailer";
import { attachRealtime } from "./lib/realtime";
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

server.listen(port, async () => {
  logger.info({ port }, "Server listening");
  logMailerStatus();

  try {
    await seed();
  } catch (err) {
    logger.error({ err }, "Seed failed — non-fatal");
  }
});
