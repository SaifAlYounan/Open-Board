import type http from "http";
import { Server as SocketIOServer } from "socket.io";
import { db, boardMembershipsTable, accessControlTable, peopleTable } from "@workspace/db";
import { hasAccess } from "./access";
import { eq, and } from "drizzle-orm";
import { verifyToken } from "./auth";
import { logger } from "./logger";

/**
 * Real-time change notifications (Socket.IO).
 *
 * Model: the server emits coarse "invalidate" events — {resource, boardId?, id?}
 * — and the frontend invalidates the matching react-query caches. No entity
 * payloads travel over the socket (cache-invalidation-only), so the socket
 * layer can never leak more than the REST API the refetch goes through.
 *
 * Authorization:
 *  - The handshake validates the HttpOnly JWT cookie against the DB (account
 *    active + tokenVersion), same rules as requireAuth.
 *  - Rooms are joined SERVER-SIDE at connection time from the user's actual
 *    board memberships (`board:<id>`), plus `user:<id>` and, for admins,
 *    `admins`. A client cannot join a room it isn't entitled to: the explicit
 *    join events below re-check membership/access in the DB on every call.
 *  - Emissions target rooms only — never broadcast to all sockets.
 *
 * The app must work identically with sockets unavailable: nothing here is
 * load-bearing, and emitInvalidate is a no-op until attachRealtime ran.
 */

export type RealtimeResource =
  | "votes"
  | "tasks"
  | "documents"
  | "meetings"
  | "minutes"
  | "pendingActions"
  | "boards"
  | "people";

let io: SocketIOServer | null = null;

/** Test seam / accessor. */
export function getIO(): SocketIOServer | null {
  return io;
}

/**
 * Emit a cache-invalidation event.
 *  - always to `admins` (admins may see everything),
 *  - to `board:<boardId>` when the change is board-scoped,
 *  - to `user:<id>` for directly-affected users (e.g. a task's assignee, who
 *    may not be a board member — management role).
 * No-op when Socket.IO isn't attached (unit tests, supertest app-only).
 */
export function emitInvalidate(
  resource: RealtimeResource,
  opts: { boardId?: string | null; id?: string | null; userIds?: (string | null | undefined)[] } = {}
): void {
  if (!io) return;
  const payload = { resource, boardId: opts.boardId ?? null, id: opts.id ?? null };
  try {
    let target = io.to("admins");
    if (opts.boardId) target = target.to(`board:${opts.boardId}`);
    for (const uid of opts.userIds ?? []) {
      if (uid) target = target.to(`user:${uid}`);
    }
    target.emit("invalidate", payload);
  } catch (err) {
    logger.warn({ err, resource }, "Realtime emit failed — clients will refetch on their own");
  }
}

/** Attach Socket.IO (auth + rooms) to the HTTP server. Called once from index.ts. */
export function attachRealtime(
  server: http.Server,
  originValidator: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void
): SocketIOServer {
  io = new SocketIOServer(server, {
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

  io.on("connection", async (socket) => {
    const user = socket.data.user as { userId: string; email: string; role: string };
    logger.info({ socketId: socket.id, userId: user?.userId }, "Socket connected");

    // Server-side auto-join: the client never has to (and never gets to) pick
    // its own rooms for the invalidate stream — entitlements come from the DB.
    try {
      socket.join(`user:${user.userId}`);
      if (user.role === "admin") {
        socket.join("admins");
      } else {
        const memberships = await db
          .select({ boardId: boardMembershipsTable.boardId })
          .from(boardMembershipsTable)
          .where(eq(boardMembershipsTable.personId, user.userId));
        for (const m of memberships) {
          if (m.boardId) socket.join(`board:${m.boardId}`);
        }
      }
    } catch (err) {
      logger.warn({ err, userId: user?.userId }, "Socket auto-join failed");
    }

    // Track join events per connection for rate limiting (L2)
    let joinCount = 0;
    const JOIN_LIMIT = 10;
    const joinWindow = setTimeout(() => {
      joinCount = 0;
    }, 60_000);

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
      if (typeof boardId !== "string") return;
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
      if (typeof voteId !== "string") return;
      if (!(await hasAccess(user.userId, user.role, "vote", voteId))) return;
      socket.join(`vote:${voteId}`);
    });

    socket.on("join:minutes", async (minutesId: string) => {
      if (!checkJoinRateLimit()) return;
      if (typeof minutesId !== "string") return;
      if (!(await hasAccess(user.userId, user.role, "minutes", minutesId))) return;
      socket.join(`minutes:${minutesId}`);
    });

    socket.on("disconnect", () => {
      clearTimeout(joinWindow);
      logger.info({ socketId: socket.id, userId: user?.userId }, "Socket disconnected");
    });
  });

  return io;
}

/** Test teardown: close the server and clear module state. */
export async function detachRealtime(): Promise<void> {
  if (io) {
    await io.close();
    io = null;
  }
}
