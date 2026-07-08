import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  db,
  pendingActionsTable,
  documentsTable,
  meetingsTable,
  votesTable,
  minutesTable,
  tasksTable,
  peopleTable,
  accessControlTable,
} from "@workspace/db";
import { eq, and, or, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  callAI,
  getDatabaseContext,
  getCurrentModel,
  COMMAND_PROMPT,
  SEARCH_PROMPT,
  SUGGEST_PROMPT,
} from "../lib/ai";
import { validateActionData, type CommandResponse } from "../lib/aiSchemas";

const router = Router();

const aiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests — please wait a moment before trying again." },
});

const hasAI = () => !!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);

router.get("/ai/status", requireAuth, async (_req, res): Promise<void> => {
  const configured = hasAI();
  res.json({
    configured,
    model: configured ? getCurrentModel() : null,
    message: configured ? null : "AI features require configuration. Add your Anthropic API key in Settings.",
  });
});

router.post("/ai/command", requireAuth, requireAdmin, aiRateLimit, async (req, res): Promise<void> => {
  const { command } = req.body;
  if (!command) {
    res.status(400).json({ error: "command required" });
    return;
  }

  if (!hasAI()) {
    res.json({
      understood: false,
      interpretation: "AI features require configuration. Add your Anthropic API key in Settings.",
      pendingActionIds: [],
      error: "no_api_key",
    });
    return;
  }

  const dbContext = await getDatabaseContext(req.user!.id, req.user!.role);
  const result = await callAI("COMMAND", COMMAND_PROMPT, `SECRETARY COMMAND: ${command}`, dbContext);

  if (!result.success) {
    res.json({
      understood: false,
      interpretation: result.message || "AI unavailable",
      pendingActionIds: [],
      error: result.error,
    });
    return;
  }

  const parsed = result.data as CommandResponse;

  let pendingActionIds: string[] = [];
  const skipped: string[] = [];

  if (parsed.understood && parsed.proposed_actions?.length) {
    const rows: Array<{ actionType: string; actionData: Record<string, unknown> }> = [];
    for (const action of parsed.proposed_actions) {
      const validation = validateActionData(action.action_type, {
        ...(action.details ?? {}),
        description: action.description,
        source_quote: action.source_quote ?? undefined,
      });
      if (validation.ok) {
        rows.push({ actionType: action.action_type, actionData: validation.data });
      } else {
        skipped.push(`${action.action_type}: ${validation.error}`);
        logger.warn({ actionType: action.action_type, error: validation.error }, "[ai/command] skipped invalid proposed action");
      }
    }
    if (rows.length) {
      const actions = await db
        .insert(pendingActionsTable)
        .values(rows.map((r) => ({ actionType: r.actionType as any, actionData: r.actionData, status: "pending" as const })))
        .returning();
      pendingActionIds = actions.map((a) => a.id);
    }
  }

  res.json({
    understood: parsed.understood,
    interpretation: skipped.length
      ? `${parsed.interpretation} (${skipped.length} proposed action(s) were dropped as malformed)`
      : parsed.interpretation,
    pendingActionIds,
  });
});

router.post("/ai/search", requireAuth, aiRateLimit, async (req, res): Promise<void> => {
  const user = req.user!;
  const { query } = req.body;
  if (!query) {
    res.status(400).json({ error: "query required" });
    return;
  }

  if (!hasAI()) {
    res.json({
      answer: "AI search requires configuration. Add your Anthropic API key in Settings.",
      sources: [],
      error: "no_api_key",
    });
    return;
  }

  // Search documents, meetings, votes, minutes with text search
  const searchTerm = `%${query.replace(/[%_]/g, "\\$&")}%`;

  let matchingDocs: typeof documentsTable.$inferSelect[] = [];
  let matchingMeetings: typeof meetingsTable.$inferSelect[] = [];
  let matchingVotes: typeof votesTable.$inferSelect[] = [];
  let matchingMinutes: typeof minutesTable.$inferSelect[] = [];

  try {
    [matchingDocs, matchingMeetings, matchingVotes, matchingMinutes] = await Promise.all([
    db
      .select()
      .from(documentsTable)
      .where(
        or(
          sql`${documentsTable.title} ILIKE ${searchTerm}`,
          sql`${documentsTable.filename} ILIKE ${searchTerm}`
        )
      )
      .limit(5),
    db
      .select()
      .from(meetingsTable)
      .where(sql`${meetingsTable.title} ILIKE ${searchTerm}`)
      .limit(5),
    db
      .select()
      .from(votesTable)
      .where(
        or(
          sql`${votesTable.title} ILIKE ${searchTerm}`,
          sql`${votesTable.resolutionText} ILIKE ${searchTerm}`
        )
      )
      .limit(5),
    db
      .select()
      .from(minutesTable)
      .where(sql`${minutesTable.content} ILIKE ${searchTerm}`)
      .limit(3),
    ]);
  } catch (dbErr: unknown) {
    logger.error({ err: dbErr }, "[ai/search] DB query failed");
    res.json({ answer: "Search is temporarily unavailable. Please try again.", sources: [] });
    return;
  }

  // Filter by user access. Two distinct failure modes are handled explicitly:
  //   1. DB query error  → fail-closed: return no results to prevent data exposure.
  //   2. Empty table     → graceful fallback: show only non-draft minutes (safe public-ish
  //                        content); restrict docs, meetings, votes (always member-only).
  let filteredDocs = matchingDocs;
  let filteredMeetings = matchingMeetings;
  let filteredVotes = matchingVotes;
  let filteredMinutes = matchingMinutes;

  if (user.role !== "admin") {
    let accessible: { entityType: string; entityId: string }[] = [];
    let accessQueryFailed = false;

    try {
      accessible = await db
        .select()
        .from(accessControlTable)
        .where(
          and(
            eq(accessControlTable.personId, user.id),
            eq(accessControlTable.hasAccess, true)
          )
        );
    } catch (acErr: unknown) {
      // Fail-closed: on DB error, surface no results (prevents accidental exposure).
      logger.error({ err: acErr }, "[ai/search] Access control query failed — returning empty results");
      accessQueryFailed = true;
    }

    if (accessQueryFailed) {
      filteredDocs = [];
      filteredMeetings = [];
      filteredVotes = [];
      filteredMinutes = [];
    } else if (accessible.length > 0) {
      // Normal path: filter by explicit access control entries.
      const accessMap = new Map(accessible.map((a) => [`${a.entityType}:${a.entityId}`, true]));
      filteredDocs = matchingDocs.filter((d) => accessMap.has(`document:${d.id}`));
      filteredMeetings = matchingMeetings.filter((m) => accessMap.has(`meeting:${m.id}`));
      filteredVotes = matchingVotes.filter((v) => accessMap.has(`vote:${v.id}`));
      filteredMinutes = matchingMinutes.filter((m) => accessMap.has(`minutes:${m.id}`));
    } else {
      // Empty access_control — user has no grants yet; return nothing.
      filteredDocs = [];
      filteredMeetings = [];
      filteredVotes = [];
      filteredMinutes = [];
    }
  }

  // Build search results context
  const searchResults = [
    ...filteredDocs.map((d) => `Document: "${d.title}" (ID: ${d.id})`),
    ...filteredMeetings.map((m) => `Meeting: "${m.title}" on ${m.date} (ID: ${m.id})`),
    ...filteredVotes.map((v) => `Vote: "${v.title}" [${v.resolutionNumber}] status:${v.status} (ID: ${v.id})`),
    ...filteredMinutes.map((m) => `Minutes: status:${m.status} meeting_id:${m.meetingId} (ID: ${m.id})`),
  ].join("\n");

  const userContext = `User: ${user.name} (${user.role})\n\nSEARCH RESULTS:\n${searchResults || "No results found for this query."}\n\nUSER QUESTION: ${query}`;

  const aiResult = await callAI("SEARCH", SEARCH_PROMPT, userContext);

  if (!aiResult.success) {
    res.json({
      answer: aiResult.message || "Search unavailable",
      sources: [],
      error: aiResult.error,
    });
    return;
  }

  // Parse sources from answer text links [entityType:entityId:title].
  // Model output is untrusted: entity types are allowlisted, ids must be UUIDs,
  // and only entities that actually appeared in the search results may be cited.
  const answer = aiResult.data as string;
  const VALID_LINK_TYPES = new Set(["document", "meeting", "vote", "minutes"]);
  const knownIds = new Set([
    ...filteredDocs.map((d) => d.id),
    ...filteredMeetings.map((m) => m.id),
    ...filteredVotes.map((v) => v.id),
    ...filteredMinutes.map((m) => m.id),
  ]);
  const sources: Array<{ entityType: string; entityId: string; title: string }> = [];
  const linkRegex = /\[(\w+):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([^\]]+)\]/gi;
  const cleanAnswer = typeof answer === "string"
    ? answer.replace(linkRegex, (_, type, id, title) => {
        if (VALID_LINK_TYPES.has(type) && knownIds.has(id)) {
          sources.push({ entityType: type, entityId: id, title: String(title).slice(0, 200) });
        }
        return title;
      })
    : String(answer);

  res.json({ answer: cleanAnswer, sources });
});

export default router;
