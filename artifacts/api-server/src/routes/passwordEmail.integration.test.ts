/**
 * Integration tests for password-email delivery (issue #6). Needs a real
 * Postgres — the suite skips itself when DATABASE_URL is absent, same
 * convention as the other integration suites.
 *
 * The core guarantee under test: email delivery is strictly additive — the
 * forgot-password response is byte-identical for known and unknown emails
 * (no user enumeration), and only the side-effect (the send) differs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

d("password emails — forgot-password + admin invite", () => {
  let app: any;
  let db: any;
  let dbMod: any;
  let eq: any;
  let mailer: any;

  const PASSWORD = "correct-horse-battery";
  const known = { email: "pe-known@test.local", name: "PE Known", role: "member" as const };
  const admin = { email: "pe-admin@test.local", name: "PE Admin", role: "admin" as const };
  const invitee = { email: "pe-invitee@test.local", name: "PE Invitee" };

  // Distinct client IP per request so the per-IP limiter never trips.
  let ipCounter = 0;
  const nextIp = () => `10.97.0.${(++ipCounter % 250) + 1}`;

  // Recording fake transport — lets us assert exactly which sends happened
  // without any SMTP. Sends are fire-and-forget, so tests poll `sent`.
  const sent: any[] = [];
  const fakeTransport = {
    sendMail: async (opts: any) => {
      sent.push(opts);
      return { messageId: `fake-${sent.length}` };
    },
  };

  async function waitForSends(count: number, ms = 2000): Promise<void> {
    const start = Date.now();
    while (sent.length < count && Date.now() - start < ms) {
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  async function wipePeople(emails: string[]) {
    const { peopleTable, auditTrailTable, passwordResetTokensTable } = dbMod;
    const { inArray } = await import("drizzle-orm");
    const rows = await db.select().from(peopleTable).where(inArray(peopleTable.email, emails));
    const ids = rows.map((r: any) => r.id);
    if (ids.length) {
      await db.delete(passwordResetTokensTable).where(inArray(passwordResetTokensTable.personId, ids));
      await db.delete(auditTrailTable).where(inArray(auditTrailTable.personId, ids));
      await db.delete(peopleTable).where(inArray(peopleTable.id, ids));
    }
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    dbMod = await import("@workspace/db");
    db = dbMod.db;
    ({ eq } = await import("drizzle-orm"));
    app = (await import("../app")).default;
    mailer = await import("../lib/mailer");
    mailer._setTransportForTests(fakeTransport);

    await wipePeople([known.email, admin.email, invitee.email]);
    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const p of [known, admin]) {
      await db.insert(dbMod.peopleTable).values({ ...p, passwordHash: hash });
    }
  });

  afterAll(async () => {
    mailer._setTransportForTests(undefined);
    await wipePeople([known.email, admin.email, invitee.email]);
  });

  it("forgot-password responds identically for known and unknown emails", async () => {
    const resKnown = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", nextIp())
      .send({ email: known.email });
    const resUnknown = await request(app)
      .post("/api/auth/forgot-password")
      .set("X-Forwarded-For", nextIp())
      .send({ email: "pe-nobody@test.local" });

    expect(resKnown.status).toBe(200);
    expect(resUnknown.status).toBe(200);
    // Byte-identical bodies — no enumeration signal.
    expect(resUnknown.body).toEqual(resKnown.body);
  });

  it("sends the reset email for the known address only, with a working token link", async () => {
    await waitForSends(1);
    // Exactly one send from the previous test: the known email.
    expect(sent.length).toBe(1);
    expect(sent[0].to).toBe(known.email);
    expect(sent[0].text).toContain("/reset-password?token=");

    // The emailed token actually resets the password (reuses the stored flow).
    const token = sent[0].text.match(/token=([0-9a-f]+)/)?.[1];
    expect(token).toBeTruthy();
    const reset = await request(app)
      .post("/api/auth/reset-password")
      .set("X-Forwarded-For", nextIp())
      .send({ token, newPassword: "a-brand-new-password-123" });
    expect(reset.status).toBe(200);
  });

  it("admin-created user with generated password gets an invite email with a link, never the password", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", nextIp())
      .send({ email: admin.email, password: PASSWORD });
    expect(login.status).toBe(200);
    const setCookie = login.headers["set-cookie"];
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];

    const before = sent.length;
    const create = await request(app)
      .post("/api/people")
      .set("Cookie", cookie)
      .set("X-Forwarded-For", nextIp())
      .send({ email: invitee.email, name: invitee.name, role: "member" }); // no password → generated
    expect(create.status).toBe(201);
    expect(create.body.oneTimePassword).toBeTruthy(); // secretary flow unchanged

    await waitForSends(before + 1);
    expect(sent.length).toBe(before + 1);
    const invite = sent[sent.length - 1];
    expect(invite.to).toBe(invitee.email);
    expect(invite.text).toContain("/reset-password?token=");
    // The generated one-time password must never appear in the email.
    expect(invite.text).not.toContain(create.body.oneTimePassword);
    expect(invite.html).not.toContain(create.body.oneTimePassword);
  });
});
