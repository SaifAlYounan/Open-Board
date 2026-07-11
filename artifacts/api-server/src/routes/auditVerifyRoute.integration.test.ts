/**
 * P0.6 — GET /api/audit/verify is wired and admin-gated. The verifier's
 * correctness is unit-tested in lib/auditVerify.test.ts (the shared audit table
 * across parallel workers makes intact-ness non-deterministic); here we only
 * assert the route exists, requires admin, and returns the verifier's shape.
 * Needs a real Postgres at DATABASE_URL; skips itself otherwise.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

d("audit verify route (P0.6)", () => {
  const admin = { email: "auditvroute-admin@test.local", name: "AV Admin", role: "admin" as const };
  const member = { email: "auditvroute-member@test.local", name: "AV Member", role: "member" as const };
  const PASSWORD = "correct-horse-battery";
  let app: any;
  let db: any;
  let mod: any;
  let eq: any;

  let ipCounter = 0;
  async function cookieFor(email: string): Promise<string> {
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", `10.55.0.${++ipCounter}`)
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
    for (const p of [admin, member]) {
      const [existing] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, p.email));
      if (existing) {
        await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, existing.id));
        await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, existing.id));
      }
      await db.insert(mod.peopleTable).values({ ...p, passwordHash: await bcrypt.hash(PASSWORD, 10) });
    }
  });

  it("unauthenticated is rejected", async () => {
    const res = await request(app).get("/api/audit/verify");
    expect([401, 403]).toContain(res.status);
  });

  it("a non-admin is rejected", async () => {
    const cookie = await cookieFor(member.email);
    const res = await request(app).get("/api/audit/verify").set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  it("an admin gets the verifier result shape (200 intact or 409 broken)", async () => {
    const cookie = await cookieFor(admin.email);
    const res = await request(app).get("/api/audit/verify").set("Cookie", cookie);
    expect([200, 409]).toContain(res.status);
    expect(typeof res.body.ok).toBe("boolean");
    expect(typeof res.body.count).toBe("number");
    expect(res.status === 200 ? res.body.ok : !res.body.ok).toBe(true);
  });
});
