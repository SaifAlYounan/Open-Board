import { Router } from "express";
import {
  db,
  meetingsTable,
  boardsTable,
  agendaItemsTable,
  attendanceTable,
  boardMembershipsTable,
  peopleTable,
  accessControlTable,
} from "@workspace/db";
import { eq, and, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { sanitizeText } from "../lib/sanitize";
import { createMeetingBody, updateMeetingBody, parseBody, MEETING_TRANSITIONS } from "../lib/governanceSchemas";
import { pick } from "../lib/pick";
import { parsePagination } from "../lib/pagination";
import { groupBy } from "../lib/group";
import { grantDefaultAccess } from "../lib/access";
import { audit } from "../lib/auditLog";
import { retainDeleted } from "../lib/retention";
import { writeLimiter } from "../lib/rateLimiters";
import { emitInvalidate } from "../lib/realtime";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENDA_TYPES = ["information", "discussion", "decision"] as const;
type AgendaType = (typeof AGENDA_TYPES)[number];
const router = Router();

router.param("id", (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid id format" });
    return;
  }
  next();
});

router.param("itemId", (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid itemId format" });
    return;
  }
  next();
});

async function getMeetingDetail(meetingId: string, userId: string, role: string) {
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  if (!meeting) return null;

  const [board] = meeting.boardId
    ? await db.select().from(boardsTable).where(eq(boardsTable.id, meeting.boardId))
    : [null];

  const agendaItems = await db
    .select()
    .from(agendaItemsTable)
    .where(eq(agendaItemsTable.meetingId, meetingId))
    .orderBy(agendaItemsTable.position);

  const attendanceRows = await db
    .select()
    .from(attendanceTable)
    .where(eq(attendanceTable.meetingId, meetingId));

  const attendance = await Promise.all(
    attendanceRows.map(async (a) => {
      const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, a.personId!));
      const { passwordHash: _, ...safePerson } = person || { passwordHash: "" };
      return { ...a, person: safePerson };
    })
  );

  return {
    ...meeting,
    boardName: board?.name,
    boardAbbreviation: board?.abbreviation,
    agendaItems: agendaItems.map((ai) => ({ ...ai, documents: [] })),
    attendance,
  };
}

router.get("/meetings", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { boardId } = req.query;
  const { limit, offset } = parsePagination(req.query);

  // Push filters + membership-scoping + pagination into SQL (was: fetch every
  // meeting, filter/slice in JS, then one board + one agenda query per meeting).
  const conds = [];
  if (typeof boardId === "string") conds.push(eq(meetingsTable.boardId, boardId));
  if (user.role !== "admin") {
    // Non-admins see meetings of any board they belong to — same rule as before
    // (board-less meetings stay admin-only, since inArray never matches NULL).
    const memberships = await db
      .select({ boardId: boardMembershipsTable.boardId })
      .from(boardMembershipsTable)
      .where(eq(boardMembershipsTable.personId, user.id));
    const memberBoardIds = [...new Set(memberships.map((m) => m.boardId).filter((v): v is string => v != null))];
    if (memberBoardIds.length === 0) {
      res.json([]);
      return;
    }
    conds.push(inArray(meetingsTable.boardId, memberBoardIds));
  }

  const meetings = await db
    .select()
    .from(meetingsTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(meetingsTable.date)
    .limit(limit)
    .offset(offset);

  // Batch-load the enrichment — one query per relation, not one per meeting.
  const meetingIds = meetings.map((m) => m.id);
  const boardIds = [...new Set(meetings.map((m) => m.boardId).filter((v): v is string => v != null))];

  const boards = boardIds.length ? await db.select().from(boardsTable).where(inArray(boardsTable.id, boardIds)) : [];
  const boardById = new Map(boards.map((b) => [b.id, b]));
  const items = meetingIds.length
    ? await db
        .select({ meetingId: agendaItemsTable.meetingId })
        .from(agendaItemsTable)
        .where(inArray(agendaItemsTable.meetingId, meetingIds))
    : [];
  const itemsByMeeting = groupBy(items, (i) => i.meetingId);

  const result = meetings.map((m) => {
    const board = m.boardId ? boardById.get(m.boardId) : null;
    return {
      ...m,
      boardName: board?.name || null,
      boardAbbreviation: board?.abbreviation || null,
      agendaItemCount: itemsByMeeting.get(m.id)?.length ?? 0,
    };
  });

  res.json(result);
});

router.post("/meetings", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  // Shared contract with the AI-approval path (same size limits, typed agenda items).
  const parsed = parseBody(createMeetingBody, pick(req.body, ["boardId", "title", "date", "location", "agendaItems"] as (keyof typeof req.body)[]), res);
  if (!parsed) return;
  const { boardId, title, date, location, agendaItems } = parsed;

  const cleanTitle = sanitizeText(title);
  const cleanLocation = location ? sanitizeText(location) : undefined;

  const [meeting] = await db
    .insert(meetingsTable)
    .values({ boardId, title: cleanTitle, date: new Date(date), location: cleanLocation })
    .returning();

  // Create agenda items — coerce unknown types to a safe default rather than crashing on insert
  if (agendaItems?.length) {
    await db.insert(agendaItemsTable).values(
      agendaItems.map((item) => ({
        meetingId: meeting.id,
        position: item.position,
        title: sanitizeText(item.title),
        type: (AGENDA_TYPES.includes(item.type) ? item.type : "information") as AgendaType,
        description: item.description ? sanitizeText(item.description) : undefined,
      }))
    );
  }

  // Set up attendance for all board members
  const members = await db
    .select()
    .from(boardMembershipsTable)
    .where(eq(boardMembershipsTable.boardId, boardId));

  if (members.length) {
    await db
      .insert(attendanceTable)
      .values(
        members.map((m) => ({
          meetingId: meeting.id,
          personId: m.personId!,
          status: "pending" as const,
        }))
      )
      .onConflictDoNothing();
  }

  // Grant access
  await grantDefaultAccess("meeting", meeting.id, boardId);

  const [board] = boardId
    ? await db.select().from(boardsTable).where(eq(boardsTable.id, boardId))
    : [null];

  res.status(201).json({
    ...meeting,
    boardName: board?.name || null,
    boardAbbreviation: board?.abbreviation || null,
    agendaItemCount: agendaItems?.length || 0,
  });
  audit(req, "meeting_created", "meeting", meeting.id, { title: meeting.title, boardName: board?.name });
  emitInvalidate("meetings", { boardId, id: meeting.id });
});

router.get("/meetings/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const detail = await getMeetingDetail(id, user.id, user.role);
  if (!detail) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }

  if (user.role !== "admin" && detail.boardId) {
    const [membership] = await db
      .select()
      .from(boardMembershipsTable)
      .where(and(eq(boardMembershipsTable.boardId, detail.boardId), eq(boardMembershipsTable.personId, user.id)));
    if (!membership) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  res.json(detail);
});

router.patch("/meetings/:id", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  // Shared contract with the AI-approval path (same size limits, enum-checked
  // status — this also fixes the old mismatch where the route rejected the
  // "concluded" status the schema and UI actually use).
  const parsed = parseBody(updateMeetingBody, pick(req.body, ["title", "date", "location", "status"] as (keyof typeof req.body)[]), res);
  if (!parsed) return;
  const { title, date, location, status } = parsed;

  // State machine (issue #13): scheduled → concluded|cancelled, concluded →
  // scheduled (reopen). `cancelled` is terminal and immutable (cancel ≠ delete).
  const [current] = await db.select({ status: meetingsTable.status }).from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }
  const currentStatus = current.status ?? "scheduled";
  if (currentStatus === "cancelled") {
    res.status(409).json({ error: "A cancelled meeting is immutable" });
    return;
  }
  if (status != null && status !== currentStatus && !MEETING_TRANSITIONS[currentStatus]?.includes(status)) {
    res.status(409).json({ error: `Cannot move a ${currentStatus} meeting to ${status}` });
    return;
  }
  // Content edits require a scheduled meeting; a concluded one must be reopened first.
  const contentEdit = title != null || date != null || location != null;
  if (contentEdit && currentStatus !== "scheduled") {
    res.status(409).json({ error: `A ${currentStatus} meeting's details cannot be edited — reopen it first` });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (title != null) updates.title = sanitizeText(title);
  if (date != null) updates.date = new Date(date);
  if (location != null) updates.location = sanitizeText(location);
  if (status != null) updates.status = status;

  const [meeting] = await db.update(meetingsTable).set(updates).where(eq(meetingsTable.id, id)).returning();
  if (!meeting) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }

  const [board] = meeting.boardId
    ? await db.select().from(boardsTable).where(eq(boardsTable.id, meeting.boardId))
    : [null];

  const updatedItems = await db.select().from(agendaItemsTable).where(eq(agendaItemsTable.meetingId, id));
  audit(req, "meeting_updated", "meeting", id, { title: meeting.title });
  if (status === "cancelled") {
    // Distinct audit event for the lifecycle cancel (cancel ≠ delete — the
    // meeting, agenda, and attendance stay on the record).
    await audit(req, "meeting_cancelled", "meeting", id, { title: meeting.title });
  }
  emitInvalidate("meetings", { boardId: meeting.boardId, id });
  res.json({ ...meeting, boardName: board?.name, boardAbbreviation: board?.abbreviation, agendaItemCount: updatedItems.length });
});

router.delete("/meetings/:id", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  if (meeting) await retainDeleted(req, "meeting", id, meeting);
  await db.delete(meetingsTable).where(eq(meetingsTable.id, id));
  await audit(req, "meeting_deleted", "meeting", id, { title: meeting?.title });
  emitInvalidate("meetings", { boardId: meeting?.boardId, id });
  res.sendStatus(204);
});

router.post("/meetings/:id/agenda", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { title, type, description } = pick(req.body, ["title", "type", "description"] as (keyof typeof req.body)[]) as { title?: string; type?: string; description?: string };
  if (!title || !type) {
    res.status(400).json({ error: "title and type required" });
    return;
  }

  const [agendaMeeting] = await db.select({ status: meetingsTable.status }).from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!agendaMeeting) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }
  if (agendaMeeting.status === "cancelled") {
    res.status(409).json({ error: "A cancelled meeting is immutable" });
    return;
  }

  const VALID_AGENDA_TYPES = ["information", "discussion", "decision"];
  if (!VALID_AGENDA_TYPES.includes(type)) {
    res.status(400).json({ error: `Invalid agenda item type. Must be one of: ${VALID_AGENDA_TYPES.join(", ")}` });
    return;
  }

  const existing = await db.select().from(agendaItemsTable).where(eq(agendaItemsTable.meetingId, id));
  const position = existing.length + 1;

  const [item] = await db
    .insert(agendaItemsTable)
    .values({ meetingId: id, position, title: sanitizeText(title), type: type as AgendaType, description: description ? sanitizeText(description) : undefined })
    .returning();

  const [parentMeeting] = await db.select({ boardId: meetingsTable.boardId }).from(meetingsTable).where(eq(meetingsTable.id, id));
  emitInvalidate("meetings", { boardId: parentMeeting?.boardId, id });
  res.status(201).json(item);
});

router.patch("/meetings/:id/agenda/:itemId", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  const { title, type, description } = pick(req.body, ["title", "type", "description"] as (keyof typeof req.body)[]) as { title?: string; type?: string; description?: string };
  const updates: Record<string, unknown> = {};
  if (title != null) updates.title = sanitizeText(title);
  if (type != null) updates.type = type;
  if (description != null) updates.description = sanitizeText(description);

  const [item] = await db.update(agendaItemsTable).set(updates).where(eq(agendaItemsTable.id, itemId)).returning();
  if (!item) { res.status(404).json({ error: "Agenda item not found" }); return; }
  const [parentMeeting] = item.meetingId
    ? await db.select({ boardId: meetingsTable.boardId }).from(meetingsTable).where(eq(meetingsTable.id, item.meetingId))
    : [null];
  emitInvalidate("meetings", { boardId: parentMeeting?.boardId, id: item.meetingId });
  res.json(item);
});

router.delete("/meetings/:id/agenda/:itemId", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  await db.delete(agendaItemsTable).where(eq(agendaItemsTable.id, itemId));
  const meetingId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [parentMeeting] = await db.select({ boardId: meetingsTable.boardId }).from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  emitInvalidate("meetings", { boardId: parentMeeting?.boardId, id: meetingId });
  res.sendStatus(204);
});

router.get("/meetings/:id/attendance", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  if (user.role !== "admin") {
    const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
    if (meeting?.boardId) {
      const [membership] = await db
        .select()
        .from(boardMembershipsTable)
        .where(and(eq(boardMembershipsTable.boardId, meeting.boardId), eq(boardMembershipsTable.personId, user.id)));
      if (!membership) {
        res.status(403).json({ error: "Access denied" });
        return;
      }
    }
  }

  const attendanceRows = await db
    .select()
    .from(attendanceTable)
    .where(eq(attendanceTable.meetingId, id));

  const result = await Promise.all(
    attendanceRows.map(async (a) => {
      const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, a.personId!));
      const { passwordHash: _, ...safePerson } = person || { passwordHash: "" };
      return { ...a, person: safePerson };
    })
  );

  res.json(result);
});

router.patch("/meetings/:id/attendance", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { updates } = req.body;
  if (!updates?.length) {
    res.status(400).json({ error: "updates array required" });
    return;
  }

  const [meeting] = await db.select({ boardId: meetingsTable.boardId }).from(meetingsTable).where(eq(meetingsTable.id, id));
  if (!meeting) {
    res.status(404).json({ error: "Meeting not found" });
    return;
  }

  // Every personId / proxyHolderId must belong to the meeting's board — an
  // attendance row (or proxy) referencing a non-member is a data-integrity hole
  // that would let a proxy be assigned to someone outside the board.
  if (meeting.boardId) {
    const members = await db
      .select({ personId: boardMembershipsTable.personId })
      .from(boardMembershipsTable)
      .where(eq(boardMembershipsTable.boardId, meeting.boardId));
    const memberIds = new Set(members.map((m) => m.personId));
    for (const update of updates) {
      if (!update.personId || !memberIds.has(update.personId)) {
        res.status(400).json({ error: "personId is not a member of this meeting's board" });
        return;
      }
      if (update.proxyHolderId && !memberIds.has(update.proxyHolderId)) {
        res.status(400).json({ error: "proxyHolderId is not a member of this meeting's board" });
        return;
      }
    }
  }

  for (const update of updates) {
    await db
      .insert(attendanceTable)
      .values({
        meetingId: id,
        personId: update.personId,
        status: update.status,
        proxyHolderId: update.proxyHolderId,
      })
      .onConflictDoUpdate({
        target: [attendanceTable.meetingId, attendanceTable.personId],
        set: { status: update.status, proxyHolderId: update.proxyHolderId },
      });
  }

  emitInvalidate("meetings", { boardId: meeting.boardId, id });
  res.json({ ok: true });
});

export default router;
