/**
 * P0.8 — the destructive "reset all data" wipe must not exist in a non-demo
 * build. The route is registered only when DEMO_MODE=true, so in the default
 * (production-like) test environment it is physically absent and any method on
 * it 404s. Needs a real Postgres at DATABASE_URL; skips itself otherwise.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

d("system reset-data is absent without DEMO_MODE (P0.8)", () => {
  const admin = { email: "sysreset-admin@test.local", name: "Reset Admin", role: "admin" as const };
  const PASSWORD = "correct-horse-battery";
  let app: any;
  let db: any;
  let mod: any;
  let eq: any;

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
    // The app is imported here; DEMO_MODE is unset in the test env, so the route
    // is never registered. (Asserting the demo-ON case would need a separate
    // module realm; registration-time gating is what the acceptance criterion asks.)
    expect(process.env.DEMO_MODE).not.toBe("true");
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    mod = await import("@workspace/db");
    db = mod.db;
    ({ eq } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    const [existing] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, admin.email));
    if (existing) {
      await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, existing.id));
      await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, existing.id));
    }
    await db.insert(mod.peopleTable).values({ ...admin, passwordHash: await bcrypt.hash(PASSWORD, 10) });
  });

  it("POST /api/system/reset-data 404s with a clean JSON body (route not registered)", async () => {
    const cookie = await cookieFor(admin.email);
    const res = await request(app)
      .post("/api/system/reset-data")
      .set("Cookie", cookie)
      .send({ confirm: "RESET", password: PASSWORD });
    expect(res.status).toBe(404);
    // A4 — must be JSON, not Express's default HTML (which breaks res.json() clients).
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.error).toBeTruthy();
  });

  it("GET /api/system/config reports demoMode=false in a non-demo build", async () => {
    const cookie = await cookieFor(admin.email);
    const res = await request(app).get("/api/system/config").set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.demoMode).toBe(false);
  });
});
