/**
 * Integration tests for the security-critical routes. These need a real Postgres
 * — set DATABASE_URL (and SESSION_SECRET) before running; the suite skips itself
 * when DATABASE_URL is absent so `pnpm test` stays green on machines without a DB.
 * CI provides a throwaway Postgres service (see .github/workflows/ci.yml).
 */
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

d("security routes", () => {
  let app: any;
  let db: any;
  let peopleTable: any;
  let boardsTable: any;
  let boardMembershipsTable: any;

  // A person that exists but shares no board with our member.
  const secretary = { email: "sec@test.local", name: "Sec", role: "admin" as const };
  const memberA = { email: "a@test.local", name: "Member A", role: "member" as const };
  const memberB = { email: "b@test.local", name: "Member B", role: "member" as const };
  const PASSWORD = "correct-horse-battery";

  // Each login gets a distinct client IP (the app trusts one proxy hop) so the
  // suite never trips the per-IP login rate limit as tests accumulate.
  let ipCounter = 0;
  async function cookieFor(email: string): Promise<string> {
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", `10.99.0.${++ipCounter}`)
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"];
    return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    const dbMod = await import("@workspace/db");
    db = dbMod.db;
    peopleTable = dbMod.peopleTable;
    boardsTable = dbMod.boardsTable;
    boardMembershipsTable = dbMod.boardMembershipsTable;
    app = (await import("../app")).default;

    const { eq } = await import("drizzle-orm");
    const auditTrailTable = dbMod.auditTrailTable;
    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const p of [secretary, memberA, memberB]) {
      // Audit rows reference people (no cascade) — clear them first so the
      // suite is re-runnable against a persistent local database.
      const [existing] = await db.select().from(peopleTable).where(eq(peopleTable.email, p.email));
      if (existing) {
        await db.delete(auditTrailTable).where(eq(auditTrailTable.personId, existing.id));
        await db.delete(peopleTable).where(eq(peopleTable.id, existing.id));
      }
      await db.insert(peopleTable).values({ ...p, passwordHash: hash });
    }
  });

  it("rejects login for a wrong password", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: memberA.email, password: "nope" });
    expect(res.status).toBe(401);
  });

  it("lets a member log in and read their own profile", async () => {
    const cookie = await cookieFor(memberA.email);
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(memberA.email);
  });

  it("does not leak another (non-shared-board) person's record to a member", async () => {
    const { eq } = await import("drizzle-orm");
    const [b] = await db.select().from(peopleTable).where(eq(peopleTable.email, memberB.email));
    const cookie = await cookieFor(memberA.email);
    const res = await request(app).get(`/api/people/${b.id}`).set("Cookie", cookie);
    // Member A shares no board with B → 404 (no existence disclosure).
    expect(res.status).toBe(404);
  });

  it("blocks a member from admin-only people listing", async () => {
    const cookie = await cookieFor(memberA.email);
    const res = await request(app).get("/api/people").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("revokes the token on logout — the old cookie is dead server-side", async () => {
    const cookie = await cookieFor(memberB.email);
    const before = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(before.status).toBe(200);

    const out = await request(app).post("/api/auth/logout").set("Cookie", cookie);
    expect(out.status).toBe(200);

    // A captured copy of the pre-logout token must no longer authenticate.
    const stale = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(stale.status).toBe(401);
  });

  it("logout without a valid session still succeeds (idempotent)", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(200);
    const garbage = await request(app).post("/api/auth/logout").set("Cookie", "token=not-a-jwt");
    expect(garbage.status).toBe(200);
  });

  it("invalidates the session after a password change", async () => {
    const cookie = await cookieFor(memberA.email);
    const change = await request(app)
      .post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: PASSWORD, newPassword: "a-brand-new-passphrase" });
    expect(change.status).toBe(200);
    // The old cookie's token version no longer matches → rejected.
    const stale = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(stale.status).toBe(401);
    // Restore the password for idempotent reruns.
    const { eq } = await import("drizzle-orm");
    const hash = await bcrypt.hash(PASSWORD, 10);
    await db.update(peopleTable).set({ passwordHash: hash }).where(eq(peopleTable.email, memberA.email));
  });
});
