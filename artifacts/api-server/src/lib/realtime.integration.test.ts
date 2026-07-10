/**
 * Socket authorization tests for the real-time layer (issue #8). Needs a real
 * Postgres — skips itself when DATABASE_URL is absent, same convention as the
 * other integration suites.
 *
 * Under test:
 *  - an unauthenticated / garbage-token handshake is rejected,
 *  - a member is auto-joined ONLY to boards they belong to,
 *  - a member cannot join a foreign board room via join:board,
 *  - an admin lands in the `admins` room,
 *  - board-scoped emits reach members of that board and nobody else.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "http";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

d("realtime — socket authz", () => {
  let ioServer: any;
  let server: http.Server;
  let port: number;
  let db: any;
  let dbMod: any;
  let eq: any;
  let inArray: any;
  let signToken: any;
  let detachRealtime: any;
  let emitInvalidate: any;
  let ioc: typeof import("socket.io-client").io;

  const admin = { email: "rt-admin@test.local", name: "RT Admin", role: "admin" as const };
  const member = { email: "rt-member@test.local", name: "RT Member", role: "member" as const };
  const people: Record<string, any> = {};
  let boardA: any; // member belongs here
  let boardB: any; // foreign board

  function cookieFor(person: any): string {
    return `token=${signToken({ userId: person.id, email: person.email, role: person.role, tokenVersion: person.tokenVersion })}`;
  }

  function connect(cookie?: string) {
    return ioc(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      ...(cookie ? { extraHeaders: { cookie } } : {}),
    });
  }

  function connected(socket: any): Promise<void> {
    return new Promise((resolve, reject) => {
      socket.on("connect", () => resolve());
      socket.on("connect_error", (err: Error) => reject(err));
      setTimeout(() => reject(new Error("connect timeout")), 3000);
    });
  }

  function rejected(socket: any): Promise<Error> {
    return new Promise((resolve, reject) => {
      socket.on("connect", () => reject(new Error("expected the handshake to be rejected")));
      socket.on("connect_error", (err: Error) => resolve(err));
      setTimeout(() => reject(new Error("connect timeout")), 3000);
    });
  }

  async function serverRoomsOf(email: string): Promise<Set<string>> {
    const sockets = await ioServer.fetchSockets();
    const s = sockets.find((x: any) => x.data?.user?.email === email);
    return new Set(s ? [...s.rooms] : []);
  }

  async function waitFor(pred: () => Promise<boolean>, ms = 2000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (await pred()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async function wipe() {
    const { peopleTable, boardsTable, boardMembershipsTable } = dbMod;
    const emails = [admin.email, member.email];
    const rows = await db.select().from(peopleTable).where(inArray(peopleTable.email, emails));
    const ids = rows.map((r: any) => r.id);
    if (ids.length) await db.delete(boardMembershipsTable).where(inArray(boardMembershipsTable.personId, ids));
    const staleBoards = await db.select().from(boardsTable).where(inArray(boardsTable.name, ["RT Board A", "RT Board B"]));
    for (const b of staleBoards) {
      await db.delete(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, b.id));
      await db.delete(boardsTable).where(eq(boardsTable.id, b.id));
    }
    if (ids.length) await db.delete(peopleTable).where(inArray(peopleTable.id, ids));
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    dbMod = await import("@workspace/db");
    db = dbMod.db;
    ({ eq, inArray } = await import("drizzle-orm"));
    ({ signToken } = await import("./auth"));
    const rt = await import("./realtime");
    ({ detachRealtime, emitInvalidate } = rt);
    ({ io: ioc } = await import("socket.io-client"));

    await wipe();
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash("irrelevant-password-123", 4);
    for (const p of [admin, member]) {
      const [row] = await db.insert(dbMod.peopleTable).values({ ...p, passwordHash: hash }).returning();
      people[p.email] = row;
    }
    [boardA] = await db.insert(dbMod.boardsTable).values({ name: "RT Board A", abbreviation: "RTA", type: "board" }).returning();
    [boardB] = await db.insert(dbMod.boardsTable).values({ name: "RT Board B", abbreviation: "RTB", type: "board" }).returning();
    await db.insert(dbMod.boardMembershipsTable).values({ boardId: boardA.id, personId: people[member.email].id, roleInBoard: "member" });

    server = http.createServer();
    ioServer = rt.attachRealtime(server, (_origin, cb) => cb(null, true));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as any).port;
  });

  afterAll(async () => {
    if (detachRealtime) await detachRealtime();
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await wipe();
  });

  it("rejects an unauthenticated handshake", async () => {
    const s = connect();
    const err = await rejected(s);
    expect(err.message).toContain("Authentication required");
    s.disconnect();
  });

  it("rejects a garbage token", async () => {
    const s = connect("token=not-a-jwt");
    const err = await rejected(s);
    expect(err.message).toMatch(/Authentication failed|Invalid token/);
    s.disconnect();
  });

  it("auto-joins a member to their own board room only, and blocks foreign join:board", async () => {
    const s = connect(cookieFor(people[member.email]));
    await connected(s);
    await waitFor(async () => (await serverRoomsOf(member.email)).has(`board:${boardA.id}`));

    let rooms = await serverRoomsOf(member.email);
    expect(rooms.has(`board:${boardA.id}`)).toBe(true);
    expect(rooms.has(`board:${boardB.id}`)).toBe(false);
    expect(rooms.has("admins")).toBe(false);
    expect(rooms.has(`user:${people[member.email].id}`)).toBe(true);

    // A member must NOT be able to join a board they don't belong to.
    s.emit("join:board", boardB.id);
    await new Promise((r) => setTimeout(r, 300)); // give the (rejected) join time to land if it were allowed
    rooms = await serverRoomsOf(member.email);
    expect(rooms.has(`board:${boardB.id}`)).toBe(false);

    // Board-scoped emits: an event for board B never reaches the member.
    const received: any[] = [];
    s.on("invalidate", (e: any) => received.push(e));
    emitInvalidate("votes", { boardId: boardB.id });
    emitInvalidate("votes", { boardId: boardA.id });
    await waitFor(async () => received.length >= 1);
    expect(received.length).toBe(1);
    expect(received[0].boardId).toBe(boardA.id);

    s.disconnect();
  });

  it("puts an admin in the admins room and delivers board-less events there", async () => {
    const s = connect(cookieFor(people[admin.email]));
    await connected(s);
    await waitFor(async () => (await serverRoomsOf(admin.email)).has("admins"));
    const rooms = await serverRoomsOf(admin.email);
    expect(rooms.has("admins")).toBe(true);

    const received: any[] = [];
    s.on("invalidate", (e: any) => received.push(e));
    emitInvalidate("pendingActions", {});
    await waitFor(async () => received.length >= 1);
    expect(received.length).toBe(1);
    expect(received[0].resource).toBe("pendingActions");
    s.disconnect();
  });
});
