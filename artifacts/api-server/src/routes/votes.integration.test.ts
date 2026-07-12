/**
 * Integration tests for governance-correctness of the voting routes: weighted
 * tallies (issue #4) and, below, the authz edges around them. Needs a real
 * Postgres — set DATABASE_URL (and SESSION_SECRET); the suite skips itself when
 * DATABASE_URL is absent so `pnpm test` stays green on machines without a DB.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

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
  const obs = { email: "wv-obs@test.local", name: "WV Observer", role: "member" as const };
  const people: Record<string, any> = {};

  // Distinct client IP per request so the per-IP write limiter never trips as
  // the suite accumulates requests (the app trusts one proxy hop).
  let ipCounter = 0;
  const nextIp = () => `10.98.0.${(++ipCounter % 250) + 1}`;

  // Sessions are cached per email: the login endpoint also rate-limits per
  // ACCOUNT (10/window), which a login-per-request suite would exhaust.
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

  /** Wipe every vote (and its children) on a board, then the board itself. */
  async function wipeBoardsNamed(name: string) {
    const { boardsTable, votesTable, voteRecordsTable, voteDocumentsTable, approvalRulesTable, approvalRuleRecusalsTable, approvalRuleRequiredVotersTable, accessControlTable, boardMembershipsTable } = dbMod;
    const { and } = await import("drizzle-orm");
    const stale = await db.select().from(boardsTable).where(eq(boardsTable.name, name));
    for (const b of stale) {
      const votes = await db.select().from(votesTable).where(eq(votesTable.boardId, b.id));
      const voteIds = votes.map((v: any) => v.id);
      if (voteIds.length) {
        await db.delete(dbMod.voteProxiesTable).where(inArray(dbMod.voteProxiesTable.voteId, voteIds));
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
      const meetings = await db.select().from(dbMod.meetingsTable).where(eq(dbMod.meetingsTable.boardId, b.id));
      const meetingIds = meetings.map((m: any) => m.id);
      if (meetingIds.length) {
        await db.delete(dbMod.attendanceTable).where(inArray(dbMod.attendanceTable.meetingId, meetingIds));
        await db.delete(dbMod.meetingsTable).where(inArray(dbMod.meetingsTable.id, meetingIds));
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

    const { peopleTable, boardMembershipsTable, auditTrailTable, voteRecordsTable, accessControlTable, voteProxiesTable } = dbMod;
    const { or } = await import("drizzle-orm");
    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const p of [secretary, m1, m2, m3, obs]) {
      const [existing] = await db.select().from(peopleTable).where(eq(peopleTable.email, p.email));
      if (existing) {
        await db.delete(auditTrailTable).where(eq(auditTrailTable.personId, existing.id));
        await db.delete(voteProxiesTable).where(or(
          eq(voteProxiesTable.principalId, existing.id),
          eq(voteProxiesTable.holderId, existing.id),
          eq(voteProxiesTable.createdBy, existing.id),
        ));
        await db.delete(voteRecordsTable).where(or(
          eq(voteRecordsTable.personId, existing.id),
          eq(voteRecordsTable.castBy, existing.id),
        ));
        await db.delete(dbMod.attendanceTable).where(or(
          eq(dbMod.attendanceTable.personId, existing.id),
          eq(dbMod.attendanceTable.proxyHolderId, existing.id),
        ));
        await db.delete(dbMod.approvalRuleRecusalsTable).where(eq(dbMod.approvalRuleRecusalsTable.personId, existing.id));
        await db.delete(dbMod.approvalRuleRequiredVotersTable).where(eq(dbMod.approvalRuleRequiredVotersTable.personId, existing.id));
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
      // (v3 signed certificates since the external-review fixes.)
      const before = await request(app).get(`/api/votes/${vote.id}/certificate/verify`).set("Cookie", adminCookie);
      expect(before.body.verified).toBe(true);
      expect(before.body.hashVersion).toBe(3);

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
      expect(after.body.hashVersion).toBe(3);

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

  // ── Proxy voting (issue #5) ────────────────────────────────────────────────

  function grantProxy(cookie: string, voteId: string, principalId: string, holderId: string) {
    return request(app)
      .post(`/api/votes/${voteId}/proxies`)
      .set("Cookie", cookie)
      .set("X-Forwarded-For", nextIp())
      .send({ principalId, holderId });
  }

  describe("proxy grants — authz and governance rules", () => {
    const BOARD = "Proxy Grant Rules Board";
    let boardId: string;
    let adminCookie: string;

    beforeAll(async () => {
      await wipeBoardsNamed(BOARD);
      const [board] = await db.insert(dbMod.boardsTable).values({ name: BOARD, abbreviation: "PGB", type: "board" }).returning();
      boardId = board.id;
      await db.insert(dbMod.boardMembershipsTable).values([
        { boardId, personId: people[m1.email].id },
        { boardId, personId: people[m2.email].id },
        { boardId, personId: people[m3.email].id },
        { boardId, personId: people[obs.email].id, roleInBoard: "observer" },
      ]);
      adminCookie = await cookieFor(secretary.email);
    });

    it("totalVoters counts only eligible voters, excluding the observer", async () => {
      // This board has 3 voting members + 1 observer (4 memberships). The
      // displayed totalVoters must be the eligible-voter head count (3) — the
      // same set totalWeight is summed over — not members.length (4).
      const vote = await createVote(adminCookie, boardId);
      const res = await request(app).get(`/api/votes/${vote.id}`).set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.boardMembers).toHaveLength(4);
      expect(res.body.totalVoters).toBe(3);
      expect(res.body.totalWeight).toBe(3);
      expect(res.body.totalVoters).toBe(res.body.totalWeight);
    });

    it("only an admin can record a proxy grant", async () => {
      const vote = await createVote(adminCookie, boardId);
      const memberCookie = await cookieFor(m1.email);
      const res = await request(app)
        .post(`/api/votes/${vote.id}/proxies`)
        .set("Cookie", memberCookie)
        .set("X-Forwarded-For", nextIp())
        .send({ principalId: people[m1.email].id, holderId: people[m2.email].id });
      expect(res.status).toBe(403);
    });

    it("enforces every grant rule: self-proxy, observers, duplicates, delegated holders, the per-board limit, and already-voted principals", async () => {
      const vote = await createVote(adminCookie, boardId);

      // Self-proxy is meaningless.
      expect((await grantProxy(adminCookie, vote.id, people[m1.email].id, people[m1.email].id)).status).toBe(400);
      // Observers can neither grant nor hold.
      expect((await grantProxy(adminCookie, vote.id, people[obs.email].id, people[m2.email].id)).status).toBe(400);
      expect((await grantProxy(adminCookie, vote.id, people[m1.email].id, people[obs.email].id)).status).toBe(400);

      // A valid grant: m1 → m2.
      const ok = await grantProxy(adminCookie, vote.id, people[m1.email].id, people[m2.email].id);
      expect(ok.status).toBe(201);
      expect(ok.body.principalName).toBe(m1.name);
      expect(ok.body.holderName).toBe(m2.name);
      expect(ok.body.used).toBe(false);

      // The principal cannot delegate twice.
      expect((await grantProxy(adminCookie, vote.id, people[m1.email].id, people[m3.email].id)).status).toBe(409);
      // A member who delegated their own ballot cannot hold proxies (m2 → m1: m1 delegated away).
      expect((await grantProxy(adminCookie, vote.id, people[m2.email].id, people[m1.email].id)).status).toBe(409);
      // Default per-board limit is 1: m2 already holds m1's proxy.
      expect((await grantProxy(adminCookie, vote.id, people[m3.email].id, people[m2.email].id)).status).toBe(409);

      // Raising the board's proxyLimit unlocks a second grant for the same holder.
      const bump = await request(app)
        .patch(`/api/boards/${boardId}`)
        .set("Cookie", adminCookie)
        .set("X-Forwarded-For", nextIp())
        .send({ proxyLimit: 2 });
      expect(bump.status).toBe(200);
      expect(bump.body.proxyLimit).toBe(2);
      const second = await grantProxy(adminCookie, vote.id, people[m3.email].id, people[m2.email].id);
      expect(second.status).toBe(201);

      // Restore the default for the rest of the suite.
      await request(app).patch(`/api/boards/${boardId}`).set("Cookie", adminCookie).set("X-Forwarded-For", nextIp()).send({ proxyLimit: 1 });
    });

    it("rejects a grant for a principal who has already voted", async () => {
      const vote = await createVote(adminCookie, boardId);
      expect((await cast(await cookieFor(m1.email), vote.id, "approved")).status).toBe(200);
      const res = await grantProxy(adminCookie, vote.id, people[m1.email].id, people[m2.email].id);
      expect(res.status).toBe(409);
    });

    it("only the designated holder can cast the proxy ballot", async () => {
      const vote = await createVote(adminCookie, boardId);
      expect((await grantProxy(adminCookie, vote.id, people[m1.email].id, people[m2.email].id)).status).toBe(201);

      // m3 holds no grant for m1 → 403.
      const impostor = await cast(await cookieFor(m3.email), vote.id, "approved", { onBehalfOf: people[m1.email].id });
      expect(impostor.status).toBe(403);
      // …and no grant at all for m2 as principal → 403 even for an eligible member.
      const noGrant = await cast(await cookieFor(m3.email), vote.id, "approved", { onBehalfOf: people[m2.email].id });
      expect(noGrant.status).toBe(403);
    });

    it("revocation: an unused grant can be revoked (then casting fails); a used grant cannot", async () => {
      const vote = await createVote(adminCookie, boardId);
      const grant = await grantProxy(adminCookie, vote.id, people[m1.email].id, people[m2.email].id);
      expect(grant.status).toBe(201);

      // Revoke while unused → the holder can no longer cast.
      const revoke = await request(app)
        .delete(`/api/votes/${vote.id}/proxies/${grant.body.id}`)
        .set("Cookie", adminCookie)
        .set("X-Forwarded-For", nextIp());
      expect(revoke.status).toBe(204);
      const afterRevoke = await cast(await cookieFor(m2.email), vote.id, "approved", { onBehalfOf: people[m1.email].id });
      expect(afterRevoke.status).toBe(403);

      // Grant again, use it, then try to revoke → blocked (the principal
      // supersedes by casting in person instead).
      const grant2 = await grantProxy(adminCookie, vote.id, people[m1.email].id, people[m2.email].id);
      expect(grant2.status).toBe(201);
      expect((await cast(await cookieFor(m2.email), vote.id, "approved", { onBehalfOf: people[m1.email].id })).status).toBe(200);
      const revokeUsed = await request(app)
        .delete(`/api/votes/${vote.id}/proxies/${grant2.body.id}`)
        .set("Cookie", adminCookie)
        .set("X-Forwarded-For", nextIp());
      expect(revokeUsed.status).toBe(409);
    });
  });

  describe("proxy casting — attribution, weights, precedence, quorum", () => {
    const BOARD = "Proxy Cast Board";
    let boardId: string;
    let adminCookie: string;

    beforeAll(async () => {
      await wipeBoardsNamed(BOARD);
      const [board] = await db.insert(dbMod.boardsTable).values({ name: BOARD, abbreviation: "PCB", type: "board" }).returning();
      boardId = board.id;
      await db.insert(dbMod.boardMembershipsTable).values([
        { boardId, personId: people[m1.email].id, votingWeight: 1 },
        { boardId, personId: people[m2.email].id, votingWeight: 1 },
        { boardId, personId: people[m3.email].id, votingWeight: 3 },
      ]);
      adminCookie = await cookieFor(secretary.email);
    });

    it("a proxy ballot is recorded against the principal, attributed to the holder, at the principal's weight", async () => {
      const vote = await createVote(adminCookie, boardId);
      // m2 (weight 1) holds the proxy of the HEAVY member m3 (weight 3).
      expect((await grantProxy(adminCookie, vote.id, people[m3.email].id, people[m2.email].id)).status).toBe(201);

      const res = await cast(await cookieFor(m2.email), vote.id, "approved", { onBehalfOf: people[m3.email].id });
      expect(res.status).toBe(200);
      expect(res.body.personId).toBe(people[m3.email].id); // the principal's ballot…
      expect(res.body.castBy).toBe(people[m2.email].id); // …attributed to the holder, never masqueraded
      expect(res.body.weight).toBe(3); // …at the PRINCIPAL's weight
      expect(res.body.person.name).toBe(m3.name);

      // The holder cannot cast the same proxy twice.
      const again = await cast(await cookieFor(m2.email), vote.id, "approved", { onBehalfOf: people[m3.email].id });
      expect(again.status).toBe(409);
    });

    it("proxy ballots count for quorum/closing, and combine with weights in the outcome", async () => {
      const vote = await createVote(adminCookie, boardId);
      expect((await grantProxy(adminCookie, vote.id, people[m1.email].id, people[m2.email].id)).status).toBe(201);

      const m2Cookie = await cookieFor(m2.email);
      expect((await cast(m2Cookie, vote.id, "approved")).status).toBe(200); // m2's own ballot (w1)
      expect((await cast(m2Cookie, vote.id, "approved", { onBehalfOf: people[m1.email].id })).status).toBe(200); // m1's ballot by proxy (w1)
      expect((await cast(await cookieFor(m3.email), vote.id, "not_approved")).status).toBe(200); // m3 in person (w3)

      // All three ballots present (one by proxy) → the vote auto-closed, and
      // the weighted majority (3 of 5 against) rejected it.
      const detail = await request(app).get(`/api/votes/${vote.id}`).set("Cookie", adminCookie);
      expect(detail.body.votescast).toBe(3);
      expect(detail.body.castWeight).toBe(5);
      expect(detail.body.approvalsWeight).toBe(2);
      expect(detail.body.status).toBe("rejected");

      // On an open (non-secret) ballot the certificate discloses the proxy
      // relationship — to members too, with the holder attributed by name.
      const memberCert = await request(app).get(`/api/votes/${vote.id}/certificate`).set("Cookie", await cookieFor(m2.email));
      expect(memberCert.body.proxies.length).toBe(1);
      expect(memberCert.body.proxies[0].principalName).toBe(m1.name);
      expect(memberCert.body.proxies[0].holderName).toBe(m2.name);
      expect(memberCert.body.proxies[0].used).toBe(true);
      const proxiedRecord = memberCert.body.voteRecords.find((r: any) => r.personId === people[m1.email].id);
      expect(proxiedRecord.castBy).toBe(people[m2.email].id);
      expect(proxiedRecord.castByName).toBe(m2.name);

      // The certificate hash covers the proxy attribution: tampering castBy
      // breaks verification.
      const verifyOk = await request(app).get(`/api/votes/${vote.id}/certificate/verify`).set("Cookie", adminCookie);
      expect(verifyOk.body.verified).toBe(true);
      expect(verifyOk.body.hashVersion).toBe(3);
      const { voteRecordsTable } = dbMod;
      const { and: andOp } = await import("drizzle-orm");
      await db.update(voteRecordsTable).set({ castBy: null })
        .where(andOp(eq(voteRecordsTable.voteId, vote.id), eq(voteRecordsTable.personId, people[m1.email].id)));
      const verifyTampered = await request(app).get(`/api/votes/${vote.id}/certificate/verify`).set("Cookie", adminCookie);
      expect(verifyTampered.body.verified).toBe(false);
      await db.update(voteRecordsTable).set({ castBy: people[m2.email].id })
        .where(andOp(eq(voteRecordsTable.voteId, vote.id), eq(voteRecordsTable.personId, people[m1.email].id)));
    });

    it("precedence: the principal's own later cast supersedes the proxy ballot (audit-logged); the reverse is rejected", async () => {
      const vote = await createVote(adminCookie, boardId);
      expect((await grantProxy(adminCookie, vote.id, people[m1.email].id, people[m2.email].id)).status).toBe(201);

      // Holder casts approved for the principal…
      expect((await cast(await cookieFor(m2.email), vote.id, "approved", { onBehalfOf: people[m1.email].id })).status).toBe(200);

      // …then the principal shows up and votes the other way: SUPERSEDES.
      const own = await cast(await cookieFor(m1.email), vote.id, "not_approved");
      expect(own.status).toBe(200);
      expect(own.body.personId).toBe(people[m1.email].id);
      expect(own.body.castBy).toBeNull();
      expect(own.body.decision).toBe("not_approved");

      // Exactly one ballot exists for the principal.
      const { voteRecordsTable, auditTrailTable } = dbMod;
      const { and: andOp } = await import("drizzle-orm");
      const ballots = await db.select().from(voteRecordsTable)
        .where(andOp(eq(voteRecordsTable.voteId, vote.id), eq(voteRecordsTable.personId, people[m1.email].id)));
      expect(ballots.length).toBe(1);
      expect(ballots[0].decision).toBe("not_approved");
      expect(ballots[0].castBy).toBeNull();

      // The supersession is on the audit trail.
      const auditRows = await db.select().from(auditTrailTable)
        .where(andOp(eq(auditTrailTable.action, "vote_proxy_superseded"), eq(auditTrailTable.entityId, vote.id)));
      expect(auditRows.length).toBe(1);
      expect((auditRows[0].details as any).principalId).toBe(people[m1.email].id);
      expect((auditRows[0].details as any).previousCastBy).toBe(people[m2.email].id);

      // The principal cannot supersede twice (their ballot is now their own)…
      expect((await cast(await cookieFor(m1.email), vote.id, "approved")).status).toBe(409);
      // …and the holder cannot proxy-cast over the principal's own ballot.
      expect((await cast(await cookieFor(m2.email), vote.id, "approved", { onBehalfOf: people[m1.email].id })).status).toBe(409);
    });
  });

  describe("proxy voting on secret ballots", () => {
    const BOARD = "Proxy Secret Board";
    let boardId: string;
    let adminCookie: string;
    let voteId: string;

    beforeAll(async () => {
      await wipeBoardsNamed(BOARD);
      const [board] = await db.insert(dbMod.boardsTable).values({ name: BOARD, abbreviation: "PSB", type: "board" }).returning();
      boardId = board.id;
      await db.insert(dbMod.boardMembershipsTable).values([
        { boardId, personId: people[m1.email].id },
        { boardId, personId: people[m2.email].id },
        { boardId, personId: people[m3.email].id },
      ]);
      adminCookie = await cookieFor(secretary.email);
      const vote = await createVote(adminCookie, boardId, { secret: true });
      voteId = vote.id;
      expect((await grantProxy(adminCookie, voteId, people[m1.email].id, people[m2.email].id)).status).toBe(201);
      expect((await cast(await cookieFor(m2.email), voteId, "approved", { onBehalfOf: people[m1.email].id })).status).toBe(200);
    });

    it("a proxy-cast secret ballot is invisible to uninvolved members", async () => {
      const res = await request(app).get(`/api/votes/${voteId}`).set("Cookie", await cookieFor(m3.email));
      expect(res.status).toBe(200);
      expect(res.body.voteRecords).toEqual([]); // m3 cast nothing and holds nothing
      // Aggregates stay visible, as for any secret ballot.
      expect(res.body.votescast).toBe(1);
    });

    it("the holder sees the ballot they cast; the principal sees their own ballot", async () => {
      const holderView = await request(app).get(`/api/votes/${voteId}`).set("Cookie", await cookieFor(m2.email));
      const holderVisible = holderView.body.voteRecords.map((r: any) => r.personId);
      expect(holderVisible).toContain(people[m1.email].id); // the ballot they cast as proxy
      const principalView = await request(app).get(`/api/votes/${voteId}`).set("Cookie", await cookieFor(m1.email));
      expect(principalView.body.hasVoted).toBe(true);
      expect(principalView.body.voteRecords.map((r: any) => r.personId)).toEqual([people[m1.email].id]);
    });

    it("the secret certificate withholds records AND proxy relationships from non-admins", async () => {
      const memberCert = await request(app).get(`/api/votes/${voteId}/certificate`).set("Cookie", await cookieFor(m3.email));
      expect(memberCert.body.voteRecords).toEqual([]);
      expect(memberCert.body.proxies).toEqual([]);
      const adminCert = await request(app).get(`/api/votes/${voteId}/certificate`).set("Cookie", adminCookie);
      expect(adminCert.body.voteRecords.length).toBe(1);
      expect(adminCert.body.proxies.length).toBe(1);
      expect(adminCert.body.proxies[0].used).toBe(true);
    });

    it("after the principal supersedes, the ex-holder loses sight of the new secret ballot", async () => {
      expect((await cast(await cookieFor(m1.email), voteId, "not_approved")).status).toBe(200);
      const holderView = await request(app).get(`/api/votes/${voteId}`).set("Cookie", await cookieFor(m2.email));
      // The superseded ballot has castBy = null now — the ex-holder only sees
      // their own ballot (none cast) → nothing of m1's new secret ballot.
      expect(holderView.body.voteRecords.map((r: any) => r.personId)).not.toContain(people[m1.email].id);
    });
  });

  describe("abstentions (external-review item 2)", () => {
    const BOARD = "Abstention Test Board";
    let boardId: string;
    let adminCookie: string;

    beforeAll(async () => {
      await wipeBoardsNamed(BOARD);
      const [board] = await db.insert(dbMod.boardsTable).values({ name: BOARD, abbreviation: "ABT", type: "board" }).returning();
      boardId = board.id;
      await db.insert(dbMod.boardMembershipsTable).values([
        { boardId, personId: people[m1.email].id, votingWeight: 1 },
        { boardId, personId: people[m2.email].id, votingWeight: 1 },
        { boardId, personId: people[m3.email].id, votingWeight: 1 },
      ]);
      adminCookie = await cookieFor(secretary.email);
    });

    it("an abstained ballot is accepted, closes the vote, and drops out of the majority denominator", async () => {
      const vote = await createVote(adminCookie, boardId);

      expect((await cast(await cookieFor(m1.email), vote.id, "approved")).status).toBe(200);
      expect((await cast(await cookieFor(m2.email), vote.id, "abstained")).status).toBe(200);
      expect((await cast(await cookieFor(m3.email), vote.id, "abstained")).status).toBe(200);

      const res = await request(app).get(`/api/votes/${vote.id}`).set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      // All three cast (abstention participates) → the vote closed…
      expect(res.body.votescast).toBe(3);
      expect(res.body.castWeight).toBe(3);
      expect(res.body.abstainCount).toBe(2);
      expect(res.body.abstainWeight).toBe(2);
      // …and the majority is of votes cast for-or-against: 1 of 1 → approved.
      // (A majority-of-eligible reading would have rejected 1 of 3.)
      expect(res.body.status).toBe("approved");
    });

    it("everyone abstaining approves nothing", async () => {
      const vote = await createVote(adminCookie, boardId);
      for (const m of [m1, m2, m3]) {
        expect((await cast(await cookieFor(m.email), vote.id, "abstained")).status).toBe(200);
      }
      const res = await request(app).get(`/api/votes/${vote.id}`).set("Cookie", adminCookie);
      expect(res.body.status).toBe("rejected");
    });

    it("an abstention defeats default (written-consent) unanimity", async () => {
      const vote = await createVote(adminCookie, boardId, { approvalRule: { type: "unanimous" } });
      expect((await cast(await cookieFor(m1.email), vote.id, "approved")).status).toBe(200);
      expect((await cast(await cookieFor(m2.email), vote.id, "approved")).status).toBe(200);
      expect((await cast(await cookieFor(m3.email), vote.id, "abstained")).status).toBe(200);
      const res = await request(app).get(`/api/votes/${vote.id}`).set("Cookie", adminCookie);
      expect(res.body.status).toBe("rejected");
    });

    it("unanimity-of-votes-cast (configured) lets an abstainer stand aside", async () => {
      const vote = await createVote(adminCookie, boardId, { approvalRule: { type: "unanimous", denominatorBasis: "cast" } });
      expect((await cast(await cookieFor(m1.email), vote.id, "approved")).status).toBe(200);
      expect((await cast(await cookieFor(m2.email), vote.id, "approved")).status).toBe(200);
      expect((await cast(await cookieFor(m3.email), vote.id, "abstained")).status).toBe(200);
      const res = await request(app).get(`/api/votes/${vote.id}`).set("Cookie", adminCookie);
      expect(res.body.status).toBe("approved");
    });

    it("abstaining never requires a comment", async () => {
      const vote = await createVote(adminCookie, boardId);
      const res = await cast(await cookieFor(m1.email), vote.id, "abstained");
      expect(res.status).toBe(200);
      expect(res.body.decision).toBe("abstained");
    });
  });

  describe("meeting-vote quorum measured over attendance (external-review item 3)", () => {
    const BOARD = "Attendance Quorum Board";
    let boardId: string;
    let adminCookie: string;

    async function createMeetingVote(quorum: number) {
      const [meeting] = await db.insert(dbMod.meetingsTable).values({
        boardId,
        title: "Attendance quorum test meeting",
        date: new Date(),
        status: "concluded",
      }).returning();
      // Only m1 and m2 are present; m3 is marked absent.
      await db.insert(dbMod.attendanceTable).values([
        { meetingId: meeting.id, personId: people[m1.email].id, status: "confirmed" },
        { meetingId: meeting.id, personId: people[m2.email].id, status: "confirmed" },
        { meetingId: meeting.id, personId: people[m3.email].id, status: "absent" },
      ]);
      return createVote(adminCookie, boardId, {
        type: "meeting",
        meetingId: meeting.id,
        approvalRule: { type: "majority", quorum },
      });
    }

    beforeAll(async () => {
      await wipeBoardsNamed(BOARD);
      const [board] = await db.insert(dbMod.boardsTable).values({ name: BOARD, abbreviation: "AQB", type: "board" }).returning();
      boardId = board.id;
      await db.insert(dbMod.boardMembershipsTable).values([
        { boardId, personId: people[m1.email].id, votingWeight: 1 },
        { boardId, personId: people[m2.email].id, votingWeight: 1 },
        { boardId, personId: people[m3.email].id, votingWeight: 1 },
      ]);
      adminCookie = await cookieFor(secretary.email);
    });

    it("a meeting vote fails quorum when attendance is short — even though every ballot approved", async () => {
      // Quorum 3, attendance weight 2 (m3 absent). All three members cast
      // approvals — the OLD code measured quorum over ballots cast (3 ≥ 3 →
      // approved); quorum attaches to who is PRESENT, so this must reject.
      const vote = await createMeetingVote(3);
      for (const m of [m1, m2, m3]) {
        expect((await cast(await cookieFor(m.email), vote.id, "approved")).status).toBe(200);
      }
      const res = await request(app).get(`/api/votes/${vote.id}`).set("Cookie", adminCookie);
      expect(res.body.status).toBe("rejected");
    });

    it("the same vote carries when the attendance pool meets the quorum", async () => {
      const vote = await createMeetingVote(2); // attendance weight 2 ≥ 2
      for (const m of [m1, m2, m3]) {
        expect((await cast(await cookieFor(m.email), vote.id, "approved")).status).toBe(200);
      }
      const res = await request(app).get(`/api/votes/${vote.id}`).set("Cookie", adminCookie);
      expect(res.body.status).toBe("approved");
    });

    it("a circulation vote keeps the ballots-cast quorum basis", async () => {
      const vote = await createVote(adminCookie, boardId, { approvalRule: { type: "majority", quorum: 3 } });
      for (const m of [m1, m2, m3]) {
        expect((await cast(await cookieFor(m.email), vote.id, "approved")).status).toBe(200);
      }
      const res = await request(app).get(`/api/votes/${vote.id}`).set("Cookie", adminCookie);
      expect(res.body.status).toBe("approved");
    });
  });

  describe("recusals as recorded facts (external-review item 2)", () => {
    const BOARD = "Recusal Facts Board";
    let boardId: string;
    let adminCookie: string;
    let voteId: string;

    beforeAll(async () => {
      await wipeBoardsNamed(BOARD);
      const [board] = await db.insert(dbMod.boardsTable).values({ name: BOARD, abbreviation: "RFB", type: "board" }).returning();
      boardId = board.id;
      await db.insert(dbMod.boardMembershipsTable).values([
        { boardId, personId: people[m1.email].id },
        { boardId, personId: people[m2.email].id },
        { boardId, personId: people[m3.email].id },
      ]);
      adminCookie = await cookieFor(secretary.email);
      const vote = await createVote(adminCookie, boardId, {
        secret: true,
        approvalRule: {
          type: "majority",
          recusedIds: [people[m3.email].id],
          recusalReasons: { [people[m3.email].id]: "Counterparty to the contract under resolution" },
        },
      });
      voteId = vote.id;
    });

    it("the vote payload names who is recused and why", async () => {
      const res = await request(app).get(`/api/votes/${voteId}`).set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.recusals).toEqual([
        {
          personId: people[m3.email].id,
          name: m3.name,
          reason: "Counterparty to the contract under resolution",
        },
      ]);
    });

    it("the certificate discloses the recusal even on a secret ballot", async () => {
      expect((await cast(await cookieFor(m1.email), voteId, "approved")).status).toBe(200);
      expect((await cast(await cookieFor(m2.email), voteId, "approved")).status).toBe(200);
      // Non-admin member view of a SECRET vote: ballots withheld, recusal shown.
      const res = await request(app).get(`/api/votes/${voteId}/certificate`).set("Cookie", await cookieFor(m1.email));
      expect(res.status).toBe(200);
      expect(res.body.voteRecords).toEqual([]);
      expect(res.body.recusals.length).toBe(1);
      expect(res.body.recusals[0].personId).toBe(people[m3.email].id);
      expect(res.body.recusals[0].reason).toBe("Counterparty to the contract under resolution");
    });
  });
});
