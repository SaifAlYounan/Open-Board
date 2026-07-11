/**
 * Integration tests for the observer / board-less authorization fixes (F1, F2, F3).
 * Needs a real Postgres at DATABASE_URL; skips itself otherwise (mirrors the
 * other *.integration.test.ts files).
 *
 *   F1 — an observer must not upload vote materials (POST /votes/:id/documents).
 *   F2 — an observer must not comment on minutes (POST /minutes/:id/comments).
 *   F3 — a non-admin must not read board-less minutes (GET /minutes/:id).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

d("observer / board-less authorization", () => {
  const BOARD_NAME = "Observer Authz Test Board";
  const admin = { email: "authz-admin@test.local", name: "Authz Admin", role: "admin" as const };
  // Global role is a plain member; the observer restriction is at the BOARD level.
  const observer = { email: "authz-observer@test.local", name: "Authz Observer", role: "member" as const };
  const outsider = { email: "authz-outsider@test.local", name: "Authz Outsider", role: "member" as const };
  const PASSWORD = "correct-horse-battery";

  let app: any;
  let db: any;
  let mod: any;
  let eq: any;
  let boardId: string;
  let voteId: string;
  let meetingMinutesId: string;
  let boardlessMinutesId: string;

  let ipCounter = 0;
  async function cookieFor(email: string): Promise<string> {
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", `10.77.0.${++ipCounter}`)
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"];
    return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    mod = await import("@workspace/db");
    db = mod.db;
    ({ eq } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    const hash = await bcrypt.hash(PASSWORD, 10);

    // Re-runnable cleanup: tear down anything left by a prior run.
    for (const p of [admin, observer, outsider]) {
      const [existing] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, p.email));
      if (existing) {
        await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, existing.id));
        await db.delete(mod.accessControlTable).where(eq(mod.accessControlTable.personId, existing.id));
        await db.delete(mod.boardMembershipsTable).where(eq(mod.boardMembershipsTable.personId, existing.id));
        await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, existing.id));
      }
    }
    for (const b of await db.select().from(mod.boardsTable).where(eq(mod.boardsTable.name, BOARD_NAME))) {
      const meetings = await db.select().from(mod.meetingsTable).where(eq(mod.meetingsTable.boardId, b.id));
      for (const m of meetings) {
        const mins = await db.select().from(mod.minutesTable).where(eq(mod.minutesTable.meetingId, m.id));
        for (const mn of mins) {
          await db.delete(mod.minutesSuggestionsTable).where(eq(mod.minutesSuggestionsTable.minutesId, mn.id));
          await db.delete(mod.minutesTable).where(eq(mod.minutesTable.id, mn.id));
        }
        await db.delete(mod.meetingsTable).where(eq(mod.meetingsTable.id, m.id));
      }
      const votes = await db.select().from(mod.votesTable).where(eq(mod.votesTable.boardId, b.id));
      for (const v of votes) {
        await db.delete(mod.voteDocumentsTable).where(eq(mod.voteDocumentsTable.voteId, v.id));
        await db.delete(mod.votesTable).where(eq(mod.votesTable.id, v.id));
      }
      await db.delete(mod.boardMembershipsTable).where(eq(mod.boardMembershipsTable.boardId, b.id));
      await db.delete(mod.boardsTable).where(eq(mod.boardsTable.id, b.id));
    }

    for (const p of [admin, observer, outsider]) {
      await db.insert(mod.peopleTable).values({ ...p, passwordHash: hash });
    }
    const [adminRow] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, admin.email));
    const [observerRow] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, observer.email));

    const [board] = await db
      .insert(mod.boardsTable)
      .values({ name: BOARD_NAME, abbreviation: "OAB", type: "board" })
      .returning();
    boardId = board.id;
    await db.insert(mod.boardMembershipsTable).values({ boardId, personId: adminRow.id, roleInBoard: "secretary" });
    await db.insert(mod.boardMembershipsTable).values({ boardId, personId: observerRow.id, roleInBoard: "observer" });

    // A vote the observer has explicit (board-default) access to read.
    const [vote] = await db
      .insert(mod.votesTable)
      .values({ boardId, resolutionNumber: "OAB-001", title: "Test", resolutionText: "Body", type: "simple" })
      .returning();
    voteId = vote.id;
    await db.insert(mod.accessControlTable).values({ entityType: "vote", entityId: voteId, personId: observerRow.id, hasAccess: true });

    // Minutes attached to a board meeting (for the comment test).
    const [meeting] = await db
      .insert(mod.meetingsTable)
      .values({ boardId, title: "Meeting", date: new Date() })
      .returning();
    const [mMin] = await db
      .insert(mod.minutesTable)
      .values({ meetingId: meeting.id, content: "Minutes content", status: "signing" })
      .returning();
    meetingMinutesId = mMin.id;

    // Board-less minutes (no meeting) — F3 target. Non-draft so the draft guard
    // is not what blocks it.
    const [blMin] = await db
      .insert(mod.minutesTable)
      .values({ content: "Board-less minutes", status: "signed" })
      .returning();
    boardlessMinutesId = blMin.id;
  });

  it("F1: an observer cannot upload vote materials (403)", async () => {
    const cookie = await cookieFor(observer.email);
    const res = await request(app)
      .post(`/api/votes/${voteId}/documents`)
      .set("Cookie", cookie)
      .attach("file", Buffer.from("hello"), "note.txt");
    expect(res.status).toBe(403);
  });

  it("F2: an observer cannot comment on minutes (403)", async () => {
    const cookie = await cookieFor(observer.email);
    const res = await request(app)
      .post(`/api/minutes/${meetingMinutesId}/comments`)
      .set("Cookie", cookie)
      .send({ originalText: "some text", commentText: "a comment" });
    expect(res.status).toBe(403);
  });

  it("F3: a non-admin cannot read board-less minutes (403)", async () => {
    const cookie = await cookieFor(outsider.email);
    const res = await request(app).get(`/api/minutes/${boardlessMinutesId}`).set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("F3: an admin can still read board-less minutes (200)", async () => {
    const cookie = await cookieFor(admin.email);
    const res = await request(app).get(`/api/minutes/${boardlessMinutesId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
  });
});
