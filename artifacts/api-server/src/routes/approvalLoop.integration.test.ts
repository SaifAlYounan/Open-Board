/**
 * External-review item 6 — the human-in-the-loop was "approving the model's
 * account of the document while looking at the model's account of the
 * document": the quote-presence check ran only at classification time, was
 * never re-run at approval, and was invisible to the approver.
 *
 * Closed three ways, all asserted here:
 *  - GET /pending-actions exposes sourceQuoteVerified + sourceViewedByYou;
 *  - POST .../approve re-checks the quote against the persisted extracted
 *    text and BLOCKS (422) when absent, unless explicitly overridden with a
 *    reason — and the override is audited;
 *  - the approval audit entry records sourceQuoteVerified and sourceViewed.
 */
import { it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";
import { generateSync } from "otplib";

const d = integrationSuite;

d("approval loop (item 6)", () => {
  const PASSWORD = "Str0ng-Passw0rd-For-Tests!";
  const adminEmail = "aloop-admin@test.local";
  const TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

  let db: any;
  let mod: any;
  let eq: any;
  let app: any;
  let adminId: string;
  let docId: string;

  let ipCounter = 0;
  const nextIp = () => `10.82.0.${(++ipCounter % 250) + 1}`;

  async function nextWindow(): Promise<void> {
    await db.update(mod.mfaCredentialsTable).set({ lastUsedStep: null }).where(eq(mod.mfaCredentialsTable.personId, adminId));
  }

  /** Full MFA sign-in: password → challenge → TOTP → session cookie. */
  async function mfaCookie(): Promise<string> {
    await nextWindow();
    const login = await request(app).post("/api/auth/login").set("X-Forwarded-For", nextIp()).send({ email: adminEmail, password: PASSWORD });
    expect(login.status).toBe(200);
    const verify = await request(app)
      .post("/api/auth/mfa/verify")
      .set("X-Forwarded-For", nextIp())
      .send({ mfaToken: login.body.mfaToken, code: generateSync({ strategy: "totp", secret: TOTP_SECRET }) });
    expect(verify.status).toBe(200);
    const setCookie = verify.headers["set-cookie"];
    return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
  }

  /** A pending create_task action quoting `quote` against the test document. */
  async function pendingAction(quote: string): Promise<string> {
    const [action] = await db
      .insert(mod.pendingActionsTable)
      .values({
        actionType: "create_task",
        documentId: docId,
        actionData: {
          title: "Follow up on the disposal",
          description: "From the approval-loop test",
          source_quote: quote,
          source_quote_verified: null, // classification-time value is irrelevant: approve re-checks live
        },
        status: "pending",
      })
      .returning();
    return action.id;
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    mod = await import("@workspace/db");
    db = mod.db;
    ({ eq } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    const hash = await bcrypt.hash(PASSWORD, 12);
    const [existing] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, adminEmail));
    if (existing) {
      await db.delete(mod.pendingActionsTable).where(eq(mod.pendingActionsTable.documentId, (await db.select().from(mod.documentsTable).where(eq(mod.documentsTable.uploadedBy, existing.id)))[0]?.id ?? "00000000-0000-0000-0000-000000000000"));
      await db.delete(mod.mfaRecoveryCodesTable).where(eq(mod.mfaRecoveryCodesTable.personId, existing.id));
      await db.delete(mod.mfaCredentialsTable).where(eq(mod.mfaCredentialsTable.personId, existing.id));
      await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, existing.id));
      await db.delete(mod.tasksTable).where(eq(mod.tasksTable.createdBy, existing.id)).catch?.(() => {});
      await db.delete(mod.documentsTable).where(eq(mod.documentsTable.uploadedBy, existing.id));
      await db.delete(mod.accessControlTable).where(eq(mod.accessControlTable.personId, existing.id));
      await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, existing.id));
    }
    const [admin] = await db.insert(mod.peopleTable).values({ name: "ALoop Admin", email: adminEmail, role: "admin", passwordHash: hash }).returning();
    adminId = admin.id;
    // A confirmed TOTP factor, seeded directly (enrollment flow is covered in
    // mfa.integration.test.ts).
    await db.insert(mod.mfaCredentialsTable).values({ personId: adminId, type: "totp", secret: TOTP_SECRET, confirmedAt: new Date() });

    // The source document with PERSISTED extracted text.
    const [doc] = await db
      .insert(mod.documentsTable)
      .values({
        title: "ALoop Board Pack",
        filename: "aloop-pack.txt",
        filePath: "/nonexistent/aloop-pack.txt",
        uploadedBy: adminId,
        extractedText:
          "MINUTES OF THE ALOOP BOARD\nRESOLVED THAT the Aegina disposal proceed to contract.\nACTION: Counsel to follow up on the disposal.",
        extractedAt: new Date(),
      })
      .returning();
    docId = doc.id;
  });

  it("GET /pending-actions exposes the verification flag and whether YOU opened the source", async () => {
    const actionId = await pendingAction("RESOLVED THAT the Aegina disposal proceed to contract.");
    const cookie = await mfaCookie();
    const res = await request(app).get("/api/pending-actions?status=pending").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const row = res.body.find((a: any) => a.id === actionId);
    expect(row).toBeTruthy();
    expect(row.aiSourceQuote).toContain("Aegina");
    // This approver has never downloaded the source document.
    expect(row.sourceViewedByYou).toBe(false);
  });

  it("a genuine quote approves cleanly, and the audit entry records what was verified", async () => {
    const actionId = await pendingAction("ACTION: Counsel to follow up on the disposal.");
    const cookie = await mfaCookie();
    const res = await request(app).post(`/api/pending-actions/${actionId}/approve`).set("Cookie", cookie).set("X-Forwarded-For", nextIp()).send({});
    expect(res.status).toBe(200);

    const { and: andOp } = await import("drizzle-orm");
    const [auditRow] = await db
      .select()
      .from(mod.auditTrailTable)
      .where(andOp(eq(mod.auditTrailTable.action, "pending_action_approved"), eq(mod.auditTrailTable.entityId, actionId)));
    expect(auditRow).toBeTruthy();
    expect((auditRow.details as any).sourceQuoteVerified).toBe(true);
    expect((auditRow.details as any).sourceViewed).toBe(false);
    expect((auditRow.details as any).quoteOverride).toBeNull();
  });

  it("a hallucinated quote BLOCKS the approval (422) — rubber-stamping is no longer possible", async () => {
    const actionId = await pendingAction("RESOLVED THAT the company acquire NorthBridge Capital."); // not in the document
    const cookie = await mfaCookie();
    const res = await request(app).post(`/api/pending-actions/${actionId}/approve`).set("Cookie", cookie).set("X-Forwarded-For", nextIp()).send({});
    expect(res.status).toBe(422);
    expect(res.body.sourceQuoteVerified).toBe(false);
    expect(res.body.error).toMatch(/not found in the source document/i);

    // The action is still pending — nothing executed.
    const [action] = await db.select().from(mod.pendingActionsTable).where(eq(mod.pendingActionsTable.id, actionId));
    expect(action.status).toBe("pending");
  });

  it("an explicit override with a reason approves — and the override is on the record", async () => {
    const actionId = await pendingAction("RESOLVED THAT the company acquire NorthBridge Capital.");
    const cookie = await mfaCookie();
    const res = await request(app)
      .post(`/api/pending-actions/${actionId}/approve`)
      .set("Cookie", cookie)
      .set("X-Forwarded-For", nextIp())
      .send({ overrideUnverifiedQuote: true, overrideReason: "Quote paraphrased; verified against page 3 manually." });
    expect(res.status).toBe(200);

    const { and: andOp } = await import("drizzle-orm");
    const [auditRow] = await db
      .select()
      .from(mod.auditTrailTable)
      .where(andOp(eq(mod.auditTrailTable.action, "pending_action_approved"), eq(mod.auditTrailTable.entityId, actionId)));
    expect((auditRow.details as any).sourceQuoteVerified).toBe(false);
    expect((auditRow.details as any).quoteOverride.reason).toMatch(/page 3/);
  });
});
