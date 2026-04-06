import { Router } from "express";
import {
  db,
  meetingsTable,
  votesTable,
  minutesTable,
  minutesSignaturesTable,
  tasksTable,
  pendingActionsTable,
  accessControlTable,
  boardMembershipsTable,
  voteRecordsTable,
} from "@workspace/db";
import { eq, and, ne, sql, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { callAI, getDatabaseContext, SUGGEST_PROMPT } from "../lib/ai";
import { boardsTable } from "@workspace/db";

const router = Router();

router.get("/dashboard/summary", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;

  let pendingVotesCount = 0;
  let minutesToSignCount = 0;
  let nextMeeting = null;
  let minutesInReviewCount = 0;
  let myTasksCount = 0;
  let overdueTasksCount = 0;
  let pendingActionsCount = 0;
  let openVotesCount = 0;

  if (user.role === "admin") {
    // Admin sees everything
    const [pendingActions] = await db
      .select({ count: sql<number>`count(*)` })
      .from(pendingActionsTable)
      .where(eq(pendingActionsTable.status, "pending"));
    pendingActionsCount = Number(pendingActions.count);

    const [openVotes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(votesTable)
      .where(eq(votesTable.status, "open"));
    openVotesCount = Number(openVotes.count);

    const [reviewMinutes] = await db
      .select({ count: sql<number>`count(*)` })
      .from(minutesTable)
      .where(eq(minutesTable.status, "review"));
    minutesInReviewCount = Number(reviewMinutes.count);

    const upcomingMeetings = await db
      .select()
      .from(meetingsTable)
      .where(eq(meetingsTable.status, "scheduled"))
      .orderBy(meetingsTable.date)
      .limit(1);

    if (upcomingMeetings.length) {
      const m = upcomingMeetings[0];
      const [board] = m.boardId
        ? await db.select().from(boardsTable).where(eq(boardsTable.id, m.boardId))
        : [null];
      nextMeeting = { ...m, boardName: board?.name, boardAbbreviation: board?.abbreviation, agendaItemCount: 0 };
    }
  } else if (user.role === "member") {
    // Board member: show their pending votes, minutes to sign
    const accessible = await db
      .select()
      .from(accessControlTable)
      .where(
        and(
          eq(accessControlTable.personId, user.id),
          eq(accessControlTable.hasAccess, true)
        )
      );
    const voteIds = new Set(accessible.filter((a) => a.entityType === "vote").map((a) => a.entityId));
    const meetingIds = new Set(accessible.filter((a) => a.entityType === "meeting").map((a) => a.entityId));
    const minutesIds = new Set(accessible.filter((a) => a.entityType === "minutes").map((a) => a.entityId));

    const allVotes = await db.select().from(votesTable).where(eq(votesTable.status, "open"));
    const myVotes = allVotes.filter((v) => voteIds.has(v.id));

    // Check which ones the user hasn't voted on
    const { voteRecordsTable } = await import("@workspace/db");
    const myRecords = await db
      .select()
      .from(voteRecordsTable)
      .where(eq(voteRecordsTable.personId, user.id));
    const votedIds = new Set(myRecords.map((r) => r.voteId));
    pendingVotesCount = myVotes.filter((v) => !votedIds.has(v.id)).length;
    openVotesCount = myVotes.length;

    // Minutes to sign
    const allMinutes = await db.select().from(minutesTable).where(eq(minutesTable.status, "signing"));
    const myMinutes = allMinutes.filter((m) => minutesIds.has(m.id));
    const mySigs = await db
      .select()
      .from(minutesSignaturesTable)
      .where(eq(minutesSignaturesTable.personId, user.id));
    const signedIds = new Set(mySigs.map((s) => s.minutesId));
    minutesToSignCount = myMinutes.filter((m) => !signedIds.has(m.id)).length;

    // Minutes in review
    const reviewMinutes = await db.select().from(minutesTable).where(eq(minutesTable.status, "review"));
    minutesInReviewCount = reviewMinutes.filter((m) => minutesIds.has(m.id)).length;

    // Next meeting
    const upcomingMeetings = await db
      .select()
      .from(meetingsTable)
      .where(eq(meetingsTable.status, "scheduled"))
      .orderBy(meetingsTable.date);
    const myMeetings = upcomingMeetings.filter((m) => meetingIds.has(m.id));
    if (myMeetings.length) {
      const m = myMeetings[0];
      const [board] = m.boardId
        ? await db.select().from(boardsTable).where(eq(boardsTable.id, m.boardId))
        : [null];
      nextMeeting = { ...m, boardName: board?.name, boardAbbreviation: board?.abbreviation, agendaItemCount: 0 };
    }
  } else if (user.role === "management") {
    // Management: show their tasks
    const tasks = await db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.assigneeId, user.id), ne(tasksTable.status, "done")));
    myTasksCount = tasks.length;
    overdueTasksCount = tasks.filter((t) => {
      if (!t.dueDate) return false;
      return new Date(t.dueDate) < new Date();
    }).length;
  } else if (user.role === "observer") {
    const accessible = await db
      .select()
      .from(accessControlTable)
      .where(
        and(
          eq(accessControlTable.personId, user.id),
          eq(accessControlTable.hasAccess, true)
        )
      );
    const minutesIds = new Set(accessible.filter((a) => a.entityType === "minutes").map((a) => a.entityId));
    const voteIds = new Set(accessible.filter((a) => a.entityType === "vote").map((a) => a.entityId));

    const reviewMinutes = await db.select().from(minutesTable).where(eq(minutesTable.status, "review"));
    minutesInReviewCount = reviewMinutes.filter((m) => minutesIds.has(m.id)).length;

    const allOpenVotes = await db.select().from(votesTable).where(eq(votesTable.status, "open"));
    openVotesCount = allOpenVotes.filter((v) => voteIds.has(v.id)).length;
  }

  res.json({
    pendingVotesCount,
    minutesToSignCount,
    nextMeeting,
    minutesInReviewCount,
    myTasksCount,
    overdueTasksCount,
    pendingActionsCount,
    openVotesCount,
  });
});

router.get("/dashboard/ai-insights", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;

  if (!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY)) {
    res.json({
      insights: [],
      error: "no_api_key",
    });
    return;
  }

  // Build pending items for this user
  const pendingItems: string[] = [];

  if (user.role === "member") {
    // Vote status: query vote_records for req.user.id scoped to the user's open votes
    // so the AI prompt context accurately reflects "ALREADY CAST YOUR VOTE" post-vote.
    const memberships = await db.select().from(boardMembershipsTable).where(eq(boardMembershipsTable.personId, user.id));
    const memberBoardIds = new Set(memberships.map((m) => m.boardId));

    const openVotes = await db.select().from(votesTable).where(eq(votesTable.status, "open"));
    const myOpenVotes = openVotes.filter((v) => v.boardId && memberBoardIds.has(v.boardId)).slice(0, 5);

    // Fetch vote records scoped to only the open votes this user can see — prevents
    // stale records from closed/archived ballots from influencing the insight context.
    const myVoteRecords = myOpenVotes.length > 0
      ? await db.select().from(voteRecordsTable).where(
          and(
            eq(voteRecordsTable.personId, user.id),
            inArray(voteRecordsTable.voteId, myOpenVotes.map((v) => v.id))
          )
        )
      : [];
    const votedIds = new Set(myVoteRecords.map((r) => r.voteId));

    for (const v of myOpenVotes) {
      const alreadyVoted = votedIds.has(v.id);
      pendingItems.push(`Open vote: "${v.title}" [${v.resolutionNumber}] — ${alreadyVoted ? "you have ALREADY CAST YOUR VOTE" : "AWAITING YOUR VOTE"} deadline: ${v.deadline || "none"}`);
    }

    // Signing status: check if user has ALREADY signed each set of minutes in the signing stage.
    const signingMinutes = await db.select().from(minutesTable).where(eq(minutesTable.status, "signing"));
    const mySignatures = await db.select().from(minutesSignaturesTable).where(eq(minutesSignaturesTable.personId, user.id));
    const signedIds = new Set(mySignatures.map((s) => s.minutesId));
    for (const m of signingMinutes.slice(0, 3)) {
      const alreadySigned = signedIds.has(m.id);
      pendingItems.push(`Minutes (ID: ${m.id}) — ${alreadySigned ? "you have ALREADY SIGNED" : "AWAITING YOUR SIGNATURE"}`);
    }
  } else if (user.role === "management") {
    const tasks = await db
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.assigneeId, user.id), ne(tasksTable.status, "done")));
    for (const t of tasks.slice(0, 5)) {
      pendingItems.push(`Task: "${t.title}" due ${t.dueDate || "no date"} status: ${t.status}`);
    }
  } else if (user.role === "admin") {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(pendingActionsTable)
      .where(eq(pendingActionsTable.status, "pending"));
    if (Number(count) > 0) {
      pendingItems.push(`${count} AI actions awaiting your approval`);
    }
    const openVotes = await db.select().from(votesTable).where(eq(votesTable.status, "open"));
    for (const v of openVotes.slice(0, 3)) {
      pendingItems.push(`Open vote: "${v.title}" [${v.resolutionNumber}]`);
    }
  }

  const userContext = `User: ${user.name} (${user.role}, ${user.title || ""})\n\nPending items:\n${pendingItems.join("\n") || "No pending items"}`;

  const result = await callAI("SUGGEST", SUGGEST_PROMPT, userContext);

  if (!result.success) {
    res.json({ insights: [], error: result.error });
    return;
  }

  const parsed = result.data as { insights: unknown[] };
  res.json({ insights: parsed.insights || [] });
});

export default router;
