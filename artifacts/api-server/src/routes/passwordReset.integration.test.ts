/**
 * Integration tests for the password-reset hardening (Authn #3/#4/#5).
 * Needs a real Postgres at DATABASE_URL; skips itself otherwise.
 *
 *   #5 — a reset token is single-use (atomic consume): the second use fails.
 *   #3/#5 — issuing a new token invalidates the prior unused token.
 *   #4 — a deactivated account cannot reset its password.
 */
import crypto from "crypto";
import { describe, it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

d("password reset hardening", () => {
  const PASSWORD = "correct-horse-battery";
  const active = { email: "pr-active@test.local", name: "PR Active", role: "member" as const, active: true };
  const inactive = { email: "pr-inactive@test.local", name: "PR Inactive", role: "member" as const, active: false };

  let app: any;
  let db: any;
  let mod: any;
  let eq: any;

  let ipCounter = 0;
  const nextIp = () => `10.66.0.${(++ipCounter % 250) + 1}`;

  async function insertToken(personId: string): Promise<string> {
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    await db.insert(mod.passwordResetTokensTable).values({
      personId,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    return token;
  }

  async function idFor(email: string): Promise<string> {
    const [row] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, email));
    return row.id;
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    mod = await import("@workspace/db");
    db = mod.db;
    ({ eq } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const p of [active, inactive]) {
      const [existing] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, p.email));
      if (existing) {
        await db.delete(mod.passwordResetTokensTable).where(eq(mod.passwordResetTokensTable.personId, existing.id));
        await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, existing.id));
        await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, existing.id));
      }
      await db.insert(mod.peopleTable).values({ ...p, passwordHash: hash });
    }
  });

  it("#5: a reset token is single-use — the second reset with the same token fails", async () => {
    const personId = await idFor(active.email);
    const token = await insertToken(personId);

    const first = await request(app)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", nextIp())
      .send({ token, newPassword: "first-new-password-123" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", nextIp())
      .send({ token, newPassword: "second-new-password-123" });
    expect(second.status).toBe(400);
  });

  it("#3/#5: requesting a new reset invalidates the prior unused token", async () => {
    const personId = await idFor(active.email);
    const oldToken = await insertToken(personId);

    // A new forgot-password request should mark the old token used and issue a new one.
    const forgot = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", nextIp())
      .send({ email: active.email });
    expect(forgot.status).toBe(200);

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", nextIp())
      .send({ token: oldToken, newPassword: "should-not-work-123456" });
    expect(reset.status).toBe(400);
  });

  it("#4: a deactivated account cannot reset its password even with a valid token", async () => {
    const personId = await idFor(inactive.email);
    const token = await insertToken(personId);

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", nextIp())
      .send({ token, newPassword: "inactive-reset-attempt-123" });
    expect(reset.status).toBe(400);
  });

  it("#4: forgot-password for a deactivated account still returns the generic response", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", nextIp())
      .send({ email: inactive.email });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "If that email is registered, a reset link has been sent." });
  });
});
