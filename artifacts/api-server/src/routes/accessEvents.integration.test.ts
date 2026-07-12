/**
 * P0.10 — point-in-time access reconstruction (F12). Needs Postgres.
 *
 * The append-only access-events log answers "as of date D, who could read X?".
 * We seed events with controlled timestamps and prove the reconstruction:
 *   - an explicit grant then revoke: present between, absent after;
 *   - a board join then leave: a board member is present between, absent after,
 *     with no explicit grant at all (access via live membership).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";
import bcrypt from "bcryptjs";
import request from "supertest";

const d = integrationSuite;

d("point-in-time access reconstruction (P0.10)", () => {
  const BOARD_NAME = "Access Events Test Board";
  const admin = { email: "ae-admin@test.local", name: "AE Admin", role: "admin" as const };
  const granted = { email: "ae-granted@test.local", name: "AE Granted", role: "member" as const };
  const memberP = { email: "ae-member@test.local", name: "AE Member", role: "member" as const };
  const PEOPLE = [admin, granted, memberP];
  const PASSWORD = "correct-horse-battery";

  const T1 = new Date("2026-01-01T00:00:00Z"); // grant / join
  const MID = "2026-02-01T00:00:00Z";          // between
  const T2 = new Date("2026-03-01T00:00:00Z"); // revoke / leave
  const AFTER = "2026-04-01T00:00:00Z";        // after

  let app: any, db: any, mod: any, eq: any;
  let boardId: string, docId: string, adminCookie: string;
  const id: Record<string, string> = {};

  let ip = 0;
  async function cookieFor(email: string): Promise<string> {
    const res = await request(app).post("/api/auth/login").set("X-Forwarded-For", `10.22.0.${++ip}`).send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const c = res.headers["set-cookie"];
    return (Array.isArray(c) ? c[0] : c).split(";")[0];
  }
  async function reconstruct(asOf: string): Promise<string[]> {
    const r = await request(app).get("/api/access-events/reconstruct").query({ entityType: "document", entityId: docId, asOf }).set("Cookie", adminCookie);
    expect(r.status).toBe(200);
    return (r.body.people as any[]).map((p) => p.id);
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    mod = await import("@workspace/db");
    db = mod.db;
    ({ eq } = await import("drizzle-orm"));
    app = (await import("../app")).default;
    const hash = await bcrypt.hash(PASSWORD, 10);

    for (const p of PEOPLE) {
      const [ex] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, p.email));
      if (ex) {
        await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.personId, ex.id));
        await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.actorId, ex.id));
        await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, ex.id));
        await db.delete(mod.documentsTable).where(eq(mod.documentsTable.uploadedBy, ex.id));
        await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, ex.id));
      }
    }
    for (const b of await db.select().from(mod.boardsTable).where(eq(mod.boardsTable.name, BOARD_NAME))) {
      await db.delete(mod.documentsTable).where(eq(mod.documentsTable.boardId, b.id));
      await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.entityId, b.id));
      await db.delete(mod.boardsTable).where(eq(mod.boardsTable.id, b.id));
    }
    for (const p of PEOPLE) {
      await db.insert(mod.peopleTable).values({ ...p, passwordHash: hash });
      const [row] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, p.email));
      id[p.email] = row.id;
    }
    const [board] = await db.insert(mod.boardsTable).values({ name: BOARD_NAME, abbreviation: "AE", type: "board" }).returning();
    boardId = board.id;
    const [doc] = await db.insert(mod.documentsTable).values({ boardId, title: "D", filename: "d.pdf", uploadedBy: id[admin.email] }).returning();
    docId = doc.id;

    // Seed the event log with controlled timestamps.
    await db.insert(mod.accessEventsTable).values([
      // `granted` gets an explicit grant on the doc at T1, revoked at T2.
      { entityType: "document", entityId: docId, personId: id[granted.email], event: "granted", at: T1 },
      { entityType: "document", entityId: docId, personId: id[granted.email], event: "revoked", at: T2 },
      // `memberP` joins the board at T1, leaves at T2 — access via membership only.
      { entityType: "board", entityId: boardId, personId: id[memberP.email], event: "board_joined", at: T1 },
      { entityType: "board", entityId: boardId, personId: id[memberP.email], event: "board_left", at: T2 },
    ]);
    adminCookie = await cookieFor(admin.email);
  });

  it("an explicit grant is reconstructed between grant and revoke, not after", async () => {
    expect(await reconstruct(MID)).toContain(id[granted.email]);
    expect(await reconstruct(AFTER)).not.toContain(id[granted.email]);
  });

  it("a board member (no explicit grant) is reconstructed for the window they were on the board", async () => {
    expect(await reconstruct(MID)).toContain(id[memberP.email]);
    expect(await reconstruct(AFTER)).not.toContain(id[memberP.email]);
  });

  it("before any events, nobody could access", async () => {
    const before = await reconstruct("2025-12-01T00:00:00Z");
    expect(before).not.toContain(id[granted.email]);
    expect(before).not.toContain(id[memberP.email]);
  });
});
