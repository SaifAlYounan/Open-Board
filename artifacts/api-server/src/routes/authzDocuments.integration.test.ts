/**
 * P0.7 — one access-control model, deny by default (fixes F4).
 * Needs a real Postgres at DATABASE_URL; skips itself otherwise.
 *
 * The document ACL used to be a pure allow-list where the board at large got NO
 * grant on upload and only the uploader could see a document, while the README
 * sold it as an exclusion/recusal mechanism. The model is now:
 *   admin > explicit-deny > unexpired-explicit-grant > board-membership > deny.
 *
 * These personas would have behaved wrongly before the change:
 *   - member-added-after-upload: saw NOTHING (no grant snapshot) — now sees it via live membership.
 *   - recused director: PATCH access was UPDATE-only, so recusing a member with no row 404'd and
 *     they kept access — now a deny row takes precedence over membership.
 *   - non-member: unchanged (denied).
 *   - observer: a board observer can READ but cannot mutate the ACL.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import { and } from "drizzle-orm";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

d("document access control — deny by default (P0.7)", () => {
  const BOARD_NAME = "Doc Authz Test Board";
  const admin = { email: "docauthz-admin@test.local", name: "Doc Admin", role: "admin" as const };
  const memberEarly = { email: "docauthz-early@test.local", name: "Early Member", role: "member" as const };
  const memberLate = { email: "docauthz-late@test.local", name: "Late Member", role: "member" as const };
  const recused = { email: "docauthz-recused@test.local", name: "Recused Director", role: "member" as const };
  const observer = { email: "docauthz-observer@test.local", name: "Doc Observer", role: "member" as const };
  const outsider = { email: "docauthz-outsider@test.local", name: "Doc Outsider", role: "member" as const };
  const PEOPLE = [admin, memberEarly, memberLate, recused, observer, outsider];
  const PASSWORD = "correct-horse-battery";

  let app: any;
  let db: any;
  let mod: any;
  let eq: any;
  let boardId: string;
  let docId: string;
  const idByEmail: Record<string, string> = {};

  let ipCounter = 0;
  async function cookieFor(email: string): Promise<string> {
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", `10.88.0.${++ipCounter}`)
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

    const hash = await bcrypt.hash(PASSWORD, 10);

    // Re-runnable cleanup.
    for (const p of PEOPLE) {
      const [existing] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, p.email));
      if (existing) {
        await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, existing.id));
        // access_events references people twice (person_id + actor_id) — clear both.
        await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.personId, existing.id));
        await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.actorId, existing.id));
        await db.delete(mod.accessControlTable).where(eq(mod.accessControlTable.personId, existing.id));
        await db.delete(mod.boardMembershipsTable).where(eq(mod.boardMembershipsTable.personId, existing.id));
        // Documents reference the uploader (FK) — remove them before the person.
        await db.delete(mod.documentsTable).where(eq(mod.documentsTable.uploadedBy, existing.id));
        await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, existing.id));
      }
    }
    for (const b of await db.select().from(mod.boardsTable).where(eq(mod.boardsTable.name, BOARD_NAME))) {
      const docs = await db.select().from(mod.documentsTable).where(eq(mod.documentsTable.boardId, b.id));
      for (const dc of docs) {
        await db.delete(mod.accessControlTable).where(eq(mod.accessControlTable.entityId, dc.id));
        await db.delete(mod.documentsTable).where(eq(mod.documentsTable.id, dc.id));
      }
      await db.delete(mod.boardMembershipsTable).where(eq(mod.boardMembershipsTable.boardId, b.id));
      await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.entityId, b.id));
      await db.delete(mod.boardsTable).where(eq(mod.boardsTable.id, b.id));
    }

    for (const p of PEOPLE) {
      await db.insert(mod.peopleTable).values({ ...p, passwordHash: hash });
      const [row] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, p.email));
      idByEmail[p.email] = row.id;
    }

    const [board] = await db
      .insert(mod.boardsTable)
      .values({ name: BOARD_NAME, abbreviation: "DAB", type: "board" })
      .returning();
    boardId = board.id;

    // Members present BEFORE the document exists.
    for (const p of [admin, memberEarly, recused]) {
      await db.insert(mod.boardMembershipsTable).values({ boardId, personId: idByEmail[p.email], roleInBoard: "member" });
    }
    await db.insert(mod.boardMembershipsTable).values({ boardId, personId: idByEmail[observer.email], roleInBoard: "observer" });

    // A board document with NO access_control rows — the fixed upload path: board
    // members see it via membership, nobody is snapshotted.
    const [doc] = await db
      .insert(mod.documentsTable)
      .values({ boardId, title: "Board Pack", filename: "pack.pdf", uploadedBy: idByEmail[admin.email], filePath: null })
      .returning();
    docId = doc.id;

    // memberLate joins the board AFTER the document already exists.
    await db.insert(mod.boardMembershipsTable).values({ boardId, personId: idByEmail[memberLate.email], roleInBoard: "member" });
  });

  it("a board member (present at upload) can read the document", async () => {
    const cookie = await cookieFor(memberEarly.email);
    const res = await request(app).get(`/api/documents/${docId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    const list = await request(app).get("/api/documents").set("Cookie", cookie);
    expect(list.body.map((d2: any) => d2.id)).toContain(docId);
  });

  it("a member added AFTER upload can still read the document (live membership, not a snapshot)", async () => {
    const cookie = await cookieFor(memberLate.email);
    const res = await request(app).get(`/api/documents/${docId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    const list = await request(app).get("/api/documents").set("Cookie", cookie);
    expect(list.body.map((d2: any) => d2.id)).toContain(docId);
  });

  it("a non-member cannot read the document, and it is absent from their list", async () => {
    const cookie = await cookieFor(outsider.email);
    const res = await request(app).get(`/api/documents/${docId}`).set("Cookie", cookie);
    expect(res.status).toBe(403);
    const list = await request(app).get("/api/documents").set("Cookie", cookie);
    expect(list.body.map((d2: any) => d2.id)).not.toContain(docId);
  });

  it("an observer can read but cannot mutate the ACL", async () => {
    const cookie = await cookieFor(observer.email);
    const read = await request(app).get(`/api/documents/${docId}`).set("Cookie", cookie);
    expect(read.status).toBe(200);
    const mutate = await request(app)
      .patch(`/api/documents/${docId}/access`)
      .set("Cookie", cookie)
      .send({ personId: idByEmail[outsider.email], hasAccess: true });
    expect(mutate.status).toBe(403); // requireAdmin
  });

  it("a recused director is denied even though they are a board member (deny precedence)", async () => {
    // Admin recuses the director. This member has NO prior access_control row, so
    // the old UPDATE-only endpoint would have 404'd and left them with access.
    const adminCookie = await cookieFor(admin.email);
    const recuse = await request(app)
      .patch(`/api/documents/${docId}/access`)
      .set("Cookie", adminCookie)
      .send({ personId: idByEmail[recused.email], hasAccess: false });
    expect(recuse.status).toBe(200);

    const cookie = await cookieFor(recused.email);
    const res = await request(app).get(`/api/documents/${docId}`).set("Cookie", cookie);
    expect(res.status).toBe(403);
    const list = await request(app).get("/api/documents").set("Cookie", cookie);
    expect(list.body.map((d2: any) => d2.id)).not.toContain(docId);
  });

  it("an explicit grant to a non-member works, and an expired one does not", async () => {
    // Future grant → visible.
    await db.insert(mod.accessControlTable).values({
      entityType: "document",
      entityId: docId,
      personId: idByEmail[outsider.email],
      hasAccess: true,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    let cookie = await cookieFor(outsider.email);
    let res = await request(app).get(`/api/documents/${docId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);

    // Expire it → denied again.
    await db
      .update(mod.accessControlTable)
      .set({ expiresAt: new Date(Date.now() - 60 * 1000) })
      .where(and(eq(mod.accessControlTable.entityId, docId), eq(mod.accessControlTable.personId, idByEmail[outsider.email])));
    cookie = await cookieFor(outsider.email);
    res = await request(app).get(`/api/documents/${docId}`).set("Cookie", cookie);
    expect(res.status).toBe(403);
  });

  // A1 — the REAL-FLOW test. Upload through the actual API with a boardId and
  // confirm a board member who is neither the uploader nor explicitly granted
  // can see it. This fails on the pre-A1 code (upload never set board_id, so the
  // membership branch was inert and only the uploader/admins could see it).
  it("a document UPLOADED via the API with a boardId is visible to board members", async () => {
    const adminCookie = await cookieFor(admin.email);
    const up = await request(app)
      .post("/api/documents/upload")
      .set("Cookie", adminCookie)
      .field("boardId", boardId)
      .attach("file", Buffer.from("board pack body"), "pack.txt");
    expect(up.status).toBe(200);
    const uploadedId = up.body.document.id;
    expect(up.body.document.boardId).toBe(boardId);

    // memberEarly is a board member, NOT the uploader, with no explicit grant.
    const memberCookie = await cookieFor(memberEarly.email);
    const read = await request(app).get(`/api/documents/${uploadedId}`).set("Cookie", memberCookie);
    expect(read.status).toBe(200);
    const list = await request(app).get("/api/documents").set("Cookie", memberCookie);
    expect(list.body.map((x: any) => x.id)).toContain(uploadedId);

    // A non-member still cannot see it.
    const outsiderCookie = await cookieFor(outsider.email);
    const denied = await request(app).get(`/api/documents/${uploadedId}`).set("Cookie", outsiderCookie);
    expect(denied.status).toBe(403);
  });

  it("a board-less upload can be assigned to a board via PATCH, then members see it", async () => {
    const adminCookie = await cookieFor(admin.email);
    const up = await request(app)
      .post("/api/documents/upload")
      .set("Cookie", adminCookie)
      .attach("file", Buffer.from("later-assigned body"), "later.txt");
    expect(up.status).toBe(200);
    const uploadedId = up.body.document.id;
    expect(up.body.document.boardId).toBeNull();

    // Before assignment: a board member cannot see it (board-less = admin/uploader only).
    const memberCookie = await cookieFor(memberEarly.email);
    expect((await request(app).get(`/api/documents/${uploadedId}`).set("Cookie", memberCookie)).status).toBe(403);

    // Admin assigns it to the board.
    const patch = await request(app)
      .patch(`/api/documents/${uploadedId}`)
      .set("Cookie", adminCookie)
      .send({ boardId });
    expect(patch.status).toBe(200);
    expect(patch.body.boardId).toBe(boardId);

    // Now the board member sees it.
    expect((await request(app).get(`/api/documents/${uploadedId}`).set("Cookie", memberCookie)).status).toBe(200);
  });

  it("a member cannot upload into a board they are not on", async () => {
    // outsider is not on the board; uploading with that boardId must be refused.
    const outsiderCookie = await cookieFor(outsider.email);
    const up = await request(app)
      .post("/api/documents/upload")
      .set("Cookie", outsiderCookie)
      .field("boardId", boardId)
      .attach("file", Buffer.from("sneaky"), "sneaky.txt");
    expect(up.status).toBe(403);
  });
});
