import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { db, boardsTable, meetingsTable, votesTable, tasksTable, peopleTable, boardMembershipsTable, accessControlTable } from "@workspace/db";
import { eq, ne, and } from "drizzle-orm";
import { MODE_SCHEMAS } from "./aiSchemas";
import { logger } from "./logger";

const AI_BRAIN_PROMPT = `You are the AI brain of Open Board, an AI-native board management portal. You are not a chatbot. You are the system's intelligence layer — you classify documents, propose actions, answer questions, and verify evidence.

## WHAT YOU ARE

You are a professional board secretary's brain. You know corporate governance:
- What board minutes look like, what must be in them, what shouldn't
- What a resolution is, how voting works, what quorum means
- What action items are, how they flow from minutes to tasks to evidence to closure
- What confidential information looks like and when to flag it
- How boards, committees, and their memberships work
- The difference between information items, discussion items, and decision items
- Proxy voting, recusals, conflicts of interest

## THE SYSTEM YOU CONTROL

Open Board has these entities. You can propose creating any of them:

**Meetings** — have a date, location, board, and numbered agenda items. Each agenda item has a type (information/discussion/decision) and can link to documents and votes.

**Votes** — can be "meeting" votes (taken during a meeting) or "circulation" votes (asynchronous, with a deadline). Each has a resolution number (e.g., RES-BOD-2026-001), resolution text, and an approval rule. 4 vote options: Approved, Approved with Comments, Not Approved, Not Approved with Comments. NO Abstain.

**Minutes** — HTML text linked to a meeting. Workflow: draft → review → signing → signed. When minutes are signed, you extract action items and propose creating tasks.

**Tasks** — have an assignee, deadline, source meeting/minutes, and status. When evidence is uploaded, you review it and propose closing the task.

**Documents** — uploaded files (PDF, DOCX, TXT). You classify every upload, summarize it, and propose what to do with it.

**Access Control** — the Secretary controls who can see what. You MUST respect these permissions in every response. Never reference an entity a user cannot access.

## WHAT YOU CAN DO

When called, you operate in one of these modes:

**CLASSIFY** — A document was uploaded. Determine its type, extract structured data, and propose actions.
**COMMAND** — The Secretary gave a natural language instruction. Parse it and propose the actions to execute.
**SEARCH** — A user asked a question. Search the document database and answer with source links. Respect their access permissions.
**REVIEW** — Evidence was uploaded for a task. Compare it against the task requirements and return a verdict.
**SUGGEST** — Generate proactive dashboard insights for a specific user based on their role and pending items.

## THE RULES

1. You NEVER execute actions directly. You propose. The Secretary approves. This is not optional — it is a legal requirement of board governance.
2. You respect permissions. If a user can't see a document, it does not exist in your responses.
3. You are precise. When extracting action items, each must have a clear assignee and deadline. If either is ambiguous, flag it for the Secretary to clarify.
4. You flag confidentiality. If you detect negotiation strategies, pricing terms, personal performance data, or legal privilege, flag the passage.
5. You cross-reference. When you see a document that relates to an existing meeting, vote, or task, link them.
6. You are honest. If you're unsure about a classification, say so and give your confidence score. Don't guess.
7. You ground every proposal. Each proposed action must carry a short verbatim source_quote from the document (or the Secretary's instruction) that justifies it. Never fabricate a quote.
8. The boards, committees, and people you may reference come from the CURRENT DATABASE STATE section of each request — never assume an organization structure that isn't listed there.`;

const CLASSIFY_PROMPT = `
MODE: CLASSIFY

A document has been uploaded. Analyze it and return the structured classification.

For every proposed action, include:
- "description": human-readable description of what this action will do
- "source_quote": a SHORT verbatim quote (max ~2 sentences) copied exactly from the document that justifies the action
- "details": the structured fields for the action

CLASSIFICATION RULES:

## 1. DRAFT MINUTES
How to recognize: Contains "MINUTES OF THE", "Present:", "Apologies:", numbered agenda items, "RESOLVED THAT", "ACTION:", "The meeting was adjourned at".
Extract: meeting_date, board_name, attendees[], agenda_items[], action_items[{assignee, task, deadline, source_quote}], resolutions[], confidential_passages[]
Propose: create_minutes + create_task (one per action item) + flag_confidential (one per flagged passage)

## 2. RESOLUTION / REQUEST FOR APPROVAL
How to recognize: Contains "RESOLVED THAT", "IT IS HEREBY RESOLVED", "REQUEST FOR BOARD APPROVAL", formal resolution language.
Extract: resolution_text, board_name, subject, suggested_deadline
Propose: create_vote

## 3. FINANCIAL REPORT
How to recognize: Contains "Financial Statements", "Revenue", "EBITDA", "Balance Sheet", "Cash Flow", period references.
Extract: period, key_figures[{label, value}], summary
Propose: attach_to_meeting (if upcoming meeting exists)

## 4. EVIDENCE / DELIVERABLE
How to recognize: A document that appears to be a deliverable or proof of completion.
Propose: close_task (with reasoning)

## 5. MEETING AGENDA
How to recognize: Contains "AGENDA", numbered items with types, a meeting date and time, a board/committee name.
Extract: meeting_date, board_name, location, agenda_items[{title, type, description}]
Propose: create_meeting with the full agenda.

## 6. LEGAL OPINION
How to recognize: From a law firm, contains legal analysis.
Extract: summary, key_conclusions[], regulatory_deadlines[]
Propose: attach_to_meeting if relevant. Always propose flag_confidential.

## 7. COMMITTEE SUBMISSION
How to recognize: Submitted by or referencing a specific committee. Typically labelled "Committee Report", "Submission to the Board", "For Board Endorsement", or authored with a committee letterhead. May request board sign-off, noting or ratification.
Extract: committee_name, submission_date, subject, key_recommendations[], items_for_board_decision[], items_for_noting[]
Propose: If the submission describes a sequential approval chain (e.g., "committee A must endorse, then the board approves"), propose create_workflow. Otherwise attach_to_meeting, and if it requests formal approval also propose create_vote.

## 8. MULTI-STAGE APPROVAL WORKFLOW
How to recognize: Any document that describes an endorsement or approval process involving two or more distinct bodies — including when multiple committees must endorse concurrently before the board decides.
Extract: all stages, with each stage having a stage_group (integer). Stages in the same stage_group run IN PARALLEL simultaneously. The next stage_group only opens once ALL stages in the previous group are approved.
Common patterns:
  - "Committee A AND Committee B must both endorse before the Board approves" → A (group 0) + B (group 0) → Board (group 1)
  - "Committee A must endorse, then the Board approves" → A (group 0) → Board (group 1)
  - "Board approval only" → Board (group 0)
Propose: create_workflow with details containing:
  - "title": short name for the overall workflow
  - "description": one-sentence description of what is being approved
  - "stages": [{ "title", "board" (exact board name or abbreviation from CURRENT DATABASE STATE), "stage_group", "approval_type" ("majority" | "unanimous" | "two_thirds" | "three_quarters"), "description" }]
IMPORTANT: Final stage (board approval) always has the highest stage_group number. All endorsements that can happen concurrently share the same stage_group.

## 9. GENERAL
Catch-all. Extract: summary, key_topics[], entities_mentioned[]. Propose no actions beyond storing.

Use board names and people names EXACTLY as they appear in CURRENT DATABASE STATE.`;

const COMMAND_PROMPT = `
MODE: COMMAND

The Secretary is giving you a natural language instruction. Parse it into structured proposed actions.

If the instruction is ambiguous, set "understood": false and ask a clarifying question in the "interpretation" field. Return an empty proposed_actions array when understood is false.

For every proposed action include a "source_quote" — the fragment of the Secretary's instruction it comes from.

When creating a meeting, automatically:
- Set attendance to all board members of that board (status: pending)
- Include an "agenda_items" array in details, with objects like { "title", "type" ("information"|"discussion"|"decision"), "description" } — even for a single agenda topic.

Use board names and people names EXACTLY as they appear in CURRENT DATABASE STATE.

IMPORTANT — Date/time format rules:
- Always return dates as "YYYY-MM-DDTHH:MM:SS" (ISO 8601, NO timezone suffix, NO "Z", NO "+00:00").
  This ensures the time is treated as the local wall-clock time at the meeting location.`;

const SEARCH_PROMPT = `
MODE: SEARCH

A user is asking a question. Answer using ONLY the search results provided. Include source links.

Answer concisely. Include entity references as links using this format: [entityType:entityId:title]

If no search results match the question, say: "I couldn't find anything matching your question in the documents you have access to."`;

const REVIEW_PROMPT = `
MODE: REVIEW

Evidence has been submitted for a task. Verify whether it satisfies the requirements and return your verdict.

Be specific. If rejecting, tell the submitter exactly what's missing so they can fix it.`;

const SUGGEST_PROMPT = `
MODE: SUGGEST

Generate 3-5 proactive insights for this user's dashboard. Be specific and actionable.

Only reference entities listed in CURRENT DATABASE STATE, with their exact ids.
If there are no pending items, return 1-2 general insights like "All caught up" or a summary of recent activity.`;

// With adaptive thinking enabled, thinking tokens count toward max_tokens —
// these limits leave room for reasoning plus the structured answer.
const TOKEN_LIMITS: Record<string, number> = {
  CLASSIFY: 16000,
  COMMAND: 8000,
  SEARCH: 4000,
  REVIEW: 4000,
  SUGGEST: 4000,
};

export function getCurrentModel(): string {
  return process.env.AI_MODEL || "claude-opus-4-8";
}

function getClient(): Anthropic | null {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  return new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
}

// --- Cost controls -----------------------------------------------------------

// Cap concurrent model calls (uploads fan out background classification jobs).
const MAX_CONCURRENT = 4;
let active = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active++;
}

function releaseSlot(): void {
  active--;
  const next = waiters.shift();
  if (next) next();
}

// Daily aggregate ceiling — a runaway loop or upload flood can't spend without bound.
let budgetDay = "";
let callsToday = 0;

function takeBudget(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== budgetDay) {
    budgetDay = today;
    callsToday = 0;
  }
  const limit = Number(process.env.AI_DAILY_CALL_LIMIT || 1000);
  if (callsToday >= limit) return false;
  callsToday++;
  return true;
}

// -----------------------------------------------------------------------------

export async function callAI(
  mode: string,
  modePrompt: string,
  userContent: string
): Promise<{ success?: boolean; data?: unknown; error?: string; message?: string }> {
  const client = getClient();
  if (!client) {
    return { error: "no_api_key", message: "AI features require configuration." };
  }
  if (!takeBudget()) {
    logger.warn({ mode }, "[ai] daily call limit reached");
    return { error: "budget_exceeded", message: "Daily AI usage limit reached. Try again tomorrow or raise AI_DAILY_CALL_LIMIT." };
  }

  // The static brain+mode prompt is cacheable; the volatile database context
  // stays in the user message, after the cache breakpoint.
  const system = [
    {
      type: "text" as const,
      text: AI_BRAIN_PROMPT + modePrompt,
      cache_control: { type: "ephemeral" as const },
    },
  ];

  await acquireSlot();
  try {
    const schema = MODE_SCHEMAS[mode as keyof typeof MODE_SCHEMAS];

    if (!schema) {
      // SEARCH mode returns prose with inline entity links — no JSON contract.
      const response = await client.messages.create({
        model: getCurrentModel(),
        max_tokens: TOKEN_LIMITS[mode] || 4000,
        thinking: { type: "adaptive" },
        system,
        messages: [{ role: "user", content: userContent }],
      });
      const text = response.content.find((b) => b.type === "text")?.text ?? null;
      if (!text) {
        return { error: "empty_response", message: "AI returned no content." };
      }
      return { success: true, data: text };
    }

    // Structured outputs: the response is schema-validated by the API + SDK —
    // no markdown-fence stripping, no JSON.parse, no malformed shapes.
    const response = await client.messages.parse({
      model: getCurrentModel(),
      max_tokens: TOKEN_LIMITS[mode] || 4000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: userContent }],
      output_config: { format: zodOutputFormat(schema) },
    });

    if (response.parsed_output == null) {
      logger.warn({ mode, stopReason: response.stop_reason }, "[ai] structured output missing");
      return { error: "parse_error", message: "AI response could not be parsed." };
    }
    return { success: true, data: response.parsed_output };
  } catch (err: unknown) {
    const anyErr = err as Record<string, unknown>;
    if (anyErr.status === 429) {
      return { error: "rate_limited", message: "AI is busy. Try again in a moment." };
    }
    if (anyErr.status === 401) {
      return { error: "invalid_key", message: "API key is invalid. Check Settings." };
    }
    logger.error({ err: (err as Error)?.message, mode }, "[ai] call failed");
    return { error: "unknown", message: "AI service unavailable. Create entities manually." };
  } finally {
    releaseSlot();
  }
}

export async function getDatabaseContext(userId?: string, role?: string): Promise<string> {
  const isAdmin = !userId || role === "admin";

  if (isAdmin) {
    const [boards, openTasks, upcomingMeetings, openVotes, people] = await Promise.all([
      db.select().from(boardsTable),
      db.select().from(tasksTable).where(ne(tasksTable.status, "done")),
      db.select().from(meetingsTable).where(eq(meetingsTable.status, "scheduled")),
      db.select().from(votesTable).where(eq(votesTable.status, "open")),
      db.select().from(peopleTable),
    ]);

    return `CURRENT DATABASE STATE:

Boards: ${boards.map((b) => `${b.name} (${b.abbreviation})`).join(", ")}

Open tasks (for evidence matching):
${openTasks.map((t) => `- ${t.taskNumber || "TASK"}: ${t.title} (due: ${t.dueDate || "no date"})`).join("\n") || "No open tasks"}

Upcoming meetings (for document attachment):
${upcomingMeetings.map((m) => `- ${m.title} on ${m.date}`).join("\n") || "No upcoming meetings"}

Open votes:
${openVotes.map((v) => `- ${v.resolutionNumber}: ${v.title} (deadline: ${v.deadline || "none"})`).join("\n") || "No open votes"}

People:
${people.map((p) => `- ${p.name} (${p.role}, ${p.title || "no title"})`).join("\n")}`;
  }

  // Non-admin: scope to user's accessible boards/votes/tasks/people
  const memberships = await db
    .select()
    .from(boardMembershipsTable)
    .where(eq(boardMembershipsTable.personId, userId!));
  const accessibleBoardIds = memberships.map((m) => m.boardId).filter(Boolean) as string[];

  const voteAccessRows = await db
    .select()
    .from(accessControlTable)
    .where(
      and(
        eq(accessControlTable.entityType, "vote"),
        eq(accessControlTable.personId, userId!),
        eq(accessControlTable.hasAccess, true)
      )
    );
  const accessibleVoteIds = new Set(voteAccessRows.map((a) => a.entityId));

  const [allBoards, allTasks, allMeetings, allVotes, allMemberships, allPeople] = await Promise.all([
    db.select().from(boardsTable),
    db.select().from(tasksTable).where(ne(tasksTable.status, "done")),
    db.select().from(meetingsTable).where(eq(meetingsTable.status, "scheduled")),
    db.select().from(votesTable).where(eq(votesTable.status, "open")),
    db.select().from(boardMembershipsTable),
    db.select().from(peopleTable),
  ]);

  const boards = allBoards.filter((b) => accessibleBoardIds.includes(b.id));
  const openTasks = allTasks.filter((t) => t.assigneeId === userId);
  const upcomingMeetings = allMeetings.filter((m) => m.boardId && accessibleBoardIds.includes(m.boardId));
  const openVotes = allVotes.filter((v) => accessibleVoteIds.has(v.id));

  const boardPersonIds = new Set(
    allMemberships
      .filter((m) => m.boardId && accessibleBoardIds.includes(m.boardId))
      .map((m) => m.personId)
      .filter(Boolean)
  );
  const people = allPeople.filter((p) => boardPersonIds.has(p.id));

  return `CURRENT DATABASE STATE:

Boards: ${boards.map((b) => `${b.name} (${b.abbreviation})`).join(", ") || "None"}

Open tasks (for evidence matching):
${openTasks.map((t) => `- ${t.taskNumber || "TASK"}: ${t.title} (due: ${t.dueDate || "no date"})`).join("\n") || "No open tasks"}

Upcoming meetings (for document attachment):
${upcomingMeetings.map((m) => `- ${m.title} on ${m.date}`).join("\n") || "No upcoming meetings"}

Open votes:
${openVotes.map((v) => `- ${v.resolutionNumber}: ${v.title} (deadline: ${v.deadline || "none"})`).join("\n") || "No open votes"}

People:
${people.map((p) => `- ${p.name} (${p.role}, ${p.title || "no title"})`).join("\n") || "None"}`;
}

export { CLASSIFY_PROMPT, COMMAND_PROMPT, SEARCH_PROMPT, REVIEW_PROMPT, SUGGEST_PROMPT };
