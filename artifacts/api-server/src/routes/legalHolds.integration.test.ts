/**
 * P0.9 — legal hold + retention (F11). Needs a real Postgres at DATABASE_URL.
 *
 * A held record cannot be deleted through any governance delete route (409); the
 * hold is admin-placed and audited; releasing it re-enables deletion; and a
 * board-level hold cascades to the board's entities.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

d("legal holds block deletion (P0.9)", () => {
  const BOARD_NAME = "Legal Hold Test Board";
  const admin = { email: "lh-admin@test.local", name: "LH Admin", role: "admin" as const };
  const PASSWORD = "correct-horse-battery";
  let app: any, db: any, mod: any, eq: any;
  let boardId: string, adminCookie: string;

  let ip = 0;
  async function cookieFor(email: string): Promise<string> {
    const res = await request(app).post("/api/auth/login").set("X-Forwarded-For", `10.33.0.${++ip}`).send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const c = res.headers["set-cookie"];
    return (Array.isArray(c) ? c[0] : c).split(";")[0];
  }
  async function place(entityType: string, entityId: string): Promise<string> {
    const r = await request(app).post("/api/legal-holds").set("Cookie", adminCookie).send({ entityType, entityId, reason: "litigation X" });
    expect(r.status).toBe(201);
    return r.body.id;
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    mod = await import("@workspace/db");
    db = mod.db;
    ({ eq } = await import("drizzle-orm"));
    app = (await import("../app")).default;
    const [ex] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, admin.email));
    if (ex) {
      await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, ex.id));
      // legal_holds + deleted_records reference the person (FK) — remove first.
      await db.delete(mod.legalHoldsTable).where(eq(mod.legalHoldsTable.placedBy, ex.id));
      await db.delete(mod.deletedRecordsTable).where(eq(mod.deletedRecordsTable.deletedBy, ex.id));
      await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, ex.id));
    }
    await db.insert(mod.peopleTable).values({ ...admin, passwordHash: await bcrypt.hash(PASSWORD, 10) });
    for (const b of await db.select().from(mod.boardsTable).where(eq(mod.boardsTable.name, BOARD_NAME))) {
      // Delete the board's child entities (some may still be held) before the board.
      await db.delete(mod.documentsTable).where(eq(mod.documentsTable.boardId, b.id));
      await db.delete(mod.votesTable).where(eq(mod.votesTable.boardId, b.id));
      await db.delete(mod.meetingsTable).where(eq(mod.meetingsTable.boardId, b.id));
      await db.delete(mod.tasksTable).where(eq(mod.tasksTable.boardId, b.id));
      await db.delete(mod.legalHoldsTable).where(eq(mod.legalHoldsTable.entityId, b.id));
      await db.delete(mod.boardsTable).where(eq(mod.boardsTable.id, b.id));
    }
    const [board] = await db.insert(mod.boardsTable).values({ name: BOARD_NAME, abbreviation: "LH", type: "board" }).returning();
    boardId = board.id;
    adminCookie = await cookieFor(admin.email);
  });

  it("a held document / vote / meeting / task each returns 409 on delete, then deletes after release", async () => {
    // document
    const [doc] = await db.insert(mod.documentsTable).values({ boardId, title: "D", filename: "d.pdf", uploadedBy: null }).returning();
    let holdId = await place("document", doc.id);
    expect((await request(app).delete(`/api/documents/${doc.id}`).set("Cookie", adminCookie)).status).toBe(409);
    await request(app).post(`/api/legal-holds/${holdId}/release`).set("Cookie", adminCookie);
    expect((await request(app).delete(`/api/documents/${doc.id}`).set("Cookie", adminCookie)).status).toBe(204);

    // vote (no ballots, so otherwise deletable)
    const [vote] = await db.insert(mod.votesTable).values({ boardId, resolutionNumber: "LH-1", title: "V", resolutionText: "B", type: "simple" }).returning();
    holdId = await place("vote", vote.id);
    expect((await request(app).delete(`/api/votes/${vote.id}`).set("Cookie", adminCookie)).status).toBe(409);
    await request(app).post(`/api/legal-holds/${holdId}/release`).set("Cookie", adminCookie);
    expect((await request(app).delete(`/api/votes/${vote.id}`).set("Cookie", adminCookie)).status).toBe(204);

    // meeting
    const [meeting] = await db.insert(mod.meetingsTable).values({ boardId, title: "M", date: new Date() }).returning();
    holdId = await place("meeting", meeting.id);
    expect((await request(app).delete(`/api/meetings/${meeting.id}`).set("Cookie", adminCookie)).status).toBe(409);
    await request(app).post(`/api/legal-holds/${holdId}/release`).set("Cookie", adminCookie);
    expect((await request(app).delete(`/api/meetings/${meeting.id}`).set("Cookie", adminCookie)).status).toBe(204);

    // task
    const [task] = await db.insert(mod.tasksTable).values({ boardId, title: "T", taskNumber: "TASK-9999-001" }).returning();
    holdId = await place("task", task.id);
    expect((await request(app).delete(`/api/tasks/${task.id}`).set("Cookie", adminCookie)).status).toBe(409);
    await request(app).post(`/api/legal-holds/${holdId}/release`).set("Cookie", adminCookie);
    expect((await request(app).delete(`/api/tasks/${task.id}`).set("Cookie", adminCookie)).status).toBe(204);
  });

  it("a BOARD-level hold cascades: a document on that board cannot be deleted", async () => {
    const [doc] = await db.insert(mod.documentsTable).values({ boardId, title: "D2", filename: "d2.pdf", uploadedBy: null }).returning();
    await place("board", boardId);
    expect((await request(app).delete(`/api/documents/${doc.id}`).set("Cookie", adminCookie)).status).toBe(409);
  });

  it("placing a hold is audited", async () => {
    const rows = await db.select().from(mod.auditTrailTable).where(eq(mod.auditTrailTable.action, "legal_hold_placed"));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("a non-admin cannot place a hold", async () => {
    const res = await request(app).post("/api/legal-holds").send({ entityType: "board", entityId: boardId, reason: "x" });
    expect([401, 403]).toContain(res.status);
  });
});
