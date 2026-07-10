/**
 * Integration tests for the manual (REST) create/edit/cancel path of
 * governance objects — issue #13. Needs a real Postgres; skips itself when
 * DATABASE_URL is absent, same convention as the other integration suites.
 *
 * Under test:
 *  - authz: a member cannot create/edit votes, tasks, or meetings,
 *  - shared validation: the manual path enforces the SAME size contract the
 *    AI-approval path validates against (no validation bypass),
 *  - state machines: closed votes are immutable; cancelled tasks/meetings are
 *    immutable; done tasks only reopen; meeting transitions are enforced,
 *  - cancel is a lifecycle transition with a distinct audit event, not delete.
 */
import { describe, it, expect, beforeAll } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

d("manual governance CRUD — authz, validation, state machines", () => {
  let app: any;
  let db: any;
  let dbMod: any;
  let eq: any;
  let and: any;
  let inArray: any;

  const PASSWORD = "correct-horse-battery";
  const secretary = { email: "mg-sec@test.local", name: "MG Secretary", role: "admin" as const };
  const member = { email: "mg-member@test.local", name: "MG Member", role: "member" as const };
  const people: Record<string, any> = {};
  let board: any;

  let ipCounter = 0;
  const nextIp = () => `10.96.0.${(++ipCounter % 250) + 1}`;

  const cookieCache: Record<string, string> = {};
  async function cookieFor(email: string): Promise<string> {
    if (cookieCache[email]) return cookieCache[email];
    const res = await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", nextIp())
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const setCookie = res.headers["set-cookie"];
    cookieCache[email] = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(";")[0];
    return cookieCache[email];
  }

  function req(method: "post" | "patch", url: string, cookie: string) {
    return (request(app) as any)[method](url).set("Cookie", cookie).set("X-Forwarded-For", nextIp());
  }

  async function auditRows(action: string, entityId: string): Promise<any[]> {
    const { auditTrailTable } = dbMod;
    return db
      .select()
      .from(auditTrailTable)
      .where(and(eq(auditTrailTable.action, action), eq(auditTrailTable.entityId, entityId)));
  }

  let resCounter = 0;
  async function createVote(cookie: string): Promise<any> {
    const res = await req("post", "/api/votes", cookie).send({
      boardId: board.id,
      resolutionNumber: `RES-MG-${Date.now()}-${++resCounter}`,
      title: "Manual-path resolution",
      resolutionText: "Resolved, that the manual path shares the AI contract.",
      type: "circulation",
    });
    expect(res.status).toBe(201);
    return res.body;
  }

  async function wipe() {
    const { peopleTable, boardsTable, boardMembershipsTable, votesTable, tasksTable, meetingsTable, agendaItemsTable, attendanceTable, accessControlTable, auditTrailTable, loginLockoutsTable } = dbMod;
    const emails = [secretary.email, member.email];
    const rows = await db.select().from(peopleTable).where(inArray(peopleTable.email, emails));
    const ids = rows.map((r: any) => r.id);
    const staleBoards = await db.select().from(boardsTable).where(eq(boardsTable.name, "MG Board"));
    // Tasks first — they hold FKs onto the boards wiped below.
    const { or } = await import("drizzle-orm");
    const staleTaskConds = [eq(tasksTable.title, "MG manual task")];
    if (ids.length) staleTaskConds.push(inArray(tasksTable.assigneeId, ids));
    if (staleBoards.length) staleTaskConds.push(inArray(tasksTable.boardId, staleBoards.map((b: any) => b.id)));
    const staleTasks = await db.select().from(tasksTable).where(or(...staleTaskConds));
    const taskIds = staleTasks.map((t: any) => t.id);
    if (taskIds.length) {
      await db.delete(accessControlTable).where(and(eq(accessControlTable.entityType, "task"), inArray(accessControlTable.entityId, taskIds)));
      await db.delete(tasksTable).where(inArray(tasksTable.id, taskIds));
    }
    for (const b of staleBoards) {
      const votes = await db.select().from(votesTable).where(eq(votesTable.boardId, b.id));
      const meetings = await db.select().from(meetingsTable).where(eq(meetingsTable.boardId, b.id));
      const voteIds = votes.map((v: any) => v.id);
      const meetingIds = meetings.map((m: any) => m.id);
      if (meetingIds.length) {
        await db.delete(agendaItemsTable).where(inArray(agendaItemsTable.meetingId, meetingIds));
        await db.delete(attendanceTable).where(inArray(attendanceTable.meetingId, meetingIds));
        await db.delete(meetingsTable).where(inArray(meetingsTable.id, meetingIds));
      }
      if (voteIds.length) {
        await db.delete(accessControlTable).where(and(eq(accessControlTable.entityType, "vote"), inArray(accessControlTable.entityId, voteIds)));
        await db.delete(votesTable).where(inArray(votesTable.id, voteIds));
      }
      await db.delete(accessControlTable).where(and(eq(accessControlTable.entityType, "meeting"), inArray(accessControlTable.entityId, meetingIds.length ? meetingIds : ["00000000-0000-0000-0000-000000000000"])));
      await db.delete(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, b.id));
      await db.delete(boardsTable).where(eq(boardsTable.id, b.id));
    }
    if (ids.length) {
      await db.delete(accessControlTable).where(inArray(accessControlTable.personId, ids));
      await db.delete(auditTrailTable).where(inArray(auditTrailTable.personId, ids));
      await db.delete(loginLockoutsTable).where(inArray(loginLockoutsTable.key, emails));
      await db.delete(boardMembershipsTable).where(inArray(boardMembershipsTable.personId, ids));
      await db.delete(peopleTable).where(inArray(peopleTable.id, ids));
    }
  }

  beforeAll(async () => {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    dbMod = await import("@workspace/db");
    db = dbMod.db;
    ({ eq, and, inArray } = await import("drizzle-orm"));
    app = (await import("../app")).default;

    // A bare drizzle-kit-push database lacks the seed-created sequences.
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS task_seq`);

    await wipe();
    const hash = await bcrypt.hash(PASSWORD, 10);
    for (const p of [secretary, member]) {
      const [row] = await db.insert(dbMod.peopleTable).values({ ...p, passwordHash: hash }).returning();
      people[p.email] = row;
    }
    [board] = await db.insert(dbMod.boardsTable).values({ name: "MG Board", abbreviation: "MGB", type: "board" }).returning();
    await db.insert(dbMod.boardMembershipsTable).values({ boardId: board.id, personId: people[member.email].id, roleInBoard: "member" });
  });

  // ── authz ────────────────────────────────────────────────────────────────

  it("a member cannot create votes, tasks, or meetings", async () => {
    const cookie = await cookieFor(member.email);
    const vote = await req("post", "/api/votes", cookie).send({ boardId: board.id, title: "x", resolutionText: "y", type: "simple" });
    const task = await req("post", "/api/tasks", cookie).send({ title: "x" });
    const meeting = await req("post", "/api/meetings", cookie).send({ boardId: board.id, title: "x", date: "2026-08-01" });
    expect(vote.status).toBe(403);
    expect(task.status).toBe(403);
    expect(meeting.status).toBe(403);
  });

  it("a member cannot edit or cancel governance objects", async () => {
    const admin = await cookieFor(secretary.email);
    const vote = await createVote(admin);
    const cookie = await cookieFor(member.email);
    const edit = await req("patch", `/api/votes/${vote.id}`, cookie).send({ title: "hijacked" });
    const cancel = await req("patch", `/api/votes/${vote.id}`, cookie).send({ status: "cancelled" });
    expect(edit.status).toBe(403);
    expect(cancel.status).toBe(403);
  });

  // ── shared validation (no bypass of the AI-path contract) ────────────────

  it("enforces the shared size contract on the manual path", async () => {
    const admin = await cookieFor(secretary.email);
    // title limit (short = 300) — same primitive the AI path validates with.
    const bigTitle = await req("post", "/api/votes", admin).send({
      boardId: board.id, title: "x".repeat(301), resolutionText: "y", type: "simple",
    });
    expect(bigTitle.status).toBe(400);
    // description limit (med = 2000) on tasks.
    const bigDesc = await req("post", "/api/tasks", admin).send({ title: "ok", description: "x".repeat(2001) });
    expect(bigDesc.status).toBe(400);
    // enum-checked type on votes.
    const badType = await req("post", "/api/votes", admin).send({
      boardId: board.id, title: "ok", resolutionText: "y", type: "acclamation",
    });
    expect(badType.status).toBe(400);
    // bad approval-rule type must not fall through to the majority default.
    const badRule = await req("post", "/api/votes", admin).send({
      boardId: board.id, title: "ok", resolutionText: "y", type: "simple", approvalRule: { type: "plurality" },
    });
    expect(badRule.status).toBe(400);
  });

  // ── votes: closed = immutable, cancel audited ────────────────────────────

  it("cancelling a vote is audited and makes it immutable", async () => {
    const admin = await cookieFor(secretary.email);
    const vote = await createVote(admin);

    const editOpen = await req("patch", `/api/votes/${vote.id}`, admin).send({ title: "Edited while open" });
    expect(editOpen.status).toBe(200);

    const cancel = await req("patch", `/api/votes/${vote.id}`, admin).send({ status: "cancelled" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");
    expect((await auditRows("vote_cancelled", vote.id)).length).toBe(1);

    // Edit-after-close 409s; the row still exists (cancel ≠ delete).
    const editClosed = await req("patch", `/api/votes/${vote.id}`, admin).send({ title: "too late" });
    expect(editClosed.status).toBe(409);
    const reCancel = await req("patch", `/api/votes/${vote.id}`, admin).send({ status: "cancelled" });
    expect(reCancel.status).toBe(409);
    const [row] = await db.select().from(dbMod.votesTable).where(eq(dbMod.votesTable.id, vote.id));
    expect(row).toBeTruthy();
    expect(row.title).toBe("Edited while open");
  });

  it("still refuses to force a vote outcome manually", async () => {
    const admin = await cookieFor(secretary.email);
    const vote = await createVote(admin);
    const force = await req("patch", `/api/votes/${vote.id}`, admin).send({ status: "approved" });
    expect(force.status).toBe(403);
  });

  // ── tasks: cancelled terminal, done reopen-only ──────────────────────────

  it("task cancel is audited and terminal; done tasks only reopen", async () => {
    const admin = await cookieFor(secretary.email);
    const created = await req("post", "/api/tasks", admin).send({ title: "MG manual task", boardId: board.id });
    expect(created.status).toBe(201);
    const taskId = created.body.id;

    // done → content edit blocked, pure reopen allowed.
    expect((await req("patch", `/api/tasks/${taskId}`, admin).send({ status: "done" })).status).toBe(200);
    expect((await req("patch", `/api/tasks/${taskId}`, admin).send({ title: "edit after done" })).status).toBe(409);
    expect((await req("patch", `/api/tasks/${taskId}`, admin).send({ status: "in_progress" })).status).toBe(200);

    // cancel → audited, then immutable.
    const cancel = await req("patch", `/api/tasks/${taskId}`, admin).send({ status: "cancelled" });
    expect(cancel.status).toBe(200);
    expect((await auditRows("task_cancelled", taskId)).length).toBe(1);
    expect((await req("patch", `/api/tasks/${taskId}`, admin).send({ title: "no" })).status).toBe(409);
    expect((await req("patch", `/api/tasks/${taskId}`, admin).send({ status: "todo" })).status).toBe(409);
    const [row] = await db.select().from(dbMod.tasksTable).where(eq(dbMod.tasksTable.id, taskId));
    expect(row.status).toBe("cancelled"); // cancel ≠ delete
  });

  // ── meetings: transition map, cancel audited + terminal ──────────────────

  it("meeting lifecycle: conclude (regression), reopen, cancel audited + immutable", async () => {
    const admin = await cookieFor(secretary.email);
    const created = await req("post", "/api/meetings", admin).send({
      boardId: board.id,
      title: "MG manual meeting",
      date: "2026-08-15T10:00:00Z",
      agendaItems: [{ position: 1, title: "Opening", type: "information" }],
    });
    expect(created.status).toBe(201);
    const meetingId = created.body.id;

    // "Mark Concluded" used to 400 (route rejected the schema's own status).
    expect((await req("patch", `/api/meetings/${meetingId}`, admin).send({ status: "concluded" })).status).toBe(200);
    // Concluded content is immutable until reopened.
    expect((await req("patch", `/api/meetings/${meetingId}`, admin).send({ title: "no" })).status).toBe(409);
    expect((await req("patch", `/api/meetings/${meetingId}`, admin).send({ status: "scheduled" })).status).toBe(200);
    expect((await req("patch", `/api/meetings/${meetingId}`, admin).send({ title: "Edited while scheduled" })).status).toBe(200);

    // Cancel: audited, terminal, agenda mutations blocked, record kept.
    const cancel = await req("patch", `/api/meetings/${meetingId}`, admin).send({ status: "cancelled" });
    expect(cancel.status).toBe(200);
    expect((await auditRows("meeting_cancelled", meetingId)).length).toBe(1);
    expect((await req("patch", `/api/meetings/${meetingId}`, admin).send({ status: "scheduled" })).status).toBe(409);
    expect((await req("patch", `/api/meetings/${meetingId}`, admin).send({ title: "no" })).status).toBe(409);
    expect((await req("post", `/api/meetings/${meetingId}/agenda`, admin).send({ title: "late item", type: "information" })).status).toBe(409);
    const [row] = await db.select().from(dbMod.meetingsTable).where(eq(dbMod.meetingsTable.id, meetingId));
    expect(row.status).toBe("cancelled");
    expect(row.title).toBe("Edited while scheduled");
  });
});
