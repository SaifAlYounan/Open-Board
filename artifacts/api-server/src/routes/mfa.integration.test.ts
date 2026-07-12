import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { generateSync } from "otplib";
import { integrationSuite } from "../testutil/integrationSuite";

/**
 * P0.2 acceptance (F7): **a valid password alone cannot reach any sign /
 * approve / export route.**
 *
 * Also covers the flow's integrity properties: login yields a CHALLENGE (not a
 * session) once a factor is enrolled; an unconfirmed enrollment is not a
 * factor; a TOTP code cannot be replayed; recovery codes are single-use; and
 * an admin cannot disarm their own mandatory gate.
 */
integrationSuite("TOTP MFA (P0.2)", () => {
  const PASSWORD = "Str0ng-Passw0rd-For-Tests!";
  const adminEmail = "p02-admin@test.local";
  const memberEmail = "p02-member@test.local";
  const BOARD_NAME = "P02 MFA Board";

  let db: any;
  let mod: any;
  let eq: any;
  let app: any;
  let adminId: string;
  let minutesId: string;

  let ipCounter = 0;
  async function login(email: string): Promise<any> {
    return request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", `10.84.0.${++ipCounter}`)
      .send({ email, password: PASSWORD });
  }

  function codeFor(secret: string): string {
    return generateSync({ strategy: "totp", secret });
  }

  async function credOfAdmin(): Promise<any> {
    const [cred] = await db
      .select()
      .from(mod.mfaCredentialsTable)
      .where(eq(mod.mfaCredentialsTable.personId, adminId));
    return cred;
  }

  /**
   * Fast-forward past the replay ledger.
   *
   * Replay protection consumes a 30-second window on every accepted code, so a
   * suite that signs in repeatedly inside ONE real window is (correctly)
   * refused the second time. A real user simply waits for the next window;
   * rather than sleep 30 s per test, the tests below clear the consumed-step
   * marker to stand in for that wait. The dedicated replay test does NOT call
   * this — that is the whole point of it.
   */
  async function nextWindow(): Promise<void> {
    await db
      .update(mod.mfaCredentialsTable)
      .set({ lastUsedStep: null })
      .where(eq(mod.mfaCredentialsTable.personId, adminId));
  }

  /**
   * Exchange a challenge for a session. Kept separate from `login` because the
   * challenge is NOT single-use within its 5-minute life — a user who fat-fingers
   * their code retries on the same screen — so tests reuse one challenge for
   * several attempts rather than re-hitting the (real) login throttle.
   */
  async function verifyMfa(mfaToken: string, code: string): Promise<any> {
    return request(app)
      .post("/api/auth/mfa/verify")
      .set("X-Forwarded-For", `10.83.0.${++ipCounter}`)
      .send({ mfaToken, code });
  }

  /** Sign in fully: password → challenge → TOTP → session. */
  async function mfaLogin(): Promise<any> {
    const cred = await credOfAdmin();
    const challenge = (await login(adminEmail)).body.mfaToken;
    return verifyMfa(challenge, codeFor(cred.secret));
  }

  function cookieOf(res: any): string {
    const setCookie = res.headers["set-cookie"];
    return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    mod = await import("@workspace/db");
    db = mod.db;
    ({ eq } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    const hash = await bcrypt.hash(PASSWORD, 12);

    // Re-runnable cleanup.
    for (const email of [adminEmail, memberEmail]) {
      const [existing] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, email));
      if (existing) {
        await db.delete(mod.mfaRecoveryCodesTable).where(eq(mod.mfaRecoveryCodesTable.personId, existing.id));
        await db.delete(mod.mfaCredentialsTable).where(eq(mod.mfaCredentialsTable.personId, existing.id));
        // A prior run's signature (this suite signs minutes) references the person.
        await db.delete(mod.minutesSignaturesTable).where(eq(mod.minutesSignaturesTable.personId, existing.id));
        await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, existing.id));
        await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.personId, existing.id));
        await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.actorId, existing.id));
        await db.delete(mod.boardMembershipsTable).where(eq(mod.boardMembershipsTable.personId, existing.id));
        await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, existing.id));
      }
    }
    for (const b of await db.select().from(mod.boardsTable).where(eq(mod.boardsTable.name, BOARD_NAME))) {
      const meetings = await db.select().from(mod.meetingsTable).where(eq(mod.meetingsTable.boardId, b.id));
      for (const m of meetings) {
        const mins = await db.select().from(mod.minutesTable).where(eq(mod.minutesTable.meetingId, m.id));
        for (const mi of mins) {
          await db.delete(mod.minutesSignaturesTable).where(eq(mod.minutesSignaturesTable.minutesId, mi.id));
          await db.delete(mod.accessControlTable).where(eq(mod.accessControlTable.entityId, mi.id));
          await db.delete(mod.minutesTable).where(eq(mod.minutesTable.id, mi.id));
        }
        await db.delete(mod.accessControlTable).where(eq(mod.accessControlTable.entityId, m.id));
        await db.delete(mod.meetingsTable).where(eq(mod.meetingsTable.id, m.id));
      }
      await db.delete(mod.boardMembershipsTable).where(eq(mod.boardMembershipsTable.boardId, b.id));
      await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.entityId, b.id));
      await db.delete(mod.boardsTable).where(eq(mod.boardsTable.id, b.id));
    }

    await db.insert(mod.peopleTable).values({ name: "P02 Admin", email: adminEmail, role: "admin", passwordHash: hash });
    await db.insert(mod.peopleTable).values({ name: "P02 Member", email: memberEmail, role: "member", passwordHash: hash });
    const [admin] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, adminEmail));
    adminId = admin.id;

    // A meeting + minutes in `signing` state, so the sign route is reachable
    // apart from the MFA gate.
    const [board] = await db
      .insert(mod.boardsTable)
      .values({ name: BOARD_NAME, abbreviation: "P02", type: "board" })
      .returning();
    const [meeting] = await db
      .insert(mod.meetingsTable)
      .values({ boardId: board.id, title: "P02 Meeting", date: new Date() })
      .returning();
    const [minutes] = await db
      .insert(mod.minutesTable)
      .values({ meetingId: meeting.id, content: "<p>P02 minutes body.</p>", status: "signing" })
      .returning();
    minutesId = minutes.id;
  });

  describe("a password-only session cannot reach the binding routes", () => {
    it("password alone → 403 on sign, approve, reject, and export", async () => {
      const res = await login(adminEmail);
      expect(res.status).toBe(200);
      // No factor enrolled yet: a session IS issued, but flagged for enrollment...
      expect(res.body.mfaEnrollmentRequired).toBe(true);
      const cookie = cookieOf(res);

      // ...and every binding route refuses it.
      const sign = await request(app).post(`/api/minutes/${minutesId}/sign`).set("Cookie", cookie).send({});
      expect(sign.status).toBe(403);
      expect(sign.body.code).toBe("mfa_enrollment_required");

      const exportRes = await request(app).get("/api/system/export").set("Cookie", cookie);
      expect(exportRes.status).toBe(403);
      expect(exportRes.body.code).toBe("mfa_enrollment_required");

      const approve = await request(app)
        .post(`/api/pending-actions/00000000-0000-4000-8000-000000000000/approve`)
        .set("Cookie", cookie)
        .send({});
      expect(approve.status).toBe(403);
      expect(approve.body.code).toBe("mfa_enrollment_required");

      const reject = await request(app)
        .post(`/api/pending-actions/00000000-0000-4000-8000-000000000000/reject`)
        .set("Cookie", cookie)
        .send({});
      expect(reject.status).toBe(403);
      expect(reject.body.code).toBe("mfa_enrollment_required");
    });

    it("the minutes signature route is genuinely reachable once MFA is satisfied (the gate is the only thing blocking it)", async () => {
      // Enroll the admin end to end.
      const cookie = cookieOf(await login(adminEmail));

      const begin = await request(app).post("/api/mfa/enroll/begin").set("Cookie", cookie).send({});
      expect(begin.status).toBe(200);
      expect(begin.body.secret).toBeTruthy();
      expect(begin.body.otpauthUri).toContain("otpauth://totp/");
      const secret = begin.body.secret;

      // An UNCONFIRMED enrollment is not a factor — the gate still refuses.
      const preConfirm = await request(app).get("/api/system/export").set("Cookie", cookie);
      expect(preConfirm.status).toBe(403);
      expect(preConfirm.body.code).toBe("mfa_enrollment_required");

      const confirm = await request(app)
        .post("/api/mfa/enroll/confirm")
        .set("Cookie", cookie)
        .send({ code: generateSync({ strategy: "totp", secret }) });
      expect(confirm.status).toBe(200);
      expect(confirm.body.enrolled).toBe(true);
      expect(confirm.body.recoveryCodes).toHaveLength(10);

      // The confirm response upgrades this session to an MFA session.
      const mfaCookie = cookieOf(confirm);
      const exportRes = await request(app).get("/api/system/export").set("Cookie", mfaCookie);
      expect(exportRes.status).toBe(200);
      expect(exportRes.body.people).toBeTruthy();

      // Signing is now PAST the MFA gate: it no longer answers with an MFA code.
      // It answers with the NEXT requirement — the signing passphrase (P0.1) —
      // which is what proves the gate itself is satisfied.
      const sign = await request(app).post(`/api/minutes/${minutesId}/sign`).set("Cookie", mfaCookie).send({});
      expect(sign.status).toBe(400);
      expect(sign.body.code).toBe("signing_passphrase_required");
    });
  });

  describe("login with a factor enrolled", () => {
    it("returns a CHALLENGE, not a session — and the challenge alone is not a session", async () => {
      const res = await login(adminEmail);
      expect(res.status).toBe(200);
      expect(res.body.mfaRequired).toBe(true);
      expect(res.body.mfaToken).toBeTruthy();
      expect(res.body.user).toBeUndefined();
      // No session cookie was set by a password-only step.
      expect(res.headers["set-cookie"]).toBeUndefined();
    });

    it("the challenge token cannot be used as a session (no password-only MFA bypass)", async () => {
      const challenge = (await login(adminEmail)).body.mfaToken;
      expect(challenge).toBeTruthy();

      // The attack: send the challenge (obtained with the password alone) as a
      // Bearer token to a requireAuth route. It must be rejected — it is not a
      // session, only exchangeable at /auth/mfa/verify.
      const asBearer = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${challenge}`);
      expect(asBearer.status).toBe(401);

      const asCookie = await request(app).get("/api/auth/me").set("Cookie", `token=${challenge}`);
      expect(asCookie.status).toBe(401);

      // And it cannot cast a vote either (a requireAuth-only route).
      const vote = await request(app)
        .post("/api/votes/00000000-0000-4000-8000-000000000000/cast")
        .set("Authorization", `Bearer ${challenge}`)
        .send({ decision: "approved" });
      expect(vote.status).toBe(401);
    });

    it("a wrong code is refused; a correct code mints the session", async () => {
      await nextWindow();
      const cred = await credOfAdmin();
      const challenge = (await login(adminEmail)).body.mfaToken;

      const bad = await verifyMfa(challenge, "000000");
      expect(bad.status).toBe(401);

      // Same challenge, right code — a wrong attempt does not burn the sign-in.
      const good = await verifyMfa(challenge, codeFor(cred.secret));
      expect(good.status).toBe(200);
      expect(good.body.user.email).toBe(adminEmail);

      // The minted session reaches a gated route.
      const exportRes = await request(app).get("/api/system/export").set("Cookie", cookieOf(good));
      expect(exportRes.status).toBe(200);
    });

    it("a TOTP code cannot be replayed within its window", async () => {
      // Deliberately NO nextWindow() between the two attempts — that is the point.
      await nextWindow();
      const cred = await credOfAdmin();
      const code = codeFor(cred.secret);
      const challenge = (await login(adminEmail)).body.mfaToken;

      const first = await verifyMfa(challenge, code);
      expect(first.status).toBe(200);

      // Same code, same 30-second window → replay refused.
      const replay = await verifyMfa(challenge, code);
      expect(replay.status).toBe(401);
    });

    it("a recovery code works once and only once", async () => {
      await nextWindow();
      const sessionRes = await mfaLogin();
      expect(sessionRes.status).toBe(200);
      const cookie = cookieOf(sessionRes);

      // Re-issue a known set (requires the password).
      const reissue = await request(app)
        .post("/api/mfa/recovery-codes")
        .set("Cookie", cookie)
        .send({ password: PASSWORD });
      expect(reissue.status).toBe(200);
      const [recoveryCode] = reissue.body.recoveryCodes;

      // A recovery code carries no TOTP window — it works on its own.
      const challenge = (await login(adminEmail)).body.mfaToken;
      const used = await verifyMfa(challenge, recoveryCode);
      expect(used.status).toBe(200);
      expect(used.body.usedRecoveryCode).toBe(true);
      expect(used.body.remainingRecoveryCodes).toBe(9);

      const reused = await verifyMfa(challenge, recoveryCode);
      expect(reused.status).toBe(401);
    });

    it("an admin cannot remove their own mandatory second factor", async () => {
      await nextWindow();
      const session = await mfaLogin();
      expect(session.status).toBe(200);
      const cookie = cookieOf(session);
      await nextWindow();
      const cred = await credOfAdmin();

      const removed = await request(app)
        .delete("/api/mfa")
        .set("Cookie", cookie)
        .send({ password: PASSWORD, code: codeFor(cred.secret) });
      expect(removed.status).toBe(403);
    });
  });

  describe("MFA policy", () => {
    it("MFA is required for an admin, and for a member once they hold a non-observer board seat", async () => {
      const { mfaRequiredFor } = await import("../lib/mfa");
      const [member] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, memberEmail));
      const [board] = await db.select().from(mod.boardsTable).where(eq(mod.boardsTable.name, BOARD_NAME));

      expect(await mfaRequiredFor(adminId, "admin")).toBe(true);
      // No board seat yet.
      expect(await mfaRequiredFor(member.id, "member")).toBe(false);

      await db.insert(mod.boardMembershipsTable).values({ boardId: board.id, personId: member.id, roleInBoard: "member" });
      expect(await mfaRequiredFor(member.id, "member")).toBe(true);

      // An observer seat carries no voting/signing power.
      await db
        .update(mod.boardMembershipsTable)
        .set({ roleInBoard: "observer" })
        .where(eq(mod.boardMembershipsTable.personId, member.id));
      expect(await mfaRequiredFor(member.id, "member")).toBe(false);
    });
  });
});
