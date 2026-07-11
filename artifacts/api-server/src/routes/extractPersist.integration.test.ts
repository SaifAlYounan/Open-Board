import { beforeAll, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { integrationSuite } from "../testutil/integrationSuite";

/**
 * P0.5 — the extracted text must be PERSISTED (F1 prerequisite).
 *
 * Before this fix, extraction ran only as a transient step inside AI
 * classification and the text was discarded — making any check of an AI
 * source_quote against the document impossible after the fact. Now every
 * upload extracts and persists `documents.extracted_text` in the background,
 * with or without an AI key configured.
 */
integrationSuite("extracted text persistence (P0.5)", () => {
  const PASSWORD = "Str0ng-Passw0rd-For-Tests!";
  const adminEmail = "p05-admin@test.local";

  let db: any;
  let mod: any;
  let eq: any;
  let app: any;
  let adminCookie: string;

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    mod = await import("@workspace/db");
    db = mod.db;
    ({ eq } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    const hash = await bcrypt.hash(PASSWORD, 10);

    // Re-runnable cleanup.
    const [existing] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, adminEmail));
    if (existing) {
      await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, existing.id));
      await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.personId, existing.id));
      await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.actorId, existing.id));
      const docs = await db.select().from(mod.documentsTable).where(eq(mod.documentsTable.uploadedBy, existing.id));
      for (const d of docs) {
        await db.delete(mod.accessControlTable).where(eq(mod.accessControlTable.entityId, d.id));
      }
      await db.delete(mod.documentsTable).where(eq(mod.documentsTable.uploadedBy, existing.id));
      await db.delete(mod.accessControlTable).where(eq(mod.accessControlTable.personId, existing.id));
      await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, existing.id));
    }

    await db.insert(mod.peopleTable).values({ name: "P05 Admin", email: adminEmail, role: "admin", passwordHash: hash });

    const login = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "10.85.0.1")
      .send({ email: adminEmail, password: PASSWORD });
    expect(login.status).toBe(200);
    const setCookie = login.headers["set-cookie"];
    adminCookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
  });

  it("persists the extracted text of an uploaded document (independent of AI)", async () => {
    const content = "MINUTES OF THE P05 TEST BOARD\nRESOLVED THAT the extraction be persisted.\n";
    const res = await request(app)
      .post("/api/documents/upload")
      .set("Cookie", adminCookie)
      .attach("file", Buffer.from(content, "utf-8"), "p05-extract-test.txt");
    expect(res.status).toBe(200);
    const docId = res.body.document.id;

    // Extraction runs in the background — poll briefly.
    let row: any = null;
    for (let i = 0; i < 40; i++) {
      [row] = await db.select().from(mod.documentsTable).where(eq(mod.documentsTable.id, docId));
      if (row?.extractedText != null) break;
      await new Promise((r) => setTimeout(r, 250));
    }

    expect(row?.extractedText).toBeTruthy();
    expect(row.extractedText).toContain("RESOLVED THAT the extraction be persisted.");
    expect(row.extractedAt).toBeTruthy();
  });
});
