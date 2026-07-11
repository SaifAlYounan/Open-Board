import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { integrationSuite } from "../testutil/integrationSuite";

/**
 * P0.6 — fail-closed audit (F10).
 *
 * The audit write must be transactional with its mutation: if the audit row
 * cannot be written, the mutation must ROLL BACK (not "complete without audit
 * entry"). For audited reads (downloads/exports), an unauditable action must be
 * DENIED, not served.
 *
 * Failure is forced with a BEFORE INSERT trigger on audit_trail that raises —
 * the closest stand-in for "audit storage is broken" reachable from a test.
 */
integrationSuite("fail-closed audit (P0.6)", () => {
  const PASSWORD = "Str0ng-Passw0rd-For-Tests!";
  const adminEmail = "p06-admin@test.local";
  const memberEmail = "p06-member@test.local";
  const BOARD_NAME = "P06 Fail-Closed Board";

  let db: any;
  let mod: any;
  let eq: any;
  let and: any;
  let app: any;
  let adminCookie: string;
  let boardId: string;
  let memberId: string;
  let adminId: string;
  let docId: string;

  let ipCounter = 0;
  async function cookieFor(email: string): Promise<string> {
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", `10.86.0.${++ipCounter}`)
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"];
    return (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
  }

  /**
   * Forcing an audit-write failure means touching `audit_trail`, which every
   * other (parallel) suite also writes to. Two rules keep this from poisoning
   * them:
   *
   *  1. The trigger is installed ONCE for the life of this file and torn down
   *     once — no create/drop churn per test. (A dropped-mid-call function is
   *     exactly how an earlier version made unrelated suites 500.)
   *  2. It raises ONLY for this suite's admin, and only while a control row
   *     says so. Toggling that row is plain DML, so switching failure on and
   *     off costs no DDL and blocks nobody.
   */
  async function installFailTrigger() {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`create table if not exists p06_audit_fail_switch (person_id uuid primary key)`);
    await db.execute(sql`
      create or replace function p06_fail_audit() returns trigger as $$
      begin
        if new.person_id is not null
           and exists (select 1 from p06_audit_fail_switch s where s.person_id = new.person_id) then
          raise exception 'audit write forced to fail (P0.6 test)';
        end if;
        return new;
      end $$ language plpgsql
    `);
    await db.execute(sql`drop trigger if exists p06_fail_audit on audit_trail`);
    await db.execute(sql`
      create trigger p06_fail_audit before insert on audit_trail
      for each row execute function p06_fail_audit()
    `);
  }

  async function teardownFailTrigger() {
    const { sql } = await import("drizzle-orm");
    // Trigger first, then the function it calls — never the other way round.
    await db.execute(sql`drop trigger if exists p06_fail_audit on audit_trail`);
    await db.execute(sql`drop function if exists p06_fail_audit()`);
    await db.execute(sql`drop table if exists p06_audit_fail_switch`);
  }

  async function failAuditFor(personId: string, on: boolean) {
    const { sql } = await import("drizzle-orm");
    if (on) {
      await db.execute(sql`insert into p06_audit_fail_switch (person_id) values (${personId}) on conflict do nothing`);
    } else {
      await db.execute(sql`delete from p06_audit_fail_switch where person_id = ${personId}`);
    }
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    mod = await import("@workspace/db");
    db = mod.db;
    ({ eq, and } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    // A crashed previous run may have left the trigger behind — clear it first.
    await teardownFailTrigger();

    const hash = await bcrypt.hash(PASSWORD, 10);

    // Re-runnable cleanup.
    for (const email of [adminEmail, memberEmail]) {
      const [existing] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, email));
      if (existing) {
        await db.delete(mod.auditTrailTable).where(eq(mod.auditTrailTable.personId, existing.id));
        await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.personId, existing.id));
        await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.actorId, existing.id));
        await db.delete(mod.boardMembershipsTable).where(eq(mod.boardMembershipsTable.personId, existing.id));
        // Documents reference the uploader (FK) — remove them before the person.
        for (const d of await db.select().from(mod.documentsTable).where(eq(mod.documentsTable.uploadedBy, existing.id))) {
          await db.delete(mod.accessControlTable).where(eq(mod.accessControlTable.entityId, d.id));
        }
        await db.delete(mod.documentsTable).where(eq(mod.documentsTable.uploadedBy, existing.id));
        await db.delete(mod.peopleTable).where(eq(mod.peopleTable.id, existing.id));
      }
    }
    for (const b of await db.select().from(mod.boardsTable).where(eq(mod.boardsTable.name, BOARD_NAME))) {
      await db.delete(mod.boardMembershipsTable).where(eq(mod.boardMembershipsTable.boardId, b.id));
      await db.delete(mod.accessEventsTable).where(eq(mod.accessEventsTable.entityId, b.id));
      await db.delete(mod.boardsTable).where(eq(mod.boardsTable.id, b.id));
    }

    await db.insert(mod.peopleTable).values({ name: "P06 Admin", email: adminEmail, role: "admin", passwordHash: hash });
    await db.insert(mod.peopleTable).values({ name: "P06 Member", email: memberEmail, role: "member", passwordHash: hash });
    const [member] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, memberEmail));
    memberId = member.id;
    const [admin] = await db.select().from(mod.peopleTable).where(eq(mod.peopleTable.email, adminEmail));
    adminId = admin.id;

    const [board] = await db
      .insert(mod.boardsTable)
      .values({ name: BOARD_NAME, abbreviation: "P06", type: "board" })
      .returning();
    boardId = board.id;

    // A document the admin can read — the audited-read subject.
    const [doc] = await db
      .insert(mod.documentsTable)
      .values({ title: "P06 Doc", filename: "p06.txt", boardId, uploadedBy: adminId })
      .returning();
    docId = doc.id;

    adminCookie = await cookieFor(adminEmail);

    // Installed once, for the life of this file; inert until switched on.
    await installFailTrigger();
  });

  afterAll(async () => {
    await teardownFailTrigger();
  });

  describe("while audit writes fail", () => {
    beforeEach(async () => {
      await failAuditFor(adminId, true);
    });
    afterEach(async () => {
      await failAuditFor(adminId, false);
    });

    it("a mutation rolls back when its audit entry cannot be written", async () => {
      const res = await request(app)
        .post(`/api/boards/${boardId}/members`)
        .set("Cookie", adminCookie)
        .send({ personId: memberId, roleInBoard: "member" });

      expect(res.status).toBe(500);

      // The mutation must NOT have persisted.
      const memberships = await db
        .select()
        .from(mod.boardMembershipsTable)
        .where(and(eq(mod.boardMembershipsTable.boardId, boardId), eq(mod.boardMembershipsTable.personId, memberId)));
      expect(memberships).toHaveLength(0);

      // Nor its access event.
      const events = await db
        .select()
        .from(mod.accessEventsTable)
        .where(and(eq(mod.accessEventsTable.entityId, boardId), eq(mod.accessEventsTable.personId, memberId)));
      expect(events).toHaveLength(0);
    });

    it("an audited read (document view) is denied when it cannot be audited", async () => {
      // NB: /system/export would be the fatter example, but it is MFA-gated
      // (P0.2) and this suite's admin holds no second factor — the MFA 403 would
      // fire before the audit path, testing nothing. A document read is audited
      // and not MFA-gated, so it exercises exactly the fail-closed behavior.
      const res = await request(app).get(`/api/documents/${docId}`).set("Cookie", adminCookie);
      expect(res.status).toBe(500);
      // Fail closed: no document content may be served unaudited.
      expect(res.body?.filename ?? null).toBeNull();
    });
  });

  describe("when audit writes work again", () => {
    /**
     * NOTE ON SCOPE. These assert properties of the rows THIS test writes, not
     * of the global chain, because the test database is shared: other suites
     * write audit rows concurrently and their cleanups DELETE rows mid-chain,
     * which would make any global "chain intact" assertion flap for reasons
     * that have nothing to do with the code under test. The link algebra itself
     * is proven deterministically in `auditVerify.test.ts`; what belongs here
     * is the concurrency property — the writers never FORK the chain.
     */
    async function rowsFor(action: string) {
      const { asc } = await import("drizzle-orm");
      const rows = await db
        .select()
        .from(mod.auditTrailTable)
        .where(and(eq(mod.auditTrailTable.action, action), eq(mod.auditTrailTable.entityId, boardId)))
        .orderBy(asc(mod.auditTrailTable.seq));
      return rows;
    }

    it("the same mutation succeeds and is written into the chain", async () => {
      const res = await request(app)
        .post(`/api/boards/${boardId}/members`)
        .set("Cookie", adminCookie)
        .send({ personId: memberId, roleInBoard: "member" });
      expect(res.status).toBe(201);

      const memberships = await db
        .select()
        .from(mod.boardMembershipsTable)
        .where(and(eq(mod.boardMembershipsTable.boardId, boardId), eq(mod.boardMembershipsTable.personId, memberId)));
      expect(memberships).toHaveLength(1);

      const rows = await rowsFor("board_member_added");
      expect(rows).toHaveLength(1);
      // Chained (not a first-ever row, so it must carry a predecessor hash).
      expect(rows[0].prevHash).toBeTruthy();
      expect(rows[0].seq).toBeGreaterThan(0);
    });

    it("concurrent audited mutations never fork the hash chain", async () => {
      // Ten concurrent audited mutations (role changes) racing on the chain tail.
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          request(app)
            .patch(`/api/boards/${boardId}/members/${memberId}`)
            .set("Cookie", adminCookie)
            .send({ roleInBoard: i % 2 === 0 ? "member" : "observer" })
        )
      );
      for (const r of results) expect(r.status).toBe(200);

      const rows = await rowsFor("board_member_role_changed");
      expect(rows).toHaveLength(10);

      // A FORK is two rows claiming the same predecessor. Serialization under
      // the advisory lock means every writer saw a different tail, so all ten
      // prev_hashes — and all ten seqs — are distinct.
      const prevHashes = rows.map((r: any) => r.prevHash);
      expect(prevHashes.every((h: string | null) => h != null)).toBe(true);
      expect(new Set(prevHashes).size).toBe(10);
      expect(new Set(rows.map((r: any) => r.seq)).size).toBe(10);
    });
  });
});
