import { z } from "zod";
import type { Response } from "express";
import { dateStr, short, med, long } from "./aiSchemas";

/**
 * Body contracts for the MANUAL (REST) create/edit path of governance objects
 * — votes, tasks, meetings (issue #13).
 *
 * Built on the same shared field primitives (`short`/`med`/`long`/`dateStr`
 * from aiSchemas.ts) that validateActionData enforces on the AI-approval path,
 * so a Secretary typing into a form and an AI proposal being approved go
 * through one size/type contract. The routes keep their own semantic checks
 * (board exists, state machine, authz) on top.
 */

const uuid = z.string().uuid();

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

export const VOTE_TYPES = ["circulation", "meeting", "simple", "resolution", "election", "special"] as const;
export const VOTE_STATUSES = ["open", "approved", "rejected", "lapsed", "cancelled"] as const;
const RULE_TYPES = ["unanimous", "majority", "two_thirds", "three_quarters", "custom"] as const;
const DEADLINE_BEHAVIORS = ["lapse", "extend", "notify"] as const;

export const approvalRuleBody = z
  .object({
    type: z.enum(RULE_TYPES).optional(),
    minApprovals: z.number().int().positive().nullish(),
    quorum: z.number().int().positive().nullish(),
    weighted: z.boolean().nullish(),
    deadlineBehavior: z.enum(DEADLINE_BEHAVIORS).nullish(),
    // One automatic extension window (days) when deadlineBehavior = "extend".
    extendDays: z.number().int().min(1).max(365).nullish(),
    // What the quorum is measured against / what fractional rules divide by.
    // null = the vote-type / rule-type default (see lib/voteTally.resolveBases).
    quorumBasis: z.enum(["attendance", "cast"]).nullish(),
    denominatorBasis: z.enum(["eligible", "cast"]).nullish(),
    requiredVoterIds: z.array(uuid).max(200).nullish(),
    recusedIds: z.array(uuid).max(200).nullish(),
    // Reasons for the recusals above, keyed by person id (item 2 — a recusal
    // is a recorded fact with a why, not just an access-control hole).
    recusalReasons: z.record(uuid, short).nullish(),
  })
  .strip();

export const createVoteBody = z
  .object({
    boardId: uuid,
    meetingId: uuid.nullish(),
    resolutionNumber: short.nullish(),
    title: short.min(1),
    resolutionText: long.min(1),
    type: z.enum(VOTE_TYPES),
    deadline: dateStr.nullish(),
    secret: z.boolean().nullish(),
    approvalRule: approvalRuleBody.nullish(),
  })
  .strip();

export const updateVoteBody = z
  .object({
    title: short.min(1).nullish(),
    resolutionText: long.min(1).nullish(),
    deadline: dateStr.nullish(),
    status: z.enum(VOTE_STATUSES).nullish(),
    secret: z.boolean().nullish(),
  })
  .strip();

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export const TASK_STATUSES = ["todo", "in_progress", "done", "blocked", "evidence_submitted", "pending_review", "overdue", "cancelled"] as const;
/** Terminal task states: no content edits; `cancelled` allows no transition at all. */
export const TERMINAL_TASK_STATUSES = ["done", "cancelled"] as const;

export const createTaskBody = z
  .object({
    boardId: uuid.nullish(),
    title: short.min(1),
    description: med.nullish(),
    assigneeId: uuid.nullish(),
    sourceMeetingId: uuid.nullish(),
    sourceMinutesId: uuid.nullish(),
    dueDate: dateStr.nullish(),
    sourceParagraph: long.nullish(),
  })
  .strip();

export const updateTaskBody = z
  .object({
    title: short.min(1).nullish(),
    description: med.nullish(),
    assigneeId: uuid.nullish(),
    status: z.enum(TASK_STATUSES).nullish(),
    dueDate: dateStr.nullish(),
  })
  .strip();

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

export const MEETING_STATUSES = ["scheduled", "concluded", "cancelled"] as const;
/**
 * Legal meeting status transitions: conclude or cancel a scheduled meeting;
 * reopen a concluded one. `cancelled` is terminal (cancel ≠ delete — the
 * record and its audit trail stay).
 */
export const MEETING_TRANSITIONS: Record<string, readonly string[]> = {
  scheduled: ["concluded", "cancelled"],
  concluded: ["scheduled"],
  cancelled: [],
};

const agendaItemBody = z
  .object({
    position: z.number().int().min(1).max(1000),
    title: short.min(1),
    type: z.enum(["information", "discussion", "decision"]),
    description: med.nullish(),
  })
  .strip();

export const createMeetingBody = z
  .object({
    boardId: uuid,
    title: short.min(1),
    date: dateStr.min(1),
    location: short.nullish(),
    agendaItems: z.array(agendaItemBody).max(60).nullish(),
  })
  .strip();

export const updateMeetingBody = z
  .object({
    title: short.min(1).nullish(),
    date: dateStr.nullish(),
    location: short.nullish(),
    status: z.enum(MEETING_STATUSES).nullish(),
  })
  .strip();

// ---------------------------------------------------------------------------
// Route helper
// ---------------------------------------------------------------------------

/**
 * Validate a request body against a contract. On failure writes the 400
 * response (first few issues, same style as validateActionData) and returns
 * null so the route can bail with a bare `if (!parsed) return`.
 */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown, res: Response): z.infer<T> | null {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    res.status(400).json({ error: `Invalid request — ${issues}` });
    return null;
  }
  return result.data;
}
