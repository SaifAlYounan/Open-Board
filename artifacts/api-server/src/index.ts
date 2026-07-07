import http from "http";
import { Server as SocketIOServer } from "socket.io";
import app, { originValidator } from "./app";
import { logger } from "./lib/logger";
import { seed } from "./seed";
import { verifyToken } from "./lib/auth";
import { db, boardMembershipsTable, accessControlTable, peopleTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

// Socket.io for real-time vote/signature tracking
export const io = new SocketIOServer(server, {
  cors: { origin: originValidator, methods: ["GET", "POST"], credentials: true },
});

// Authenticate every Socket.IO connection via HttpOnly cookie.
// Role and account state come from the DB, not the token payload — a stale or
// revoked token (deactivation, password reset) must not open a live socket.
io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie || "";
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const [key, ...val] = c.trim().split("=");
        return [key.trim(), val.join("=")];
      })
    );
    const token = cookies["token"];
    if (!token) {
      return next(new Error("Authentication required"));
    }
    const payload = verifyToken(token);
    if (!payload) {
      return next(new Error("Invalid token"));
    }
    const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, payload.userId));
    if (!person || person.active === false || (payload.tokenVersion ?? 0) !== person.tokenVersion) {
      return next(new Error("Invalid token"));
    }
    socket.data.user = { userId: person.id, email: person.email, role: person.role };
    next();
  } catch {
    next(new Error("Authentication failed"));
  }
});

io.on("connection", (socket) => {
  const user = socket.data.user as { userId: string; email: string; role: string };
  logger.info({ socketId: socket.id, userId: user?.userId }, "Socket connected");

  // Track join events per connection for rate limiting (L2)
  let joinCount = 0;
  const JOIN_LIMIT = 10;
  const joinWindow = setTimeout(() => { joinCount = 0; }, 60_000);

  function checkJoinRateLimit(): boolean {
    joinCount++;
    if (joinCount > JOIN_LIMIT) {
      logger.warn({ socketId: socket.id, userId: user?.userId }, "Socket join rate limit exceeded — disconnecting");
      socket.disconnect(true);
      return false;
    }
    return true;
  }

  socket.on("join:board", async (boardId: string) => {
    if (!checkJoinRateLimit()) return;
    if (user.role !== "admin") {
      const [membership] = await db
        .select()
        .from(boardMembershipsTable)
        .where(and(eq(boardMembershipsTable.boardId, boardId), eq(boardMembershipsTable.personId, user.userId)));
      if (!membership) return;
    }
    socket.join(`board:${boardId}`);
  });

  socket.on("join:vote", async (voteId: string) => {
    if (!checkJoinRateLimit()) return;
    if (user.role !== "admin") {
      const [access] = await db
        .select()
        .from(accessControlTable)
        .where(
          and(
            eq(accessControlTable.entityType, "vote"),
            eq(accessControlTable.entityId, voteId),
            eq(accessControlTable.personId, user.userId),
            eq(accessControlTable.hasAccess, true)
          )
        );
      if (!access) return;
    }
    socket.join(`vote:${voteId}`);
  });

  socket.on("join:minutes", async (minutesId: string) => {
    if (!checkJoinRateLimit()) return;
    if (user.role !== "admin") {
      const [access] = await db
        .select()
        .from(accessControlTable)
        .where(
          and(
            eq(accessControlTable.entityType, "minutes"),
            eq(accessControlTable.entityId, minutesId),
            eq(accessControlTable.personId, user.userId),
            eq(accessControlTable.hasAccess, true)
          )
        );
      if (!access) return;
    }
    socket.join(`minutes:${minutesId}`);
  });

  socket.on("disconnect", () => {
    clearTimeout(joinWindow);
    logger.info({ socketId: socket.id, userId: user?.userId }, "Socket disconnected");
  });
});

server.listen(port, async () => {
  logger.info({ port }, "Server listening");

  try {
    await seed();
  } catch (err) {
    logger.error({ err }, "Seed failed — non-fatal");
  }
});
