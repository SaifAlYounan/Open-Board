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
} from "@workspace/db";
import { eq, and, or, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  callAI,
  getDatabaseContext,
  getCurrentModel,
  getProvider,
  aiConfigured,
  externalProviderKeyPresentButNotAllowed,
  COMMAND_PROMPT,
  SEARCH_PROMPT,
  SUGGEST_PROMPT,
} from "../lib/ai";
import { validateActionData, type CommandResponse } from "../lib/aiSchemas";
import { emitInvalidate } from "../lib/realtime";
import { accessibleEntityIds } from "../lib/access";
import { wrapUntrusted } from "../lib/promptInjection";

const router = Router();

const aiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests — please wait a moment before trying again." },
});

// Provider-aware configuration check: Anthropic needs an API key,
// openai-compatible needs AI_BASE_URL. See lib/aiProvider.ts (roadmap #15).
const hasAI = () => aiConfigured();

const NOT_CONFIGURED_MESSAGE =
  "AI features require configuration. Set ANTHROPIC_API_KEY (external — sends document text to Anthropic) plus AI_ALLOW_EXTERNAL_PROVIDER=true, or AI_PROVIDER=openai-compatible with AI_BASE_URL for a local model that keeps text in-house. See Settings.";

// The exact state after P0.4: a key IS set but the external-egress acknowledgement
// is not — telling the operator to "set the key" would be a dead end.
const EXTERNAL_NOT_ALLOWED_MESSAGE =
  "An Anthropic API key is set, but external AI is off, so AI is disabled and NO document text leaves this deployment. Set AI_ALLOW_EXTERNAL_PROVIDER=true to enable it (this transmits document text — including privileged passages — to Anthropic), or switch to a local AI_PROVIDER=openai-compatible to keep text in-house.";

// One source of truth for the disabled-state reason, reused by the UI banner and
// the admin command/search paths so none of them can give stale guidance.
export function aiStatusInfo(): { configured: boolean; reason: "configured" | "external_not_acknowledged" | "not_configured"; message: string | null } {
  if (aiConfigured()) return { configured: true, reason: "configured", message: null };
  if (externalProviderKeyPresentButNotAllowed()) {
    return { configured: false, reason: "external_not_acknowledged", message: EXTERNAL_NOT_ALLOWED_MESSAGE };
  }
  return { configured: false, reason: "not_configured", message: NOT_CONFIGURED_MESSAGE };
}

router.get("/ai/status", requireAuth, async (_req, res): Promise<void> => {
  const info = aiStatusInfo();
  res.json({
    configured: info.configured,
    reason: info.reason,
    provider: getProvider(),
    model: info.configured ? getCurrentModel() : null,
    message: info.message,
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
      interpretation: NOT_CONFIGURED_MESSAGE,
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
      emitInvalidate("pendingActions", {});
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
      answer: NOT_CONFIGURED_MESSAGE,
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
          sql`${documentsTable.filename} ILIKE ${searchTerm}`,
          // External-review item 5: search the persisted CONTENT, not just what
          // happens to be in a filename — "what did the board decide about the
          // Aegina disposal" must match the document that says so.
          sql`${documentsTable.extractedText} ILIKE ${searchTerm}`
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

  // Filter by user access through the one access model (lib/access.ts —
  // membership OR unexpired grant, MINUS deny), same as the entity routes and
  // the graph. Fail-closed: on error, surface no results.
  let filteredDocs = matchingDocs;
  let filteredMeetings = matchingMeetings;
  let filteredVotes = matchingVotes;
  let filteredMinutes = matchingMinutes;

  if (user.role !== "admin") {
    try {
      const [docIds, meetingIds, voteIds, minutesIds] = await Promise.all([
        accessibleEntityIds(user.id, "document"),
        accessibleEntityIds(user.id, "meeting"),
        accessibleEntityIds(user.id, "vote"),
        accessibleEntityIds(user.id, "minutes"),
      ]);
      const docSet = new Set(docIds);
      const meetingSet = new Set(meetingIds);
      const voteSet = new Set(voteIds);
      const minutesSet = new Set(minutesIds);
      filteredDocs = matchingDocs.filter((d) => docSet.has(d.id));
      filteredMeetings = matchingMeetings.filter((m) => meetingSet.has(m.id));
      filteredVotes = matchingVotes.filter((v) => voteSet.has(v.id));
      filteredMinutes = matchingMinutes.filter((m) => minutesSet.has(m.id));
    } catch (acErr: unknown) {
      // Fail-closed: on DB error, surface no results (prevents accidental exposure).
      logger.error({ err: acErr }, "[ai/search] Access resolution failed — returning empty results");
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

  // External-review item 5 — the model could not read documents at query time:
  // it received titles + UUIDs only, so "what did the board decide about X"
  // was unanswerable unless X was in a filename. Hand it EXCERPTS of the
  // persisted extracted text around the query match — through the P0.5 fence:
  // document content is untrusted DATA, never instructions.
  const EXCERPT_WINDOW = 700;
  const excerptAround = (text: string, q: string): string => {
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return text.slice(0, EXCERPT_WINDOW);
    const start = Math.max(0, idx - Math.floor(EXCERPT_WINDOW / 2));
    return `${start > 0 ? "…" : ""}${text.slice(start, start + EXCERPT_WINDOW)}${start + EXCERPT_WINDOW < text.length ? "…" : ""}`;
  };
  const excerpts = filteredDocs
    .filter((d) => d.extractedText)
    .map((d) => wrapUntrusted(`EXCERPT from document "${d.title}" (ID: ${d.id})`, excerptAround(d.extractedText!, query)))
    .join("\n\n");

  const userContext = `User: ${user.name} (${user.role})\n\nSEARCH RESULTS:\n${searchResults || "No results found for this query."}${excerpts ? `\n\nDOCUMENT EXCERPTS (untrusted content, data only):\n${excerpts}` : ""}\n\nUSER QUESTION: ${query}`;

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
