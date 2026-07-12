/**
 * External-review item 7 — two authz/lifecycle gaps:
 *  (a) the graph routes scoped by BOARD membership only and never consulted
 *      per-entity ACLs, so a member explicitly denied a document (recusal)
 *      still saw its title and edges in the graph and in /graph/search while
 *      the document routes correctly 403'd;
 *  (b) hard-deleting a person who had acted (ballots, signatures, audit rows)
 *      died on unguarded foreign keys as an unhandled 500.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

d("graph ACL + person-delete guard", () => {
  let app: any;
  let db: any;
  let dbMod: any;
  let eq: any;

  const PASSWORD = "correct-horse-battery";
  const admin = { email: "gacl-admin@test.local", name: "GACL Admin", role: "admin" as const };
  const m1 = { email: "gacl-m1@test.local", name: "GACL M1", role: "member" as const };
  const m2 = { email: "gacl-m2@test.local", name: "GACL M2 (denied)", role: "member" as const };
  const disposable = { email: "gacl-disposable@test.local", name: "GACL Disposable", role: "member" as const };
  const people: Record<string, any> = {};
  let boardId: string;
  let docId: string;
  const DOC_TITLE = `Recused Acquisition Memo ${Date.now()}`;

  let ipCounter = 0;
  const nextIp = () => `10.95.0.${(++ipCounter % 250) + 1}`;
  const cookieCache: Record<string, string> = {};
  async function cookieFor(email: string): Promise<string> {
    if (cookieCache[email]) return cookieCache[email];
    const res = await request(app).post("/api/auth/login").set("X-Forwarded-For", nextIp()).send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"];
    cookieCache[email] = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
    return cookieCache[email];
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    dbMod = await import("@workspace/db");
    db = dbMod.db;
    ({ eq } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const p of [admin, m1, m2, disposable]) {
      const { or } = await import("drizzle-orm");
      const [existing] = await db.select().from(dbMod.peopleTable).where(eq(dbMod.peopleTable.email, p.email));
      if (existing) {
        await db.delete(dbMod.auditTrailTable).where(eq(dbMod.auditTrailTable.personId, existing.id));
        await db.delete(dbMod.voteRecordsTable).where(or(eq(dbMod.voteRecordsTable.personId, existing.id), eq(dbMod.voteRecordsTable.castBy, existing.id)));
        await db.delete(dbMod.documentsTable).where(eq(dbMod.documentsTable.uploadedBy, existing.id));
        await db.delete(dbMod.boardMembershipsTable).where(eq(dbMod.boardMembershipsTable.personId, existing.id));
        await db.delete(dbMod.accessControlTable).where(eq(dbMod.accessControlTable.personId, existing.id));
        await db.delete(dbMod.peopleTable).where(eq(dbMod.peopleTable.id, existing.id));
      }
      const [row] = await db.insert(dbMod.peopleTable).values({ ...p, passwordHash: hash }).returning();
      people[p.email] = row;
    }

    const [board] = await db.insert(dbMod.boardsTable).values({ name: `GACL Board ${Date.now()}`, abbreviation: "GACL", type: "board" }).returning();
    boardId = board.id;
    await db.insert(dbMod.boardMembershipsTable).values([
      { boardId, personId: people[m1.email].id },
      { boardId, personId: people[m2.email].id },
    ]);

    // A board document both members would see by membership…
    const [doc] = await db
      .insert(dbMod.documentsTable)
      .values({
        title: DOC_TITLE,
        filename: "recused-memo.pdf",
        filePath: "/nonexistent/recused-memo.pdf",
        boardId,
        uploadedBy: people[admin.email].id,
      })
      .returning();
    docId = doc.id;
    // …minus an explicit deny (recusal) for m2. Deny beats membership.
    await db.insert(dbMod.accessControlTable).values({
      entityType: "document",
      entityId: docId,
      personId: people[m2.email].id,
      hasAccess: false,
    });
  });

  it("a recused member's graph shows no trace of the denied document; other members still see it", async () => {
    const deniedView = await request(app).get("/api/graph").set("Cookie", await cookieFor(m2.email));
    expect(deniedView.status).toBe(200);
    expect(deniedView.body.nodes.find((n: any) => n.id === docId)).toBeUndefined();
    expect(deniedView.body.edges.find((e: any) => e.source === docId || e.target === docId)).toBeUndefined();

    const memberView = await request(app).get("/api/graph").set("Cookie", await cookieFor(m1.email));
    expect(memberView.body.nodes.find((n: any) => n.id === docId)).toBeTruthy();
  });

  it("/graph/search never surfaces the denied document to the recused member", async () => {
    const q = encodeURIComponent("Recused Acquisition");
    const denied = await request(app).get(`/api/graph/search?q=${q}`).set("Cookie", await cookieFor(m2.email));
    expect(denied.status).toBe(200);
    expect(denied.body.nodes.find((n: any) => n.id === docId)).toBeUndefined();

    const member = await request(app).get(`/api/graph/search?q=${q}`).set("Cookie", await cookieFor(m1.email));
    expect(member.body.nodes.find((n: any) => n.id === docId)).toBeTruthy();
  });

  it("/graph/summary counts respect the per-document deny", async () => {
    const denied = await request(app).get("/api/graph/summary").set("Cookie", await cookieFor(m2.email));
    const member = await request(app).get("/api/graph/summary").set("Cookie", await cookieFor(m1.email));
    expect(member.body.documents.total - denied.body.documents.total).toBe(1);
  });

  it("hard-deleting a person who has acted returns a clean 409 naming the references — not a 500", async () => {
    // m1 has audit rows at minimum (login); give them a ballot too via SQL to
    // hit the exact FK the review named.
    const [vote] = await db
      .insert(dbMod.votesTable)
      .values({
        boardId,
        resolutionNumber: `RES-GACL-${Date.now()}`,
        title: "Reference vote",
        resolutionText: "Resolved.",
        type: "circulation",
      })
      .returning();
    await db.insert(dbMod.voteRecordsTable).values({ voteId: vote.id, personId: people[m1.email].id, decision: "approved" });

    const res = await request(app)
      .delete(`/api/people/${people[m1.email].id}`)
      .set("Cookie", await cookieFor(admin.email))
      .set("X-Forwarded-For", nextIp());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/deactivate/i);
    expect(res.body.references.ballots).toBeGreaterThanOrEqual(1);

    // The person still exists.
    const [still] = await db.select().from(dbMod.peopleTable).where(eq(dbMod.peopleTable.id, people[m1.email].id));
    expect(still).toBeTruthy();
  });

  it("a person with no governance footprint still hard-deletes cleanly", async () => {
    // `disposable` never logged in and never acted — no audit rows, no ballots.
    const res = await request(app)
      .delete(`/api/people/${people[disposable.email].id}`)
      .set("Cookie", await cookieFor(admin.email))
      .set("X-Forwarded-For", nextIp());
    expect(res.status).toBe(204);
    const [gone] = await db.select().from(dbMod.peopleTable).where(eq(dbMod.peopleTable.id, people[disposable.email].id));
    expect(gone).toBeUndefined();
  });
});
