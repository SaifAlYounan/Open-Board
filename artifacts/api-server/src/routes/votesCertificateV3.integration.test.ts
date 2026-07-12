/**
 * External-review item 1 — the vote certificate was CIRCULAR: an unkeyed hash
 * derived entirely from the vote records, verified by recomputing it from
 * those same records. Flipping ballots and rewriting certificate_hash passed.
 *
 * The v3 certificate freezes a payload at close time and Ed25519-signs it with
 * the server key (wrapped under SERVER_SIGNING_SECRET, which is not in the
 * database). This suite proves the closure the review asked for: an attacker
 * with FULL database write access who flips a ballot and consistently rewrites
 * payload + hash still fails verification, because they cannot re-sign.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

d("vote certificate v3 (signed, non-circular)", () => {
  let app: any;
  let db: any;
  let dbMod: any;
  let closeMod: any;
  let eq: any;

  const PASSWORD = "correct-horse-battery";
  const admin = { email: "certv3-admin@test.local", name: "CertV3 Admin", role: "admin" as const };
  const m1 = { email: "certv3-m1@test.local", name: "CertV3 M1", role: "member" as const };
  const m2 = { email: "certv3-m2@test.local", name: "CertV3 M2", role: "member" as const };
  const people: Record<string, any> = {};
  let boardId: string;

  let ipCounter = 0;
  const nextIp = () => `10.97.0.${(++ipCounter % 250) + 1}`;
  const cookieCache: Record<string, string> = {};
  async function cookieFor(email: string): Promise<string> {
    if (cookieCache[email]) return cookieCache[email];
    const res = await request(app).post("/api/auth/login").set("X-Forwarded-For", nextIp()).send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"];
    cookieCache[email] = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
    return cookieCache[email];
  }

  let resCounter = 0;
  /** Create a 2-member vote and close it by casting both ballots. */
  async function closedVote(decisions: [string, string] = ["approved", "approved"]) {
    const adminCookie = await cookieFor(admin.email);
    const created = await request(app)
      .post("/api/votes")
      .set("Cookie", adminCookie)
      .set("X-Forwarded-For", nextIp())
      .send({
        boardId,
        resolutionNumber: `RES-CERTV3-${Date.now()}-${++resCounter}`,
        title: "Certificate v3 resolution",
        resolutionText: "Resolved, that certificates stop being circular.",
        type: "circulation",
        approvalRule: { type: "majority" },
      });
    expect(created.status).toBe(201);
    for (const [i, member] of [m1, m2].entries()) {
      const cast = await request(app)
        .post(`/api/votes/${created.body.id}/cast`)
        .set("Cookie", await cookieFor(member.email))
        .set("X-Forwarded-For", nextIp())
        .send({ decision: decisions[i] });
      expect(cast.status).toBe(200);
    }
    return created.body.id as string;
  }

  async function verify(voteId: string) {
    const res = await request(app).get(`/api/votes/${voteId}/certificate/verify`).set("Cookie", await cookieFor(admin.email));
    expect(res.status).toBe(200);
    return res.body;
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    dbMod = await import("@workspace/db");
    db = dbMod.db;
    ({ eq } = await import("drizzle-orm"));
    closeMod = await import("../lib/voteClose");
    app = (await import("../app")).default;

    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const p of [admin, m1, m2]) {
      const { or } = await import("drizzle-orm");
      const [existing] = await db.select().from(dbMod.peopleTable).where(eq(dbMod.peopleTable.email, p.email));
      if (existing) {
        await db.delete(dbMod.auditTrailTable).where(eq(dbMod.auditTrailTable.personId, existing.id));
        await db.delete(dbMod.voteRecordsTable).where(or(eq(dbMod.voteRecordsTable.personId, existing.id), eq(dbMod.voteRecordsTable.castBy, existing.id)));
        await db.delete(dbMod.boardMembershipsTable).where(eq(dbMod.boardMembershipsTable.personId, existing.id));
        await db.delete(dbMod.accessControlTable).where(eq(dbMod.accessControlTable.personId, existing.id));
        await db.delete(dbMod.peopleTable).where(eq(dbMod.peopleTable.id, existing.id));
      }
      const [row] = await db.insert(dbMod.peopleTable).values({ ...p, passwordHash: hash }).returning();
      people[p.email] = row;
    }
    const [board] = await db.insert(dbMod.boardsTable).values({ name: `CertV3 Board ${Date.now()}`, abbreviation: "CV3", type: "board" }).returning();
    boardId = board.id;
    await db.insert(dbMod.boardMembershipsTable).values([
      { boardId, personId: people[m1.email].id },
      { boardId, personId: people[m2.email].id },
    ]);
  });

  it("a vote closed under the server key gets a signed v3 certificate that verifies on all three checks", async () => {
    const voteId = await closedVote();
    const [vote] = await db.select().from(dbMod.votesTable).where(eq(dbMod.votesTable.id, voteId));
    expect(vote.status).toBe("approved");
    expect(vote.certificateVersion).toBe(3);
    expect(vote.certificateSignature).toBeTruthy();
    expect(vote.certificateKeyId).toBeTruthy();
    expect(vote.certificatePayload.records.length).toBe(2);

    const v = await verify(voteId);
    expect(v.hashVersion).toBe(3);
    expect(v.signed).toBe(true);
    expect(v.hashValid).toBe(true);
    expect(v.signatureValid).toBe(true);
    expect(v.payloadMatchesRecords).toBe(true);
    expect(v.verified).toBe(true);
    expect(v.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a naive ballot flip is caught: the frozen payload no longer matches the live rows", async () => {
    const voteId = await closedVote();
    await db
      .update(dbMod.voteRecordsTable)
      .set({ decision: "not_approved" })
      .where(eq(dbMod.voteRecordsTable.voteId, voteId));

    const v = await verify(voteId);
    expect(v.verified).toBe(false);
    expect(v.payloadMatchesRecords).toBe(false);
    // The stored payload itself is untouched, so hash + signature still check out.
    expect(v.hashValid).toBe(true);
    expect(v.signatureValid).toBe(true);
  });

  it("THE POINT: a full DB-write attacker who flips ballots AND consistently rewrites payload + hash cannot re-sign", async () => {
    const voteId = await closedVote();

    // The attack the external review described, upgraded to v3: flip a ballot,
    // then rebuild the payload EXACTLY the way the server does (same module,
    // same loaders) and rewrite certificate_payload + certificate_hash to
    // match. Everything in the database is now self-consistent…
    await db
      .update(dbMod.voteRecordsTable)
      .set({ decision: "not_approved" })
      .where(eq(dbMod.voteRecordsTable.voteId, voteId));

    const [vote] = await db.select().from(dbMod.votesTable).where(eq(dbMod.votesTable.id, voteId));
    const ctx = await closeMod.loadEvaluationContext(vote);
    const forgedPayload = closeMod.buildCertificatePayload(
      vote,
      vote.status,
      vote.closedAt,
      ctx,
      { publicKey: vote.certificatePayload.publicKey, keyId: vote.certificatePayload.keyId },
    );
    await db
      .update(dbMod.votesTable)
      .set({ certificatePayload: forgedPayload, certificateHash: closeMod.certificateHashV3(forgedPayload) })
      .where(eq(dbMod.votesTable.id, voteId));

    // …except the signature, which needs SERVER_SIGNING_SECRET. Verification fails.
    const v = await verify(voteId);
    expect(v.hashValid).toBe(true); // the forged hash matches the forged payload
    expect(v.payloadMatchesRecords).toBe(true); // the forged payload matches the flipped rows
    expect(v.signatureValid).toBe(false); // …but the signature does not re-verify
    expect(v.verified).toBe(false);
  });

  it("legacy (pre-signing) certificates still verify, labeled signed:false", async () => {
    const voteId = await closedVote();
    // Emulate a vote closed before v3 existed: strip the v3 columns and store
    // the old v2 recompute-style hash.
    const [vote] = await db.select().from(dbMod.votesTable).where(eq(dbMod.votesTable.id, voteId));
    const records = await db.select().from(dbMod.voteRecordsTable).where(eq(dbMod.voteRecordsTable.voteId, voteId));
    const { computeCertificateHash } = await import("../lib/voteTally");
    await db
      .update(dbMod.votesTable)
      .set({
        certificateVersion: null,
        certificatePayload: null,
        certificateSignature: null,
        certificateKeyId: null,
        certificateHash: computeCertificateHash(voteId, vote.status, vote.closedAt, records),
      })
      .where(eq(dbMod.votesTable.id, voteId));

    const v = await verify(voteId);
    expect(v.verified).toBe(true);
    expect(v.hashVersion).toBe(2);
    expect(v.signed).toBe(false);
  });
});
