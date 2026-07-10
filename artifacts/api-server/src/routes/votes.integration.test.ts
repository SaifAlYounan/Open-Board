/**
 * Integration tests for governance-correctness of the voting routes: weighted
 * tallies (issue #4) and, below, the authz edges around them. Needs a real
 * Postgres — set DATABASE_URL (and SESSION_SECRET); the suite skips itself when
 * DATABASE_URL is absent so `pnpm test` stays green on machines without a DB.
 */
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

d("votes — weighted voting", () => {
  let app: any;
  let db: any;
  let dbMod: any;
  let eq: any;
  let inArray: any;

  const PASSWORD = "correct-horse-battery";
  const secretary = { email: "wv-sec@test.local", name: "WV Sec", role: "admin" as const };
  const m1 = { email: "wv-m1@test.local", name: "WV Member 1", role: "member" as const };
  const m2 = { email: "wv-m2@test.local", name: "WV Member 2", role: "member" as const };
  const m3 = { email: "wv-m3@test.local", name: "WV Member 3 (heavy)", role: "member" as const };
  const people: Record<string, any> = {};

  // Distinct client IP per request so the per-IP write limiter never trips as
  // the suite accumulates requests (the app trusts one proxy hop).
  let ipCounter = 0;
  const nextIp = () => `10.98.0.${(++ipCounter % 250) + 1}`;

  async function cookieFor(email: string): Promise<string> {
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", nextIp())
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"];
    return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
  }

  /** Wipe every vote (and its children) on a board, then the board itself. */
  async function wipeBoardsNamed(name: string) {
    const { boardsTable, votesTable, voteRecordsTable, voteDocumentsTable, approvalRulesTable, approvalRuleRecusalsTable, approvalRuleRequiredVotersTable, accessControlTable, boardMembershipsTable } = dbMod;
    const { and } = await import("drizzle-orm");
    const stale = await db.select().from(boardsTable).where(eq(boardsTable.name, name));
    for (const b of stale) {
      const votes = await db.select().from(votesTable).where(eq(votesTable.boardId, b.id));
      const voteIds = votes.map((v: any) => v.id);
      if (voteIds.length) {
        await db.delete(voteRecordsTable).where(inArray(voteRecordsTable.voteId, voteIds));
        await db.delete(voteDocumentsTable).where(inArray(voteDocumentsTable.voteId, voteIds));
        const rules = await db.select().from(approvalRulesTable).where(inArray(approvalRulesTable.voteId, voteIds));
        const ruleIds = rules.map((r: any) => r.id);
        if (ruleIds.length) {
          await db.delete(approvalRuleRecusalsTable).where(inArray(approvalRuleRecusalsTable.ruleId, ruleIds));
          await db.delete(approvalRuleRequiredVotersTable).where(inArray(approvalRuleRequiredVotersTable.ruleId, ruleIds));
          await db.delete(approvalRulesTable).where(inArray(approvalRulesTable.id, ruleIds));
        }
        await db.delete(accessControlTable).where(and(eq(accessControlTable.entityType, "vote"), inArray(accessControlTable.entityId, voteIds)));
        await db.delete(votesTable).where(inArray(votesTable.id, voteIds));
      }
      await db.delete(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, b.id));
      await db.delete(boardsTable).where(eq(boardsTable.id, b.id));
    }
  }

  // Explicit resolution numbers: the auto-numbering sequence is created by the
  // seed script, not by `drizzle-kit push`, so a bare test database lacks it.
  let resCounter = 0;
  async function createVote(adminCookie: string, boardId: string, extra: Record<string, unknown> = {}) {
    const res = await request(app)
      .post("/api/votes")
      .set("Cookie", adminCookie)
      .set("X-Forwarded-For", nextIp())
      .send({
        boardId,
        resolutionNumber: `RES-VITEST-${Date.now()}-${++resCounter}`,
        title: "Weighted test resolution",
        resolutionText: "Resolved, that the weighted tally is correct.",
        type: "circulation",
        approvalRule: { type: "majority" },
        ...extra,
      });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function cast(cookie: string, voteId: string, decision: string, body: Record<string, unknown> = {}) {
    return request(app)
      .post(`/api/votes/${voteId}/cast`)
      .set("Cookie", cookie)
      .set("X-Forwarded-For", nextIp())
      .send({ decision, ...body });
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    dbMod = await import("@workspace/db");
    db = dbMod.db;
    ({ eq, inArray } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    const { peopleTable, boardMembershipsTable, auditTrailTable, voteRecordsTable, accessControlTable } = dbMod;
    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const p of [secretary, m1, m2, m3]) {
      const [existing] = await db.select().from(peopleTable).where(eq(peopleTable.email, p.email));
      if (existing) {
        await db.delete(auditTrailTable).where(eq(auditTrailTable.personId, existing.id));
        await db.delete(voteRecordsTable).where(eq(voteRecordsTable.personId, existing.id));
        await db.delete(boardMembershipsTable).where(eq(boardMembershipsTable.personId, existing.id));
        await db.delete(accessControlTable).where(eq(accessControlTable.personId, existing.id));
        await db.delete(peopleTable).where(eq(peopleTable.id, existing.id));
      }
      const [row] = await db.insert(peopleTable).values({ ...p, passwordHash: hash }).returning();
      people[p.email] = row;
    }
  });

  describe("weighted outcome", () => {
    const BOARD = "Weighted Tally Test Board";
    let boardId: string;

    beforeAll(async () => {
      await wipeBoardsNamed(BOARD);
      const [board] = await db.insert(dbMod.boardsTable).values({ name: BOARD, abbreviation: "WTB", type: "board" }).returning();
      boardId = board.id;
      await db.insert(dbMod.boardMembershipsTable).values([
        { boardId, personId: people[m1.email].id, votingWeight: 1 },
        { boardId, personId: people[m2.email].id, votingWeight: 1 },
        { boardId, personId: people[m3.email].id, votingWeight: 3 },
      ]);
    });

    it("a heavy minority outweighs a light head-count majority", async () => {
      const adminCookie = await cookieFor(secretary.email);
      const vote = await createVote(adminCookie, boardId);

      expect((await cast(await cookieFor(m1.email), vote.id, "approved")).status).toBe(200);
      expect((await cast(await cookieFor(m2.email), vote.id, "approved")).status).toBe(200);
      expect((await cast(await cookieFor(m3.email), vote.id, "not_approved")).status).toBe(200);

      const res = await request(app).get(`/api/votes/${vote.id}`).set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      // 2 of 3 heads approved, but only 2 of 5 weight → rejected.
      expect(res.body.approvalsCount).toBe(2);
      expect(res.body.approvalsWeight).toBe(2);
      expect(res.body.totalWeight).toBe(5);
      expect(res.body.castWeight).toBe(5);
      expect(res.body.status).toBe("rejected");
    });

    it("the heavy member alone carries a majority", async () => {
      const adminCookie = await cookieFor(secretary.email);
      const vote = await createVote(adminCookie, boardId);

      expect((await cast(await cookieFor(m1.email), vote.id, "not_approved")).status).toBe(200);
      expect((await cast(await cookieFor(m2.email), vote.id, "not_approved")).status).toBe(200);
      expect((await cast(await cookieFor(m3.email), vote.id, "approved")).status).toBe(200);

      const res = await request(app).get(`/api/votes/${vote.id}`).set("Cookie", adminCookie);
      // 1 of 3 heads approved, but 3 of 5 weight → approved.
      expect(res.body.approvalsWeight).toBe(3);
      expect(res.body.status).toBe("approved");
    });

    it("ballots snapshot the weight they were cast with; a later weight edit does not rewrite them", async () => {
      const adminCookie = await cookieFor(secretary.email);
      const vote = await createVote(adminCookie, boardId);

      expect((await cast(await cookieFor(m1.email), vote.id, "approved")).status).toBe(200);
      expect((await cast(await cookieFor(m2.email), vote.id, "approved")).status).toBe(200);
      expect((await cast(await cookieFor(m3.email), vote.id, "not_approved")).status).toBe(200);

      // Closed as rejected (2 of 5 weight). The certificate must verify…
      const before = await request(app).get(`/api/votes/${vote.id}/certificate/verify`).set("Cookie", adminCookie);
      expect(before.body.verified).toBe(true);
      expect(before.body.hashVersion).toBe(2);

      // …and keep verifying after the heavy member's weight is changed, because
      // the ballots carry their own snapshots.
      const patch = await request(app)
        .patch(`/api/boards/${boardId}/members/${people[m3.email].id}`)
        .set("Cookie", adminCookie)
        .set("X-Forwarded-For", nextIp())
        .send({ votingWeight: 1 });
      expect(patch.status).toBe(200);

      const after = await request(app).get(`/api/votes/${vote.id}/certificate/verify`).set("Cookie", adminCookie);
      expect(after.body.verified).toBe(true);
      expect(after.body.hashVersion).toBe(2);
      expect(after.body.storedHash).toBe(before.body.storedHash);

      // Restore the weight for the rest of the suite.
      await request(app)
        .patch(`/api/boards/${boardId}/members/${people[m3.email].id}`)
        .set("Cookie", adminCookie)
        .set("X-Forwarded-For", nextIp())
        .send({ votingWeight: 3 });
    });

    it("a vote certificate closed before weighted voting still verifies (v1 hash)", async () => {
      const { votesTable, voteRecordsTable, accessControlTable } = dbMod;
      const { computeLegacyCertificateHash } = await import("../lib/voteTally");
      const closedAt = new Date();
      const [legacyVote] = await db
        .insert(votesTable)
        .values({
          boardId,
          resolutionNumber: `WTB-LEGACY-${Date.now()}`,
          title: "Legacy-closed vote",
          resolutionText: "Closed before weights existed.",
          type: "circulation",
          status: "approved",
          closedAt,
        })
        .returning();
      const records = [
        { voteId: legacyVote.id, personId: people[m1.email].id, decision: "approved" as const },
        { voteId: legacyVote.id, personId: people[m2.email].id, decision: "approved" as const },
      ];
      await db.insert(voteRecordsTable).values(records);
      const stored = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.voteId, legacyVote.id));
      const v1 = computeLegacyCertificateHash(legacyVote.id, "approved", closedAt, stored);
      await db.update(votesTable).set({ certificateHash: v1 }).where(eq(votesTable.id, legacyVote.id));

      const adminCookie = await cookieFor(secretary.email);
      const res = await request(app).get(`/api/votes/${legacyVote.id}/certificate/verify`).set("Cookie", adminCookie);
      expect(res.body.verified).toBe(true);
      expect(res.body.hashVersion).toBe(1);

      // Cleanup so board wipes stay simple on rerun.
      await db.delete(voteRecordsTable).where(eq(voteRecordsTable.voteId, legacyVote.id));
      await db.delete(accessControlTable).where(eq(accessControlTable.entityId, legacyVote.id));
      await db.delete(votesTable).where(eq(votesTable.id, legacyVote.id));
    });
  });

  describe("weight=1 regression (classic one-member-one-vote board)", () => {
    const BOARD = "Unweighted Regression Test Board";
    let boardId: string;

    beforeAll(async () => {
      await wipeBoardsNamed(BOARD);
      const [board] = await db.insert(dbMod.boardsTable).values({ name: BOARD, abbreviation: "URB", type: "board" }).returning();
      boardId = board.id;
      // No explicit weights — everything defaults to 1.
      await db.insert(dbMod.boardMembershipsTable).values([
        { boardId, personId: people[m1.email].id },
        { boardId, personId: people[m2.email].id },
        { boardId, personId: people[m3.email].id },
      ]);
    });

    it("2 of 3 approvals carries a simple majority, exactly as before", async () => {
      const adminCookie = await cookieFor(secretary.email);
      const vote = await createVote(adminCookie, boardId);

      expect((await cast(await cookieFor(m1.email), vote.id, "approved")).status).toBe(200);
      expect((await cast(await cookieFor(m2.email), vote.id, "approved")).status).toBe(200);
      expect((await cast(await cookieFor(m3.email), vote.id, "not_approved")).status).toBe(200);

      const res = await request(app).get(`/api/votes/${vote.id}`).set("Cookie", adminCookie);
      expect(res.body.status).toBe("approved");
      // Weight aggregates equal head counts on an unweighted board.
      expect(res.body.totalWeight).toBe(res.body.totalVoters);
      expect(res.body.castWeight).toBe(res.body.votescast);
      expect(res.body.approvalsWeight).toBe(res.body.approvalsCount);

      const verify = await request(app).get(`/api/votes/${vote.id}/certificate/verify`).set("Cookie", adminCookie);
      expect(verify.body.verified).toBe(true);
    });
  });

  describe("weight administration authz", () => {
    const BOARD = "Weight Authz Test Board";
    let boardId: string;

    beforeAll(async () => {
      await wipeBoardsNamed(BOARD);
      const [board] = await db.insert(dbMod.boardsTable).values({ name: BOARD, abbreviation: "WAB", type: "board" }).returning();
      boardId = board.id;
      await db.insert(dbMod.boardMembershipsTable).values([{ boardId, personId: people[m1.email].id }]);
    });

    it("a non-admin cannot change voting weights", async () => {
      const cookie = await cookieFor(m1.email);
      const res = await request(app)
        .patch(`/api/boards/${boardId}/members/${people[m1.email].id}`)
        .set("Cookie", cookie)
        .set("X-Forwarded-For", nextIp())
        .send({ votingWeight: 100 });
      expect(res.status).toBe(403);
    });

    it("rejects non-positive, fractional, and non-numeric weights", async () => {
      const adminCookie = await cookieFor(secretary.email);
      for (const votingWeight of [0, -1, 1.5, "3", 100000] as unknown[]) {
        const res = await request(app)
          .patch(`/api/boards/${boardId}/members/${people[m1.email].id}`)
          .set("Cookie", adminCookie)
          .set("X-Forwarded-For", nextIp())
          .send({ votingWeight });
        expect(res.status, `weight ${JSON.stringify(votingWeight)}`).toBe(400);
      }
    });

    it("an admin can set a valid weight and it is reflected in the member list", async () => {
      const adminCookie = await cookieFor(secretary.email);
      const res = await request(app)
        .patch(`/api/boards/${boardId}/members/${people[m1.email].id}`)
        .set("Cookie", adminCookie)
        .set("X-Forwarded-For", nextIp())
        .send({ votingWeight: 4 });
      expect(res.status).toBe(200);

      const members = await request(app).get(`/api/boards/${boardId}/members`).set("Cookie", adminCookie);
      const row = members.body.find((m: any) => m.personId === people[m1.email].id);
      expect(row.votingWeight).toBe(4);
    });
  });
});
