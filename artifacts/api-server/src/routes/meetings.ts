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
import { pick } from "../lib/pick";
import { parsePagination } from "../lib/pagination";
import { grantDefaultAccess } from "../lib/access";
import { audit } from "../lib/auditLog";
import { writeLimiter } from "../lib/rateLimiters";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

  let meetings = await db.select().from(meetingsTable).orderBy(meetingsTable.date);

  if (boardId) {
    meetings = meetings.filter((m) => m.boardId === boardId);
  }

  if (user.role !== "admin") {
    // Filter by board membership — show meetings for any board the user belongs to
    const memberships = await db
      .select()
      .from(boardMembershipsTable)
      .where(eq(boardMembershipsTable.personId, user.id));
    const memberBoardIds = new Set(memberships.map((m) => m.boardId));
    meetings = meetings.filter((m) => m.boardId && memberBoardIds.has(m.boardId));
  }

  meetings = meetings.slice(offset, offset + limit);

  const result = await Promise.all(
    meetings.map(async (m) => {
      const [board] = m.boardId
        ? await db.select().from(boardsTable).where(eq(boardsTable.id, m.boardId))
        : [null];
      const items = await db
        .select()
        .from(agendaItemsTable)
        .where(eq(agendaItemsTable.meetingId, m.id));
      return {
        ...m,
        boardName: board?.name || null,
        boardAbbreviation: board?.abbreviation || null,
        agendaItemCount: items.length,
      };
    })
  );

  res.json(result);
});

router.post("/meetings", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const body = pick(req.body, ["boardId", "title", "date", "location", "agendaItems"] as (keyof typeof req.body)[]);
  const { boardId, title, date, location, agendaItems } = body as { boardId?: string; title?: string; date?: string; location?: string; agendaItems?: { position: number; title: string; type: string; description?: string }[] };
  if (!boardId || !title || !date) {
    res.status(400).json({ error: "Required: boardId, title, date" });
    return;
  }

  const cleanTitle = sanitizeText(title);
  const cleanLocation = location ? sanitizeText(location) : undefined;

  const [meeting] = await db
    .insert(meetingsTable)
    .values({ boardId, title: cleanTitle, date: new Date(date), location: cleanLocation })
    .returning();

  // Create agenda items
  if (agendaItems?.length) {
    await db.insert(agendaItemsTable).values(
      agendaItems.map((item) => ({
        meetingId: meeting.id,
        position: item.position,
        title: sanitizeText(item.title),
        type: item.type,
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
  const { title, date, location, status } = pick(req.body, ["title", "date", "location", "status"] as (keyof typeof req.body)[]) as { title?: string; date?: string; location?: string; status?: string };
  const VALID_MEETING_STATUSES = ["scheduled", "in_progress", "adjourned", "cancelled", "completed"];
  if (status != null && !VALID_MEETING_STATUSES.includes(status)) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_MEETING_STATUSES.join(", ")}` });
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
  res.json({ ...meeting, boardName: board?.name, boardAbbreviation: board?.abbreviation, agendaItemCount: updatedItems.length });
});

router.delete("/meetings/:id", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, id));
  await db.delete(meetingsTable).where(eq(meetingsTable.id, id));
  audit(req, "meeting_deleted", "meeting", id, { title: meeting?.title });
  res.sendStatus(204);
});

router.post("/meetings/:id/agenda", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { title, type, description } = pick(req.body, ["title", "type", "description"] as (keyof typeof req.body)[]) as { title?: string; type?: string; description?: string };
  if (!title || !type) {
    res.status(400).json({ error: "title and type required" });
    return;
  }

  const VALID_AGENDA_TYPES = ["discussion", "decision", "information", "approval", "other"];
  if (!VALID_AGENDA_TYPES.includes(type)) {
    res.status(400).json({ error: `Invalid agenda item type. Must be one of: ${VALID_AGENDA_TYPES.join(", ")}` });
    return;
  }

  const existing = await db.select().from(agendaItemsTable).where(eq(agendaItemsTable.meetingId, id));
  const position = existing.length + 1;

  const [item] = await db
    .insert(agendaItemsTable)
    .values({ meetingId: id, position, title: sanitizeText(title), type, description: description ? sanitizeText(description) : undefined })
    .returning();

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
  res.json(item);
});

router.delete("/meetings/:id/agenda/:itemId", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const itemId = Array.isArray(req.params.itemId) ? req.params.itemId[0] : req.params.itemId;
  await db.delete(agendaItemsTable).where(eq(agendaItemsTable.id, itemId));
  res.sendStatus(204);
});

router.get("/meetings/:id/attendance", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  if (user.role !== "admin" && user.role !== "management") {
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

  res.json({ ok: true });
});

export default router;
