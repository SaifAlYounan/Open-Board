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
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { grantDefaultAccess } from "../lib/access";

const COMMENT_COLORS = [
  "#ff3b30", "#ff9500", "#34c759", "#0071e3", "#5856d6", "#af52de",
  "#ff2d55", "#5ac8fa", "#30b0c7", "#64d2ff",
];

const router = Router();

router.get("/minutes", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { boardId, status } = req.query;

  let allMinutes = await db.select().from(minutesTable).orderBy(minutesTable.updatedAt);

  // Filter by status
  if (status) allMinutes = allMinutes.filter((m) => m.status === status);

  // Filter draft for non-admins
  if (user.role !== "admin") {
    allMinutes = allMinutes.filter((m) => m.status !== "draft");
  }

  // Access control — filter by board membership for board members/observers.
  // Management users are not board members but should see all non-draft minutes
  // (review, signing, signed) so their /management/minutes view is populated.
  // Admin already sees everything (bypasses this block entirely).
  if (user.role !== "admin" && user.role !== "management") {
    const memberships = await db
      .select()
      .from(boardMembershipsTable)
      .where(eq(boardMembershipsTable.personId, user.id));
    const memberBoardIds = new Set(memberships.map((m) => m.boardId));

    // Resolve which minutes belong to accessible boards
    const minutesWithMeeting = await Promise.all(
      allMinutes.map(async (m) => {
        if (!m.meetingId) return null;
        const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, m.meetingId));
        if (meeting?.boardId && memberBoardIds.has(meeting.boardId)) return m;
        return null;
      })
    );
    const accessibleIds = new Set(minutesWithMeeting.filter(Boolean).map((m) => m!.id));
    allMinutes = allMinutes.filter((m) => accessibleIds.has(m.id));
  }

  const result = await Promise.all(
    allMinutes.map(async (m) => {
      const [meeting] = m.meetingId
        ? await db.select().from(meetingsTable).where(eq(meetingsTable.id, m.meetingId))
        : [null];
      const [board] = meeting?.boardId
        ? await db.select().from(boardsTable).where(eq(boardsTable.id, meeting.boardId))
        : [null];

      // Only do this filter if boardId was requested
      if (boardId && board?.id !== boardId) return null;

      const sigs = await db.select().from(minutesSignaturesTable).where(eq(minutesSignaturesTable.minutesId, m.id));
      const comments = await db.select().from(minutesSuggestionsTable).where(eq(minutesSuggestionsTable.minutesId, m.id));
      const mySignature = sigs.find((s) => s.personId === user.id);

      return {
        ...m,
        meetingTitle: meeting?.title || null,
        meetingDate: meeting?.date || null,
        boardName: board?.name || null,
        signatureCount: sigs.length,
        commentCount: comments.length,
        hasSigned: !!mySignature,
      };
    })
  );

  res.json(result.filter(Boolean));
});

router.post("/minutes", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { meetingId, content } = req.body;
  if (!meetingId || content == null) {
    res.status(400).json({ error: "Required: meetingId, content" });
    return;
  }

  // If minutes already exist for this meeting, update content instead of inserting (unique constraint on meeting_id)
  const existingList = await db.select().from(minutesTable).where(eq(minutesTable.meetingId, meetingId)).limit(1);
  if (existingList.length) {
    const existing = existingList[0];
    const [updated] = await db.update(minutesTable).set({ content, updatedAt: new Date() }).where(eq(minutesTable.id, existing.id)).returning();
    const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
    res.json({ ...updated, meetingTitle: meeting?.title || null, meetingDate: meeting?.date || null, boardName: null, signatureCount: 0, commentCount: 0, hasSigned: false });
    return;
  }

  const [minutes] = await db
    .insert(minutesTable)
    .values({ meetingId, content })
    .returning();

  // Grant access based on board
  const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, meetingId));
  if (meeting?.boardId) {
    await grantDefaultAccess("minutes", minutes.id, meeting.boardId);
  }

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

  // Non-admin: verify board membership
  if (user.role !== "admin" && meeting?.boardId) {
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

router.patch("/minutes/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { content } = req.body;
  if (content == null) {
    res.status(400).json({ error: "content required" });
    return;
  }

  const [minutes] = await db
    .update(minutesTable)
    .set({ content, updatedAt: new Date() })
    .where(eq(minutesTable.id, id))
    .returning();

  if (!minutes) {
    res.status(404).json({ error: "Minutes not found" });
    return;
  }

  res.json({ ...minutes, meetingTitle: null, meetingDate: null, boardName: null, signatureCount: 0, commentCount: 0, hasSigned: false });
});

router.patch("/minutes/:id/status", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { status } = req.body;
  if (!status) {
    res.status(400).json({ error: "status required" });
    return;
  }

  const [minutes] = await db
    .update(minutesTable)
    .set({ status, updatedAt: new Date() })
    .where(eq(minutesTable.id, id))
    .returning();

  if (!minutes) {
    res.status(404).json({ error: "Minutes not found" });
    return;
  }

  res.json({ ...minutes, meetingTitle: null, meetingDate: null, boardName: null, signatureCount: 0, commentCount: 0, hasSigned: false });
});

router.post("/minutes/:id/sign", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const [minutes] = await db.select().from(minutesTable).where(eq(minutesTable.id, id));
  if (!minutes || minutes.status !== "signing") {
    res.status(400).json({ error: "Minutes are not in signing status" });
    return;
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
    res.json({ ...sig, person: safePerson });
  } catch (err: unknown) {
    const anyErr = err as { code?: string };
    if (anyErr.code === "23505") {
      res.status(409).json({ error: "Already signed" });
      return;
    }
    throw err;
  }
});

router.get("/minutes/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

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

router.post("/minutes/:id/comments", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;
  const { originalText, commentText } = req.body;

  if (!originalText || !commentText) {
    res.status(400).json({ error: "originalText and commentText required" });
    return;
  }

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
    .values({ minutesId: id, personId: user.id, originalText, commentText, color })
    .returning();

  const { passwordHash: _, ...safePerson } = user;
  res.status(201).json({ ...comment, person: safePerson });
});

router.patch("/minutes/:id/comments/:commentId", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const commentId = Array.isArray(req.params.commentId) ? req.params.commentId[0] : req.params.commentId;
  const { status } = req.body;

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
