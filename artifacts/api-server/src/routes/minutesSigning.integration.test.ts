import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { generateSync } from "otplib";
import { integrationSuite } from "../testutil/integrationSuite";

/**
 * P0.1 acceptance (F6 — the headline). The plan's bar, literally:
 *
 *   a signed-minutes export verifies OFFLINE with no DB, and FAILS on
 *   (a) a one-character content change, (b) a signer-id change, and
 *   (c) a SQL-forged signature row.
 *
 * Plus the property that gives the signature its meaning: the server cannot
 * sign for the user — signing without the passphrase is impossible, and a
 * wrong passphrase is refused.
 */
integrationSuite("per-user minutes signing (P0.1)", () => {
  const PASSWORD = "Str0ng-Passw0rd-For-Tests!";
  const SIGNING_PASSPHRASE = "correct-horse-battery-staple";
  const adminEmail = "p01-admin@test.local";
  const BOARD_NAME = "P01 Signing Board";

  let db: any;
  let mod: any;
  let eq: any;
  let app: any;
  let adminId: string;
  let adminCookie: string;
  let minutesId: string;
  let boardId: string;
  let fingerprint: string;

  const VERIFIER = path.join(process.cwd(), "scripts", "verify-minutes.mjs");

  /** Run the OFFLINE verifier as a real subprocess — no app code in scope. */
  function verifyOffline(bundle: unknown, extraArgs: string[] = []): { code: number; out: string } {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "p01-")), "bundle.json");
    fs.writeFileSync(file, JSON.stringify(bundle, null, 2));
    try {
      const out = execFileSync("node", [VERIFIER, file, ...extraArgs], { encoding: "utf8" });
      return { code: 0, out };
    } catch (err: any) {
      return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    mod = await import("@workspace/db");
    db = mod.db;
    ({ eq } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    const hash = await bcrypt.hash(PASSWORD, 12);

    // Re-runnable cleanup.
    const [existing] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, adminEmail));
    if (existing) {
      await db.delete(mod.minutesSignaturesTable).where(eq(mod.minutesSignaturesTable.personId, existing.id));
      await db.delete(mod.signingKeysTable).where(eq(mod.signingKeysTable.personId, existing.id));
      await db.delete(mod.mfaRecoveryCodesTable).where(eq(mod.mfaRecoveryCodesTable.personId, existing.id));
      await db.delete(mod.mfaCredentialsTable).where(eq(mod.mfaCredentialsTable.personId, existing.id));
      await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, existing.id));
      await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.personId, existing.id));
      await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.actorId, existing.id));
      await db.delete(mod.boardMembershipsTable).where(eq(mod.boardMembershipsTable.personId, existing.id));
      await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, existing.id));
    }
    for (const b of await db.select().from(mod.boardsTable).where(eq(mod.boardsTable.name, BOARD_NAME))) {
      for (const m of await db.select().from(mod.meetingsTable).where(eq(mod.meetingsTable.boardId, b.id))) {
        for (const mi of await db.select().from(mod.minutesTable).where(eq(mod.minutesTable.meetingId, m.id))) {
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

    await db.insert(mod.peopleTable).values({ name: "P01 Admin", email: adminEmail, role: "admin", passwordHash: hash });
    const [admin] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, adminEmail));
    adminId = admin.id;

    const [board] = await db
      .insert(mod.boardsTable)
      .values({ name: BOARD_NAME, abbreviation: "P01", type: "board" })
      .returning();
    boardId = board.id;
    const [meeting] = await db
      .insert(mod.meetingsTable)
      .values({ boardId: board.id, title: "P01 Meeting", date: new Date() })
      .returning();
    const [minutes] = await db
      .insert(mod.minutesTable)
      .values({
        meetingId: meeting.id,
        content: "<p>RESOLVED THAT the budget of AED 4,000,000 be approved.</p>",
        status: "signing",
      })
      .returning();
    minutesId = minutes.id;

    // Sign in and satisfy the P0.2 MFA gate (signing is MFA-gated).
    const login = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "10.82.0.1")
      .send({ email: adminEmail, password: PASSWORD });
    expect(login.status).toBe(200);
    let cookie = (login.headers["set-cookie"][0] as string).split(";")[0];

    const begin = await request(app).post("/api/mfa/enroll/begin").set("Cookie", cookie).send({});
    expect(begin.status).toBe(200);
    const confirm = await request(app)
      .post("/api/mfa/enroll/confirm")
      .set("Cookie", cookie)
      .send({ code: generateSync({ strategy: "totp", secret: begin.body.secret }) });
    expect(confirm.status).toBe(200);
    adminCookie = (confirm.headers["set-cookie"][0] as string).split(";")[0];

    // Enroll the signing key — the passphrase wraps the private half.
    const key = await request(app)
      .post("/api/signing-keys")
      .set("Cookie", adminCookie)
      .send({ passphrase: SIGNING_PASSPHRASE });
    expect(key.status).toBe(201);
    expect(key.body.algorithm).toBe("Ed25519");
    fingerprint = key.body.fingerprint;
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  describe("the server cannot sign for the user", () => {
    it("signing without the passphrase is refused", async () => {
      const res = await request(app).post(`/api/minutes/${minutesId}/sign`).set("Cookie", adminCookie).send({});
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("signing_passphrase_required");
    });

    it("a wrong passphrase is refused", async () => {
      const res = await request(app)
        .post(`/api/minutes/${minutesId}/sign`)
        .set("Cookie", adminCookie)
        .send({ passphrase: "not-the-passphrase" });
      expect(res.status).toBe(401);
    });

    it("the stored private key is not usable without the passphrase", async () => {
      const [key] = await db
        .select()
        .from(mod.signingKeysTable)
        .where(eq(mod.signingKeysTable.personId, adminId));
      // What an operator (or a database thief) actually has: ciphertext.
      expect(key.encryptedPrivateKey).toBeTruthy();
      expect(key.encryptedPrivateKey).not.toContain("PRIVATE KEY");
      const { unwrapPrivateKey, WrongPassphraseError } = await import("../lib/signing");
      expect(() => unwrapPrivateKey(key, "guess")).toThrow(WrongPassphraseError);
      // And with the passphrase — which only the signer has — it works.
      expect(() => unwrapPrivateKey(key, SIGNING_PASSPHRASE)).not.toThrow();
    });
  });

  describe("a real signature, verifiable in-app and offline", () => {
    it("signs, then verifies through the API", async () => {
      const sign = await request(app)
        .post(`/api/minutes/${minutesId}/sign`)
        .set("Cookie", adminCookie)
        .send({ passphrase: SIGNING_PASSPHRASE });
      expect(sign.status).toBe(200);
      expect(sign.body.signature).toBeTruthy();
      expect(sign.body.algorithm).toBe("Ed25519");
      expect(sign.body.contentSha256).toMatch(/^[0-9a-f]{64}$/);

      const verify = await request(app)
        .get(`/api/minutes/${minutesId}/signature/verify`)
        .set("Cookie", adminCookie);
      expect(verify.status).toBe(200);
      expect(verify.body.ok).toBe(true);
      expect(verify.body.counts.verified).toBe(1);
      expect(verify.body.counts.invalid).toBe(0);
      expect(verify.body.signatures[0].status).toBe("verified");
    });

    it("the exported bundle verifies OFFLINE — no database, no server, no app code", async () => {
      const exp = await request(app).get(`/api/minutes/${minutesId}/export`).set("Cookie", adminCookie);
      expect(exp.status).toBe(200);
      const bundle = JSON.parse(exp.text);

      const { code, out } = verifyOffline(bundle);
      expect(out).toContain("VERIFIED");
      expect(code).toBe(0);

      // And with the signer's out-of-band fingerprint, which closes the
      // key-substitution gap.
      const withFp = verifyOffline(bundle, ["--fingerprint", fingerprint]);
      expect(withFp.code).toBe(0);
      expect(withFp.out).toContain("VERIFIED");
    });

    it("FAILS on a one-character content change", async () => {
      const exp = await request(app).get(`/api/minutes/${minutesId}/export`).set("Cookie", adminCookie);
      const bundle = JSON.parse(exp.text);

      // AED 4,000,000 → AED 5,000,000. One character.
      bundle.minutes.content = bundle.minutes.content.replace("4,000,000", "5,000,000");

      const { code, out } = verifyOffline(bundle);
      expect(code).toBe(1);
      expect(out).toContain("the minutes text changed after signing");
    });

    it("FAILS on a signer-id change", async () => {
      const exp = await request(app).get(`/api/minutes/${minutesId}/export`).set("Cookie", adminCookie);
      const bundle = JSON.parse(exp.text);

      bundle.signatures[0].signerId = "00000000-0000-4000-8000-000000000000";

      const { code, out } = verifyOffline(bundle);
      expect(code).toBe(1);
      expect(out).toContain("does not verify");
    });

    it("FAILS on a substituted public key (the key-swap attack), when a fingerprint is supplied", async () => {
      const exp = await request(app).get(`/api/minutes/${minutesId}/export`).set("Cookie", adminCookie);
      const bundle = JSON.parse(exp.text);

      // An operator forges a whole signature under a key THEY control. It is
      // cryptographically valid — and that is exactly why the fingerprint
      // check exists.
      const { generateWrappedKeypair, unwrapPrivateKey, signPayload } = await import("../lib/signing");
      const attacker = generateWrappedKeypair("attacker-passphrase");
      const attackerKey = unwrapPrivateKey(attacker, "attacker-passphrase");
      const s = bundle.signatures[0];
      s.publicKey = attacker.publicKey;
      s.signature = signPayload(attackerKey, {
        minutesId: bundle.minutes.id,
        contentSha256: s.contentSha256,
        signerId: s.signerId,
        signerName: s.signerName,
        signedAt: s.signedAt,
        algorithm: "Ed25519",
        publicKey: attacker.publicKey,
      });

      // Without the fingerprint the forgery passes — an honest tool must say so.
      const blind = verifyOffline(bundle);
      expect(blind.code).toBe(0);
      expect(blind.out).toContain("cannot detect a swapped public key");

      // With the signer's real fingerprint, it is caught.
      const checked = verifyOffline(bundle, ["--fingerprint", fingerprint]);
      expect(checked.code).toBe(1);
      expect(checked.out).toContain("SUSPECT");
    });
  });

  describe("a SQL-forged signature row does not verify", () => {
    it("a row written straight into the database is rejected", async () => {
      // Separate minutes so the forged row does not collide with the real one.
      // (`minutes.meeting_id` is UNIQUE — one minutes per meeting — so this
      // needs a meeting of its own.)
      const [meeting] = await db
        .insert(mod.meetingsTable)
        .values({ boardId, title: "P01 Forged Meeting", date: new Date() })
        .returning();
      const [forgedMinutes] = await db
        .insert(mod.minutesTable)
        .values({ meetingId: meeting.id, content: "<p>Forged minutes.</p>", status: "signing" })
        .returning();
      // Clean up any prior run's row for this content.
      await db
        .delete(mod.minutesSignaturesTable)
        .where(eq(mod.minutesSignaturesTable.minutesId, forgedMinutes.id));

      // The attacker has DB write access and invents a signature. They cannot
      // produce a valid Ed25519 signature without the private key, which the
      // server never holds.
      const [realKey] = await db
        .select()
        .from(mod.signingKeysTable)
        .where(eq(mod.signingKeysTable.personId, adminId));

      const { sha256Hex, PAYLOAD_VERSION } = await import("../lib/signing");
      await db.insert(mod.minutesSignaturesTable).values({
        minutesId: forgedMinutes.id,
        personId: adminId,
        signature: Buffer.from("this is not a signature").toString("base64"),
        algorithm: "Ed25519",
        signingKeyId: realKey.id,
        publicKey: realKey.publicKey,
        contentSha256: sha256Hex(forgedMinutes.content),
        signerName: "P01 Admin",
        payloadVersion: PAYLOAD_VERSION,
        signedAt: new Date(),
      });

      const verify = await request(app)
        .get(`/api/minutes/${forgedMinutes.id}/signature/verify`)
        .set("Cookie", adminCookie);
      expect(verify.status).toBe(409);
      expect(verify.body.ok).toBe(false);
      expect(verify.body.counts.invalid).toBe(1);
      expect(verify.body.signatures[0].reason).toContain("does not verify");

      const exp = await request(app).get(`/api/minutes/${forgedMinutes.id}/export`).set("Cookie", adminCookie);
      const { code } = verifyOffline(JSON.parse(exp.text));
      expect(code).toBe(1);
    });

    it("a pre-P0.1 legacy row reports legacy_unverifiable, never verified", async () => {
      const [meeting] = await db
        .insert(mod.meetingsTable)
        .values({ boardId, title: "P01 Legacy Meeting", date: new Date() })
        .returning();
      const [legacyMinutes] = await db
        .insert(mod.minutesTable)
        .values({ meetingId: meeting.id, content: "<p>Legacy minutes.</p>", status: "signed" })
        .returning();
      await db
        .delete(mod.minutesSignaturesTable)
        .where(eq(mod.minutesSignaturesTable.minutesId, legacyMinutes.id));

      // Exactly what the OLD code wrote: a bare hash, nothing else.
      await db.insert(mod.minutesSignaturesTable).values({
        minutesId: legacyMinutes.id,
        personId: adminId,
        signatureHash: "a".repeat(64),
      });

      const verify = await request(app)
        .get(`/api/minutes/${legacyMinutes.id}/signature/verify`)
        .set("Cookie", adminCookie);
      expect(verify.status).toBe(200);
      expect(verify.body.counts.legacy_unverifiable).toBe(1);
      expect(verify.body.counts.verified).toBe(0);
      expect(verify.body.signatures[0].status).toBe("legacy_unverifiable");
    });
  });
});
