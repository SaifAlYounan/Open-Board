import { Router } from "express";
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
import {
  callAI,
  getDatabaseContext,
  COMMAND_PROMPT,
  SEARCH_PROMPT,
  SUGGEST_PROMPT,
} from "../lib/ai";

const router = Router();

const hasAI = () => !!(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);

router.get("/ai/status", requireAuth, async (_req, res): Promise<void> => {
  const configured = hasAI();
  res.json({
    configured,
    message: configured ? null : "AI features require configuration. Add your Anthropic API key in Settings.",
  });
});

router.post("/ai/command", requireAuth, requireAdmin, async (req, res): Promise<void> => {
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

  const dbContext = await getDatabaseContext();
  const result = await callAI("COMMAND", COMMAND_PROMPT, `${dbContext}\n\nSECRETARY COMMAND: ${command}`);

  if (!result.success) {
    res.json({
      understood: false,
      interpretation: result.message || "AI unavailable",
      pendingActionIds: [],
      error: result.error,
    });
    return;
  }

  const parsed = result.data as {
    understood: boolean;
    interpretation: string;
    proposed_actions?: Array<{ action_type: string; description: string; details: unknown }>;
  };

  let pendingActionIds: string[] = [];

  if (parsed.understood && parsed.proposed_actions?.length) {
    const actions = await db
      .insert(pendingActionsTable)
      .values(
        parsed.proposed_actions.map((action) => ({
          actionType: action.action_type as any,
          actionData: { ...(action.details as object), description: action.description },
          status: "pending" as const,
        }))
      )
      .returning();
    pendingActionIds = actions.map((a) => a.id);
  }

  res.json({
    understood: parsed.understood,
    interpretation: parsed.interpretation,
    pendingActionIds,
  });
});

router.post("/ai/search", requireAuth, async (req, res): Promise<void> => {
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

  const [matchingDocs, matchingMeetings, matchingVotes, matchingMinutes] = await Promise.all([
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

  // Filter by user access
  let filteredDocs = matchingDocs;
  let filteredMeetings = matchingMeetings;
  let filteredVotes = matchingVotes;
  let filteredMinutes = matchingMinutes;

  if (user.role !== "admin") {
    const accessible = await db
      .select()
      .from(accessControlTable)
      .where(
        and(
          eq(accessControlTable.personId, user.id),
          eq(accessControlTable.hasAccess, true)
        )
      );
    const accessMap = new Map(accessible.map((a) => [`${a.entityType}:${a.entityId}`, true]));
    filteredDocs = matchingDocs.filter((d) => accessMap.has(`document:${d.id}`));
    filteredMeetings = matchingMeetings.filter((m) => accessMap.has(`meeting:${m.id}`));
    filteredVotes = matchingVotes.filter((v) => accessMap.has(`vote:${v.id}`));
    filteredMinutes = matchingMinutes.filter((m) => accessMap.has(`minutes:${m.id}`));
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

  // Parse sources from answer text links [entityType:entityId:title]
  const answer = aiResult.data as string;
  const sources: Array<{ entityType: string; entityId: string; title: string }> = [];
  const linkRegex = /\[(\w+):([a-f0-9-]+):([^\]]+)\]/g;
  let match;
  const cleanAnswer = typeof answer === "string"
    ? answer.replace(linkRegex, (_, type, id, title) => {
        sources.push({ entityType: type, entityId: id, title });
        return title;
      })
    : String(answer);

  res.json({ answer: cleanAnswer, sources });
});

export default router;
