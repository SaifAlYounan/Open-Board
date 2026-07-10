import { Router } from "express";
import crypto from "crypto";
import {
  db,
  minutesTable,
  minutesSuggestionsTable,
  minutesSignaturesTable,
  meetingsTable,
  boardsTable,
  boardMembershipsTable,
  peopleTable,
  accessControlTable,
} from "@workspace/db";
import { eq, and, ne, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { sanitizeRichHtml, sanitizeText } from "../lib/sanitize";
import { parsePagination } from "../lib/pagination";
import { grantDefaultAccess } from "../lib/access";
import { groupBy } from "../lib/group";
import { audit } from "../lib/auditLog";
import { logger } from "../lib/logger";
import { writeLimiter } from "../lib/rateLimiters";

const COMMENT_COLORS = [
  "#ff3b30", "#ff9500", "#34c759", "#0071e3", "#5856d6", "#af52de",
  "#ff2d55", "#5ac8fa", "#30b0c7", "#64d2ff",
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const router = Router();

router.param("id", (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid id format" });
    return;
  }
  next();
});

router.param("commentId", (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid commentId format" });
    return;
  }
  next();
});

router.get("/minutes", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { boardId, status } = req.query;
  const { limit, offset } = parsePagination(req.query);

  // Status + draft filters go to SQL; draft is hidden from everyone but admin.
  const conds = [];
  if (typeof status === "string") conds.push(eq(minutesTable.status, status as never));
  if (user.role !== "admin") conds.push(ne(minutesTable.status, "draft"));

  let allMinutes = await db
    .select()
    .from(minutesTable)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(minutesTable.updatedAt);

  // Batch-load the meetings + boards these minutes belong to (was one query per
  // minute, twice over).
  const meetingIds = [...new Set(allMinutes.map((m) => m.meetingId).filter((v): v is string => v != null))];
  const meetings = meetingIds.length ? await db.select().from(meetingsTable).where(inArray(meetingsTable.id, meetingIds)) : [];
  const meetingById = new Map(meetings.map((mt) => [mt.id, mt]));
  const meetingBoardIds = [...new Set(meetings.map((mt) => mt.boardId).filter((v): v is string => v != null))];
  const boards = meetingBoardIds.length ? await db.select().from(boardsTable).where(inArray(boardsTable.id, meetingBoardIds)) : [];
  const boardById = new Map(boards.map((b) => [b.id, b]));

  // Access control — non-admins (incl. management) see only minutes from boards
  // they're assigned to.
  if (user.role !== "admin") {
    const memberships = await db
      .select({ boardId: boardMembershipsTable.boardId })
      .from(boardMembershipsTable)
      .where(eq(boardMembershipsTable.personId, user.id));
    const memberBoardIds = new Set(memberships.map((m) => m.boardId));
    allMinutes = allMinutes.filter((m) => {
      const boardIdOfMinutes = m.meetingId ? meetingById.get(m.meetingId)?.boardId : null;
      return boardIdOfMinutes != null && memberBoardIds.has(boardIdOfMinutes);
    });
  }

  // Optional board filter (applied after access, as before).
  if (typeof boardId === "string") {
    allMinutes = allMinutes.filter((m) => {
      const boardIdOfMinutes = m.meetingId ? meetingById.get(m.meetingId)?.boardId : null;
      return boardIdOfMinutes === boardId;
    });
  }

  allMinutes = allMinutes.slice(offset, offset + limit);

  // Batch signatures + comments for the page.
  const pageIds = allMinutes.map((m) => m.id);
  const sigs = pageIds.length ? await db.select().from(minutesSignaturesTable).where(inArray(minutesSignaturesTable.minutesId, pageIds)) : [];
  const comments = pageIds.length ? await db.select().from(minutesSuggestionsTable).where(inArray(minutesSuggestionsTable.minutesId, pageIds)) : [];
  const sigsByMinutes = groupBy(sigs, (s) => s.minutesId);
  const commentsByMinutes = groupBy(comments, (c) => c.minutesId);

  const result = allMinutes.map((m) => {
    const meeting = m.meetingId ? meetingById.get(m.meetingId) : null;
    const board = meeting?.boardId ? boardById.get(meeting.boardId) : null;
    const minutesSigs = sigsByMinutes.get(m.id) ?? [];
    return {
      ...m,
      meetingTitle: meeting?.title || null,
      meetingDate: meeting?.date || null,
      boardName: board?.name || null,
      signatureCount: minutesSigs.length,
      commentCount: (commentsByMinutes.get(m.id) ?? []).length,
      hasSigned: minutesSigs.some((s) => s.personId === user.id),
    };
  });

  res.json(result);
});

router.post("/minutes", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const { meetingId, content } = req.body;
  if (!meetingId || content == null) {
    res.status(400).json({ error: "Required: meetingId, content" });
    return;
  }

  const cleanContent = sanitizeRichHtml(content);

  // If minutes already exist for this meeting, update content instead of inserting (unique constraint on meeting_id)
  const existingList = await db.select().from(minutesTable).where(eq(minutesTable.meetingId, meetingId)).limit(1);
  if (existingList.length) {
    const existing = existingList[0];
    if (existing.status === "signing" || existing.status === "signed") {
      res.status(409).json({ error: `Minutes in '${existing.status}' are locked and cannot be edited. Return them to review first.` });
      return;
    }
    const [updated] = await db.update(minutesTable).set({ content: cleanContent, updatedAt: new Date() }).where(eq(minutesTable.id, existing.id)).returning();
    const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
    audit(req, "minutes_saved", "minutes", existing.id, { meetingTitle: meeting?.title });
    res.json({ ...updated, meetingTitle: meeting?.title || null, meetingDate: meeting?.date || null, boardName: null, signatureCount: 0, commentCount: 0, hasSigned: false });
    return;
  }

  const [minutes] = await db
    .insert(minutesTable)
    .values({ meetingId, content: cleanContent })
    .returning();

  // Grant access based on board
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  if (meeting?.boardId) {
    await grantDefaultAccess("minutes", minutes.id, meeting.boardId);
  }

  audit(req, "minutes_saved", "minutes", minutes.id, { meetingTitle: meeting?.title });
  res.status(201).json({
    ...minutes,
    meetingTitle: meeting?.title || null,
    meetingDate: meeting?.date || null,
    boardName: null,
    signatureCount: 0,
    commentCount: 0,
    hasSigned: false,
  });
});

router.get("/minutes/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const [minutes] = await db.select().from(minutesTable).where(eq(minutesTable.id, id));
  if (!minutes) {
    res.status(404).json({ error: "Minutes not found" });
    return;
  }

  // Non-admin can't see drafts
  if (user.role !== "admin" && minutes.status === "draft") {
    res.status(403).json({ error: "Access denied" });
    return;
  }

  const [meeting] = minutes.meetingId
    ? await db.select().from(meetingsTable).where(eq(meetingsTable.id, minutes.meetingId))
    : [null];
  const [board] = meeting?.boardId
    ? await db.select().from(boardsTable).where(eq(boardsTable.id, meeting.boardId))
    : [null];

  // Non-admin: verify board membership (management also needs to be assigned to
  // the board). Fail closed on board-less minutes — with no board there is no
  // membership to authorize against, so a non-admin must not read (F3).
  if (user.role !== "admin") {
    if (!meeting?.boardId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const membership = await db
      .select()
      .from(boardMembershipsTable)
      .where(and(eq(boardMembershipsTable.boardId, meeting.boardId), eq(boardMembershipsTable.personId, user.id)));
    if (!membership.length) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  const signatures = await db
    .select()
    .from(minutesSignaturesTable)
    .where(eq(minutesSignaturesTable.minutesId, id));

  const signaturesWithPeople = await Promise.all(
    signatures.map(async (s) => {
      const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, s.personId!));
      const { passwordHash: _, ...safePerson } = person || { passwordHash: "" };
      return { ...s, person: safePerson };
    })
  );

  const comments = await db
    .select()
    .from(minutesSuggestionsTable)
    .where(eq(minutesSuggestionsTable.minutesId, id))
    .orderBy(minutesSuggestionsTable.createdAt);

  const commentsWithPeople = await Promise.all(
    comments.map(async (c) => {
      const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, c.personId!));
      const { passwordHash: _, ...safePerson } = person || { passwordHash: "" };
      return { ...c, person: safePerson };
    })
  );

  const mySignature = signatures.find((s) => s.personId === user.id);

  res.json({
    ...minutes,
    meetingTitle: meeting?.title || null,
    meetingDate: meeting?.date || null,
    boardName: board?.name || null,
    signatures: signaturesWithPeople,
    comments: commentsWithPeople,
    hasSigned: !!mySignature,
  });
});

router.patch("/minutes/:id", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { content } = req.body;
  if (content == null) {
    res.status(400).json({ error: "content required" });
    return;
  }

  // Once minutes enter signing (or are signed), their content is frozen — people
  // sign a specific text, and each signature hashes that text. Editing afterward
  // would silently invalidate collected signatures.
  const [current] = await db.select({ status: minutesTable.status }).from(minutesTable).where(eq(minutesTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Minutes not found" });
    return;
  }
  if (current.status === "signing" || current.status === "signed") {
    res.status(409).json({ error: `Minutes in '${current.status}' are locked and cannot be edited. Return them to review first.` });
    return;
  }

  const [minutes] = await db
    .update(minutesTable)
    .set({ content: sanitizeRichHtml(content), updatedAt: new Date() })
    .where(eq(minutesTable.id, id))
    .returning();

  if (!minutes) {
    res.status(404).json({ error: "Minutes not found" });
    return;
  }

  await audit(req, "minutes_content_updated", "minutes", id, { contentLength: String(content).length });
  res.json({ ...minutes, meetingTitle: null, meetingDate: null, boardName: null, signatureCount: 0, commentCount: 0, hasSigned: false });
});

const VALID_MINUTES_STATUSES = ["draft", "review", "signing", "signed"];

// The minutes lifecycle is a one-way-ish state machine. `signed` is terminal
// and immutable; `signed` can only be reached from `signing` and only once at
// least one signature has been collected. Reopening (backward) is allowed up to
// `signing` so an error can be corrected before anyone signs.
const ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  draft: ["review"],
  review: ["draft", "signing"],
  signing: ["review", "signed"],
  signed: [],
};

router.patch("/minutes/:id/status", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { status } = req.body;
  if (!status) {
    res.status(400).json({ error: "status required" });
    return;
  }

  if (!VALID_MINUTES_STATUSES.includes(status)) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_MINUTES_STATUSES.join(", ")}` });
    return;
  }

  const [current] = await db.select().from(minutesTable).where(eq(minutesTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Minutes not found" });
    return;
  }

  const currentStatus = current.status ?? "draft";
  if (status !== currentStatus) {
    const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(status)) {
      res.status(409).json({ error: `Cannot move minutes from '${currentStatus}' to '${status}'.` });
      return;
    }
    // Minutes may only be marked signed once at least one signature exists —
    // an admin can't declare unsigned minutes "signed".
    if (status === "signed") {
      const sigs = await db.select().from(minutesSignaturesTable).where(eq(minutesSignaturesTable.minutesId, id));
      if (sigs.length === 0) {
        res.status(409).json({ error: "Minutes cannot be marked signed before any signatures are collected." });
        return;
      }
    }
  }

  const [minutes] = await db
    .update(minutesTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(minutesTable.id, id))
    .returning();

  await audit(req, "minutes_status_changed", "minutes", id, { from: current.status, to: status });
  res.json({ ...minutes, meetingTitle: null, meetingDate: null, boardName: null, signatureCount: 0, commentCount: 0, hasSigned: false });
});

router.post("/minutes/:id/sign", requireAuth, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const [minutes] = await db.select().from(minutesTable).where(eq(minutesTable.id, id));
  if (!minutes || minutes.status !== "signing") {
    res.status(400).json({ error: "Minutes are not in signing status" });
    return;
  }

  // Object-level authorization: only a member of THIS minutes' board with a
  // signing-eligible role may sign. Without this, any authenticated user who
  // knows a minutes UUID could forge a signature on another board's official
  // minutes. Observers may read but not sign. (Admins always pass.)
  if (user.role !== "admin") {
    const [meeting] = minutes.meetingId
      ? await db.select().from(meetingsTable).where(eq(meetingsTable.id, minutes.meetingId))
      : [null];
    if (!meeting?.boardId) {
      res.status(403).json({ error: "You are not eligible to sign these minutes" });
      return;
    }
    const [membership] = await db
      .select()
      .from(boardMembershipsTable)
      .where(and(eq(boardMembershipsTable.boardId, meeting.boardId), eq(boardMembershipsTable.personId, user.id)));
    if (!membership || membership.roleInBoard === "observer") {
      res.status(403).json({ error: "You are not eligible to sign these minutes" });
      return;
    }
  }

  const timestamp = new Date().toISOString();
  const hash = crypto
    .createHash("sha256")
    .update(minutes.content + user.name + timestamp)
    .digest("hex");

  try {
    const [sig] = await db
      .insert(minutesSignaturesTable)
      .values({ minutesId: id, personId: user.id, signatureHash: hash })
      .returning();

    const { passwordHash: _, ...safePerson } = user;
    audit(req, "minutes_signed", "minutes", id);
    res.json({ ...sig, person: safePerson });
  } catch (err: unknown) {
    const anyErr = err as { code?: string; cause?: { code?: string } };
    const pgCode = anyErr.code ?? anyErr.cause?.code;
    if (pgCode === "23505") {
      res.status(409).json({ error: "Already signed" });
      return;
    }
    logger.error({ err }, "Failed to record minutes signature");
    res.status(500).json({ error: "Failed to record signature" });
  }
});

router.get("/minutes/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const [minutes] = await db.select().from(minutesTable).where(eq(minutesTable.id, id));
  if (!minutes) {
    res.status(404).json({ error: "Minutes not found" });
    return;
  }

  // Fail closed: board-less minutes (or minutes with no meeting) have no board
  // membership to authorize against, so a non-admin must not read comments (F3).
  if (user.role !== "admin") {
    const [meeting] = minutes.meetingId
      ? await db.select().from(meetingsTable).where(eq(meetingsTable.id, minutes.meetingId))
      : [null];
    if (!meeting?.boardId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const [membership] = await db
      .select()
      .from(boardMembershipsTable)
      .where(and(eq(boardMembershipsTable.boardId, meeting.boardId), eq(boardMembershipsTable.personId, user.id)));
    if (!membership) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  const comments = await db
    .select()
    .from(minutesSuggestionsTable)
    .where(eq(minutesSuggestionsTable.minutesId, id))
    .orderBy(minutesSuggestionsTable.createdAt);

  const result = await Promise.all(
    comments.map(async (c) => {
      const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, c.personId!));
      const { passwordHash: _, ...safePerson } = person || { passwordHash: "" };
      return { ...c, person: safePerson };
    })
  );

  res.json(result);
});

router.post("/minutes/:id/comments", requireAuth, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;
  const { originalText, commentText } = req.body;

  if (!originalText || !commentText) {
    res.status(400).json({ error: "originalText and commentText required" });
    return;
  }

  const [minutes] = await db.select().from(minutesTable).where(eq(minutesTable.id, id));
  if (!minutes) {
    res.status(404).json({ error: "Minutes not found" });
    return;
  }

  // Object-level authorization: only board members (or admin) may comment on a
  // board's minutes. Without this, any authenticated user who knows a minutes
  // UUID could inject comments on another board's governance record.
  //   F3: fail closed on board-less minutes (no board → no membership to check).
  //   F2: observers are read-only everywhere else — reject them here too, mirroring
  //       the /sign path so the policy is consistent.
  if (user.role !== "admin") {
    const [meeting] = minutes.meetingId
      ? await db.select().from(meetingsTable).where(eq(meetingsTable.id, minutes.meetingId))
      : [null];
    if (!meeting?.boardId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    const [membership] = await db
      .select()
      .from(boardMembershipsTable)
      .where(and(eq(boardMembershipsTable.boardId, meeting.boardId), eq(boardMembershipsTable.personId, user.id)));
    if (!membership || membership.roleInBoard === "observer") {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  const cleanOriginalText = sanitizeText(originalText);
  const cleanCommentText = sanitizeText(commentText);

  // Assign a color based on person index (deterministic)
  const [existingComments] = [
    await db.select().from(minutesSuggestionsTable).where(eq(minutesSuggestionsTable.minutesId, id)),
  ];
  const personCommentIdx = existingComments.filter(
    (c, i, arr) => arr.findIndex((a) => a.personId === c.personId) === i
  ).findIndex((c) => c.personId === user.id);
  const colorIdx = personCommentIdx >= 0 ? personCommentIdx : existingComments.filter(
    (c, i, arr) => arr.findIndex((a) => a.personId === c.personId) === i
  ).length;
  const color = COMMENT_COLORS[colorIdx % COMMENT_COLORS.length];

  const [comment] = await db
    .insert(minutesSuggestionsTable)
    .values({ minutesId: id, personId: user.id, originalText: cleanOriginalText, commentText: cleanCommentText, color })
    .returning();

  await audit(req, "minutes_comment_added", "minutes", id, { commentId: comment.id });
  const { passwordHash: _, ...safePerson } = user;
  res.status(201).json({ ...comment, person: safePerson });
});

router.patch("/minutes/:id/comments/:commentId", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const commentId = Array.isArray(req.params.commentId) ? req.params.commentId[0] : req.params.commentId;
  const { status } = req.body;

  const VALID_SUGGESTION_STATUSES = ["resolved", "dismissed"];
  if (!status || !VALID_SUGGESTION_STATUSES.includes(status)) {
    res.status(400).json({ error: `Invalid status. Must be one of: ${VALID_SUGGESTION_STATUSES.join(", ")}` });
    return;
  }

  const [comment] = await db
    .update(minutesSuggestionsTable)
    .set({ status })
    .where(eq(minutesSuggestionsTable.id, commentId))
    .returning();

  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, comment.personId!));
  const { passwordHash: _, ...safePerson } = person || { passwordHash: "" };
  res.json({ ...comment, person: safePerson });
});

export default router;
