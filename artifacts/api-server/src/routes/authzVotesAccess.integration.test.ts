/**
 * A6 — one access model across entities, proven on votes. Needs Postgres.
 *
 * Two guarantees the old snapshot-grant model got wrong:
 *   - a member added AFTER a vote was created sees it in BOTH the list and detail
 *     (old model: snapshot taken at creation → late member saw neither, yet the
 *     per-entity check leaked detail access — a list/detail inconsistency);
 *   - a member REMOVED from the board loses access (old model: the snapshot grant
 *     row outlived membership → the deprovisioning leak).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

d("vote access — live membership, no snapshot (A6)", () => {
  const BOARD_NAME = "Vote Access A6 Board";
  const admin = { email: "va6-admin@test.local", name: "VA Admin", role: "admin" as const };
  const early = { email: "va6-early@test.local", name: "VA Early", role: "member" as const };
  const late = { email: "va6-late@test.local", name: "VA Late", role: "member" as const };
  const leaver = { email: "va6-leaver@test.local", name: "VA Leaver", role: "member" as const };
  const outsider = { email: "va6-outsider@test.local", name: "VA Outsider", role: "member" as const };
  const PEOPLE = [admin, early, late, leaver, outsider];
  const PASSWORD = "correct-horse-battery";

  let app: any, db: any, mod: any, eq: any, and: any;
  let boardId: string, voteId: string;
  const id: Record<string, string> = {};

  let ip = 0;
  async function cookieFor(email: string): Promise<string> {
    const res = await request(app).post("/api/auth/login").set("X-Forwarded-For", `10.44.0.${++ip}`).send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const c = res.headers["set-cookie"];
    return (Array.isArray(c) ? c[0] : c).split(";")[0];
  }
  const sees = async (email: string) => {
    const cookie = await cookieFor(email);
    const detail = await request(app).get(`/api/votes/${voteId}`).set("Cookie", cookie);
    const list = await request(app).get("/api/votes").set("Cookie", cookie);
    return { detail: detail.status, inList: (list.body as any[]).map((v) => v.id).includes(voteId) };
  };

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    mod = await import("@workspace/db");
    db = mod.db;
    ({ eq, and } = await import("drizzle-orm"));
    app = (await import("../app")).default;
    const hash = await bcrypt.hash(PASSWORD, 10);

    for (const p of PEOPLE) {
      const [ex] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, p.email));
      if (ex) {
        await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, ex.id));
        await db.delete(mod.accessControlTable).where(eq(mod.accessControlTable.personId, ex.id));
        await db.delete(mod.boardMembershipsTable).where(eq(mod.boardMembershipsTable.personId, ex.id));
        await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, ex.id));
      }
    }
    for (const b of await db.select().from(mod.boardsTable).where(eq(mod.boardsTable.name, BOARD_NAME))) {
      await db.delete(mod.votesTable).where(eq(mod.votesTable.boardId, b.id));
      await db.delete(mod.boardMembershipsTable).where(eq(mod.boardMembershipsTable.boardId, b.id));
      await db.delete(mod.boardsTable).where(eq(mod.boardsTable.id, b.id));
    }
    for (const p of PEOPLE) {
      await db.insert(mod.peopleTable).values({ ...p, passwordHash: hash });
      const [row] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, p.email));
      id[p.email] = row.id;
    }
    const [board] = await db.insert(mod.boardsTable).values({ name: BOARD_NAME, abbreviation: "VA6", type: "board" }).returning();
    boardId = board.id;
    for (const p of [admin, early, leaver]) {
      await db.insert(mod.boardMembershipsTable).values({ boardId, personId: id[p.email], roleInBoard: "member" });
    }
    // Vote created with NO snapshot grants (grantDefaultAccess no longer snapshots members).
    const [vote] = await db.insert(mod.votesTable).values({ boardId, resolutionNumber: "VA6-001", title: "T", resolutionText: "B", type: "simple" }).returning();
    voteId = vote.id;
    // `late` joins the board AFTER the vote exists.
    await db.insert(mod.boardMembershipsTable).values({ boardId, personId: id[late.email], roleInBoard: "member" });
  });

  it("a member present at creation sees the vote (list + detail)", async () => {
    expect(await sees(early.email)).toEqual({ detail: 200, inList: true });
  });

  it("a member added AFTER creation sees it too — list AND detail agree", async () => {
    expect(await sees(late.email)).toEqual({ detail: 200, inList: true });
  });

  it("a non-member sees nothing", async () => {
    const r = await sees(outsider.email);
    expect(r.detail).toBe(403);
    expect(r.inList).toBe(false);
  });

  it("removing a member from the board revokes access (no snapshot to linger)", async () => {
    // leaver can see it while a member...
    expect((await sees(leaver.email)).inList).toBe(true);
    // ...then leaves the board.
    await db.delete(mod.boardMembershipsTable).where(and(eq(mod.boardMembershipsTable.boardId, boardId), eq(mod.boardMembershipsTable.personId, id[leaver.email])));
    const r = await sees(leaver.email);
    expect(r.detail).toBe(403);
    expect(r.inList).toBe(false);
  });
});
