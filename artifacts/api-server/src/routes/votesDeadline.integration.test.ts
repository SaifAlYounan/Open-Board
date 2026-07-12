/**
 * External-review item 4 — deadlineBehavior was stored, rendered in the UI,
 * and never fired: no scheduler, no lazy check, `lapsed` reachable only by a
 * manual admin PATCH. Enforcement is now lazy (read/cast paths) + an hourly
 * sweep. These tests drive the real routes end to end.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

d("vote deadline enforcement", () => {
  let app: any;
  let db: any;
  let dbMod: any;
  let eq: any;

  const PASSWORD = "correct-horse-battery";
  const admin = { email: "ddl-admin@test.local", name: "DDL Admin", role: "admin" as const };
  const m1 = { email: "ddl-m1@test.local", name: "DDL M1", role: "member" as const };
  const m2 = { email: "ddl-m2@test.local", name: "DDL M2", role: "member" as const };
  const people: Record<string, any> = {};
  let boardId: string;

  let ipCounter = 0;
  const nextIp = () => `10.96.0.${(++ipCounter % 250) + 1}`;
  const cookieCache: Record<string, string> = {};
  async function cookieFor(email: string): Promise<string> {
    if (cookieCache[email]) return cookieCache[email];
    const res = await request(app).post("/api/auth/login").set("X-Forwarded-For", nextIp()).send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"];
    cookieCache[email] = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
    return cookieCache[email];
  }

  let resCounter = 0;
  /** Create an open vote, then backdate its deadline in SQL (the API rightly has no "create expired vote" path). */
  async function expiredVote(rule: Record<string, unknown>) {
    const created = await request(app)
      .post("/api/votes")
      .set("Cookie", await cookieFor(admin.email))
      .set("X-Forwarded-For", nextIp())
      .send({
        boardId,
        resolutionNumber: `RES-DDL-${Date.now()}-${++resCounter}`,
        title: "Deadline test resolution",
        resolutionText: "Resolved, that deadlines actually fire.",
        type: "circulation",
        deadline: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        approvalRule: rule,
      });
    expect(created.status).toBe(201);
    await db
      .update(dbMod.votesTable)
      .set({ deadline: new Date(Date.now() - 60 * 1000) })
      .where(eq(dbMod.votesTable.id, created.body.id));
    return created.body.id as string;
  }

  async function getVote(voteId: string) {
    const res = await request(app).get(`/api/votes/${voteId}`).set("Cookie", await cookieFor(admin.email));
    expect(res.status).toBe(200);
    return res.body;
  }

  async function auditCount(action: string, voteId: string) {
    const { and: andOp } = await import("drizzle-orm");
    const rows = await db
      .select()
      .from(dbMod.auditTrailTable)
      .where(andOp(eq(dbMod.auditTrailTable.action, action), eq(dbMod.auditTrailTable.entityId, voteId)));
    return rows.length;
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    dbMod = await import("@workspace/db");
    db = dbMod.db;
    ({ eq } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const p of [admin, m1, m2]) {
      const { or } = await import("drizzle-orm");
      const [existing] = await db.select().from(dbMod.peopleTable).where(eq(dbMod.peopleTable.email, p.email));
      if (existing) {
        await db.delete(dbMod.auditTrailTable).where(eq(dbMod.auditTrailTable.personId, existing.id));
        await db.delete(dbMod.voteRecordsTable).where(or(eq(dbMod.voteRecordsTable.personId, existing.id), eq(dbMod.voteRecordsTable.castBy, existing.id)));
        await db.delete(dbMod.boardMembershipsTable).where(eq(dbMod.boardMembershipsTable.personId, existing.id));
        await db.delete(dbMod.accessControlTable).where(eq(dbMod.accessControlTable.personId, existing.id));
        await db.delete(dbMod.peopleTable).where(eq(dbMod.peopleTable.id, existing.id));
      }
      const [row] = await db.insert(dbMod.peopleTable).values({ ...p, passwordHash: hash }).returning();
      people[p.email] = row;
    }
    const [board] = await db.insert(dbMod.boardsTable).values({ name: `Deadline Board ${Date.now()}`, abbreviation: "DDL", type: "board" }).returning();
    boardId = board.id;
    await db.insert(dbMod.boardMembershipsTable).values([
      { boardId, personId: people[m1.email].id },
      { boardId, personId: people[m2.email].id },
    ]);
  });

  it("lapse (default): a read of an expired open vote lapses it, mints a signed certificate, and audits", async () => {
    const voteId = await expiredVote({ type: "majority" });
    const body = await getVote(voteId);
    expect(body.status).toBe("lapsed");
    expect(body.closedAt).toBeTruthy();
    expect(body.certificateVersion).toBe(3);
    expect(await auditCount("vote_lapsed_deadline", voteId)).toBe(1);
  });

  it("a late ballot is refused under lapse — the policy decides, not the accident of nobody reading", async () => {
    const voteId = await expiredVote({ type: "majority" });
    const cast = await request(app)
      .post(`/api/votes/${voteId}/cast`)
      .set("Cookie", await cookieFor(m1.email))
      .set("X-Forwarded-For", nextIp())
      .send({ decision: "approved" });
    expect(cast.status).toBe(400);
    expect(cast.body.error).toMatch(/not open/i);
    const body = await getVote(voteId);
    expect(body.status).toBe("lapsed");
  });

  it("extend: pushes the deadline once by extendDays, stays open, accepts a late ballot — then lapses after the extension passes", async () => {
    const voteId = await expiredVote({ type: "majority", deadlineBehavior: "extend", extendDays: 3 });

    // First touch: extended, still open, deadline moved ~3 days forward.
    const afterExtend = await getVote(voteId);
    expect(afterExtend.status).toBe("open");
    expect(afterExtend.deadlineExtendedAt).toBeTruthy();
    const msAhead = new Date(afterExtend.deadline).getTime() - Date.now();
    expect(msAhead).toBeGreaterThan(2.9 * 24 * 60 * 60 * 1000);
    expect(msAhead).toBeLessThan(3.1 * 24 * 60 * 60 * 1000);
    expect(await auditCount("vote_deadline_extended", voteId)).toBe(1);

    // A late ballot is ACCEPTED under extend.
    const cast = await request(app)
      .post(`/api/votes/${voteId}/cast`)
      .set("Cookie", await cookieFor(m1.email))
      .set("X-Forwarded-For", nextIp())
      .send({ decision: "approved" });
    expect(cast.status).toBe(200);

    // The extension is ONCE: when the extended deadline also passes, it lapses.
    await db.update(dbMod.votesTable).set({ deadline: new Date(Date.now() - 1000) }).where(eq(dbMod.votesTable.id, voteId));
    const afterSecond = await getVote(voteId);
    expect(afterSecond.status).toBe("lapsed");
    expect(await auditCount("vote_deadline_extended", voteId)).toBe(1);
    expect(await auditCount("vote_lapsed_deadline", voteId)).toBe(1);
  });

  it("notify: audits exactly once and the vote stays open across repeated reads", async () => {
    const voteId = await expiredVote({ type: "majority", deadlineBehavior: "notify" });
    const first = await getVote(voteId);
    expect(first.status).toBe("open");
    expect(first.deadlineNotifiedAt).toBeTruthy();
    await getVote(voteId);
    await getVote(voteId);
    expect(await auditCount("vote_deadline_notify", voteId)).toBe(1);
  });

  it("idempotent under concurrency: parallel policy applications lapse exactly once", async () => {
    const voteId = await expiredVote({ type: "majority" });
    const { applyDeadlinePolicy } = await import("../lib/voteDeadline");
    const outcomes = await Promise.all(Array.from({ length: 5 }, () => applyDeadlinePolicy(voteId)));
    expect(outcomes.filter((o) => o === "lapsed").length).toBe(1);
    expect(outcomes.filter((o) => o === "noop").length).toBe(4);
    expect(await auditCount("vote_lapsed_deadline", voteId)).toBe(1);
  });

  it("the sweep closes expired votes nobody reads", async () => {
    const voteId = await expiredVote({ type: "majority" });
    const { sweepExpiredVotes } = await import("../lib/voteDeadline");
    await sweepExpiredVotes();
    const [vote] = await db.select().from(dbMod.votesTable).where(eq(dbMod.votesTable.id, voteId));
    expect(vote.status).toBe("lapsed");
    expect(vote.certificateVersion).toBe(3);
  });

  it("the list route applies the policy to expired open votes on the page", async () => {
    const voteId = await expiredVote({ type: "majority" });
    const res = await request(app).get(`/api/votes?boardId=${boardId}`).set("Cookie", await cookieFor(admin.email));
    expect(res.status).toBe(200);
    const row = res.body.find((v: any) => v.id === voteId);
    expect(row.status).toBe("lapsed");
  });
});
