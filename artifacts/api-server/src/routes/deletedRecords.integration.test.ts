/**
 * Integration tests for the recycle bin + restore of deleted governance records
 * (issue #11 — true soft-delete + restore). Needs a real Postgres; skips itself
 * when DATABASE_URL is absent, same convention as the other integration suites.
 *
 * Under test:
 *  - a deleted record is snapshotted and appears in GET /deleted-records,
 *  - POST /deleted-records/:id/restore re-inserts it (id preserved) and stamps
 *    restoredAt/restoredBy without hard-deleting the deletion audit row,
 *  - double-restore → 409,
 *  - restore when a live record already holds the id → 409,
 *  - restore when the parent board is gone → 409,
 *  - non-admin gets 403 on both the list and the restore.
 */
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

d("deleted-records — recycle bin + restore", () => {
  let app: any;
  let db: any;
  let dbMod: any;
  let eq: any;
  let inArray: any;
  let like: any;

  const PASSWORD = "correct-horse-battery";
  const secretary = { email: "dr-sec@test.local", name: "DR Secretary", role: "admin" as const };
  const member = { email: "dr-member@test.local", name: "DR Member", role: "member" as const };
  const people: Record<string, any> = {};

  let ipCounter = 0;
  const nextIp = () => `10.94.0.${(++ipCounter % 250) + 1}`;

  const cookieCache: Record<string, string> = {};
  async function cookieFor(email: string): Promise<string> {
    if (cookieCache[email]) return cookieCache[email];
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", nextIp())
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"];
    cookieCache[email] = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
    return cookieCache[email];
  }

  function req(method: "get" | "post" | "delete", url: string, cookie: string) {
    return (request(app) as any)[method](url).set("Cookie", cookie).set("X-Forwarded-For", nextIp());
  }

  /** Create a throwaway board with no members (so meeting delete has no attendance rows). */
  async function makeBoard(name: string): Promise<any> {
    const [board] = await db.insert(dbMod.boardsTable).values({ name, abbreviation: "DR", type: "board" }).returning();
    return board;
  }

  async function createMeeting(cookie: string, boardId: string): Promise<any> {
    const res = await req("post", "/api/meetings", cookie).send({
      boardId,
      title: "DR meeting",
      date: new Date().toISOString(),
    });
    expect(res.status).toBe(201);
    return res.body;
  }

  let taskCounter = 0;
  async function createTask(cookie: string, boardId: string): Promise<any> {
    const res = await req("post", "/api/tasks", cookie).send({
      boardId,
      title: `DR task ${++taskCounter}`,
    });
    expect(res.status).toBe(201);
    return res.body;
  }

  /** Find the deleted_records row id for a given source-entity id. */
  async function deletedRowFor(entityId: string): Promise<any> {
    const [row] = await db
      .select()
      .from(dbMod.deletedRecordsTable)
      .where(eq(dbMod.deletedRecordsTable.entityId, entityId));
    return row;
  }

  async function wipe() {
    const {
      peopleTable, boardsTable, boardMembershipsTable, meetingsTable, tasksTable,
      accessControlTable, auditTrailTable, loginLockoutsTable, deletedRecordsTable,
    } = dbMod;
    const emails = [secretary.email, member.email];
    const staleBoards = await db.select().from(boardsTable).where(like(dbMod.boardsTable.name, "DR Board%"));
    const boardIds = staleBoards.map((b: any) => b.id);
    if (boardIds.length) {
      const meetings = await db.select().from(meetingsTable).where(inArray(meetingsTable.boardId, boardIds));
      const tasks = await db.select().from(tasksTable).where(inArray(tasksTable.boardId, boardIds));
      const entityIds = [...meetings.map((m: any) => m.id), ...tasks.map((t: any) => t.id)];
      if (entityIds.length) {
        await db.delete(accessControlTable).where(inArray(accessControlTable.entityId, entityIds));
        await db.delete(deletedRecordsTable).where(inArray(deletedRecordsTable.entityId, entityIds));
      }
      await db.delete(meetingsTable).where(inArray(meetingsTable.boardId, boardIds));
      await db.delete(tasksTable).where(inArray(tasksTable.boardId, boardIds));
      await db.delete(boardMembershipsTable).where(inArray(boardMembershipsTable.boardId, boardIds));
      await db.delete(boardsTable).where(inArray(boardsTable.id, boardIds));
    }
    const staleP = await db.select().from(peopleTable).where(inArray(peopleTable.email, emails));
    const ids = staleP.map((p: any) => p.id);
    if (ids.length) {
      await db.delete(deletedRecordsTable).where(inArray(deletedRecordsTable.deletedBy, ids));
      await db.delete(accessControlTable).where(inArray(accessControlTable.personId, ids));
      await db.delete(auditTrailTable).where(inArray(auditTrailTable.personId, ids));
      await db.delete(loginLockoutsTable).where(inArray(loginLockoutsTable.key, emails));
      await db.delete(boardMembershipsTable).where(inArray(boardMembershipsTable.personId, ids));
      await db.delete(peopleTable).where(inArray(peopleTable.id, ids));
    }
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    dbMod = await import("@workspace/db");
    db = dbMod.db;
    ({ eq, inArray, like } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    const { sql } = await import("drizzle-orm");
    await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS task_seq`);

    await wipe();
    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const p of [secretary, member]) {
      const [row] = await db.insert(dbMod.peopleTable).values({ ...p, passwordHash: hash }).returning();
      people[p.email] = row;
    }
  });

  it("soft-delete → list → restore → live again → deletion row stamped restored", async () => {
    const admin = await cookieFor(secretary.email);
    const board = await makeBoard("DR Board A");
    const meeting = await createMeeting(admin, board.id);

    // Delete → snapshotted.
    expect((await req("delete", `/api/meetings/${meeting.id}`, admin)).status).toBe(204);
    expect((await req("get", `/api/meetings/${meeting.id}`, admin)).status).toBe(404);

    // Appears in the recycle bin, restorable, not yet restored.
    const list = await req("get", "/api/deleted-records?limit=200", admin);
    expect(list.status).toBe(200);
    const entry = list.body.items.find((r: any) => r.entityId === meeting.id);
    expect(entry).toBeTruthy();
    expect(entry.entityType).toBe("meeting");
    expect(entry.restorable).toBe(true);
    expect(entry.restoredAt).toBeNull();
    expect(entry.title).toBe("DR meeting");

    const drId = entry.id;
    const restore = await req("post", `/api/deleted-records/${drId}/restore`, admin);
    expect(restore.status).toBe(200);
    expect(restore.body.entityId).toBe(meeting.id);

    // The record is live again, with its ORIGINAL id preserved.
    const live = await req("get", `/api/meetings/${meeting.id}`, admin);
    expect(live.status).toBe(200);
    expect(live.body.id).toBe(meeting.id);

    // The deletion row is stamped restored (not hard-deleted) and no longer restorable.
    const row = await deletedRowFor(meeting.id);
    expect(row).toBeTruthy();
    expect(row.restoredAt).not.toBeNull();
    expect(row.restoredBy).toBe(people[secretary.email].id);

    const list2 = await req("get", "/api/deleted-records?limit=200", admin);
    const entry2 = list2.body.items.find((r: any) => r.entityId === meeting.id);
    expect(entry2.restorable).toBe(false);
    expect(entry2.restoredAt).not.toBeNull();
    expect(entry2.restoredBy?.name).toBe(secretary.name);
  });

  it("double-restore → 409", async () => {
    const admin = await cookieFor(secretary.email);
    const board = await makeBoard("DR Board B");
    const task = await createTask(admin, board.id);
    expect((await req("delete", `/api/tasks/${task.id}`, admin)).status).toBe(204);

    const drId = (await deletedRowFor(task.id)).id;
    expect((await req("post", `/api/deleted-records/${drId}/restore`, admin)).status).toBe(200);

    const second = await req("post", `/api/deleted-records/${drId}/restore`, admin);
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already been restored/i);
  });

  it("restore when a live record already holds the id → 409", async () => {
    const admin = await cookieFor(secretary.email);
    const board = await makeBoard("DR Board C");
    const meeting = await createMeeting(admin, board.id);
    expect((await req("delete", `/api/meetings/${meeting.id}`, admin)).status).toBe(204);

    // Re-insert a live meeting with the SAME id (simulates a conflicting record).
    await db.insert(dbMod.meetingsTable).values({
      id: meeting.id, boardId: board.id, title: "Conflicting live meeting", date: new Date(),
    });

    const drId = (await deletedRowFor(meeting.id)).id;
    const restore = await req("post", `/api/deleted-records/${drId}/restore`, admin);
    expect(restore.status).toBe(409);
    expect(restore.body.error).toMatch(/already exists/i);
  });

  it("restore when the parent board is gone → 409", async () => {
    const admin = await cookieFor(secretary.email);
    const board = await makeBoard("DR Board D");
    const meeting = await createMeeting(admin, board.id);
    expect((await req("delete", `/api/meetings/${meeting.id}`, admin)).status).toBe(204);

    // Remove the parent board (no members, no other children) after the delete.
    await db.delete(dbMod.boardsTable).where(eq(dbMod.boardsTable.id, board.id));

    const drId = (await deletedRowFor(meeting.id)).id;
    const restore = await req("post", `/api/deleted-records/${drId}/restore`, admin);
    expect(restore.status).toBe(409);
    expect(restore.body.error).toMatch(/board .* no longer exists/i);
  });

  it("non-admin gets 403 on list and restore", async () => {
    const admin = await cookieFor(secretary.email);
    const memberCookie = await cookieFor(member.email);
    const board = await makeBoard("DR Board E");
    const meeting = await createMeeting(admin, board.id);
    expect((await req("delete", `/api/meetings/${meeting.id}`, admin)).status).toBe(204);
    const drId = (await deletedRowFor(meeting.id)).id;

    expect((await req("get", "/api/deleted-records", memberCookie)).status).toBe(403);
    expect((await req("post", `/api/deleted-records/${drId}/restore`, memberCookie)).status).toBe(403);
  });
});
