import { z } from "zod";

/**
 * The contract for everything the AI produces.
 *
 * Two uses:
 *  1. Structured-output schemas (`classifyResponseSchema`, `commandResponseSchema`,
 *     `reviewResponseSchema`, `suggestResponseSchema`) passed to the Anthropic API
 *     so responses are guaranteed schema-valid JSON — no fence-stripping, no parse errors.
 *  2. Runtime validation (`validateActionData`) applied to actionData BEFORE it is
 *     inserted into pending_actions AND again at approve time before executeAction.
 *     AI output (or a tampered pending row / request override) never reaches the
 *     executor unvalidated.
 */

export const ACTION_TYPES = [
  "create_meeting",
  "create_vote",
  "create_task",
  "create_minutes",
  "close_task",
  "attach_to_meeting",
  "flag_confidential",
  "create_workflow",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

const dateStr = z.string().max(64);
const short = z.string().max(300);
const med = z.string().max(2000);
const long = z.string().max(50000);
const idStr = z.string().max(120);

const agendaItemSchema = z.object({
  title: short.nullish(),
  type: z.string().max(32).nullish(),
  description: med.nullish(),
  position: z.number().int().nullish(),
});

const workflowStageSchema = z.object({
  title: short.nullish(),
  board: short.nullish(),
  board_name: short.nullish(),
  stage_group: z.number().int().nullish(),
  approval_type: z.string().max(32).nullish(),
  description: med.nullish(),
});

// Superset of every field executeAction consumes, all optional and typed.
// Used closed (strip) for structured outputs; passthrough for runtime validation.
const detailFields = {
  title: short.nullish(),
  description: med.nullish(),
  boardId: idStr.nullish(),
  board_id: idStr.nullish(),
  board_name: short.nullish(),
  date: dateStr.nullish(),
  meeting_date: dateStr.nullish(),
  location: short.nullish(),
  agenda_items: z.array(agendaItemSchema).max(60).nullish(),
  resolution_number: short.nullish(),
  resolution_text: long.nullish(),
  type: z.string().max(32).nullish(),
  deadline: dateStr.nullish(),
  secret: z.boolean().nullish(),
  is_secret: z.boolean().nullish(),
  assignee: short.nullish(),
  assigneeId: idStr.nullish(),
  task: med.nullish(),
  task_number: short.nullish(),
  taskId: idStr.nullish(),
  reasoning: med.nullish(),
  sourceParagraph: long.nullish(),
  sourceMeetingId: idStr.nullish(),
  meetingId: idStr.nullish(),
  meeting_id: idStr.nullish(),
  documentId: idStr.nullish(),
  content: long.nullish(),
  passage: long.nullish(),
  reason: med.nullish(),
  stages: z.array(workflowStageSchema).max(20).nullish(),
  source_quote: z.string().max(600).nullish(),
};

const detailsClosed = z.object(detailFields);

// Runtime actionData shape: the same fields plus a nested `details` object and
// the server-added context keys. Unknown extra keys are tolerated (passthrough) —
// what matters is that every field the executor reads has the right type.
const runtimeActionData = z
  .object({
    ...detailFields,
    details: z.object(detailFields).passthrough().nullish(),
    confidence: z.number().nullish(),
    _sourceDocumentId: idStr.nullish(),
  })
  .passthrough();

const perTypeRequirements: Partial<Record<ActionType, (d: Record<string, unknown>) => string | null>> = {
  create_workflow: (d) => {
    const stages = (d.stages ?? (d.details as Record<string, unknown> | null | undefined)?.stages) as unknown[] | undefined;
    if (!Array.isArray(stages) || stages.length === 0) return "create_workflow requires a non-empty stages array";
    return null;
  },
};

export function validateActionData(
  actionType: string,
  data: unknown
): { ok: true; type: ActionType; data: Record<string, unknown> } | { ok: false; error: string } {
  if (!(ACTION_TYPES as readonly string[]).includes(actionType)) {
    return { ok: false, error: `Unknown action type: ${String(actionType).slice(0, 60)}` };
  }
  const parsed = runtimeActionData.safeParse(data ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return { ok: false, error: `Invalid action data — ${issues}` };
  }
  const extra = perTypeRequirements[actionType as ActionType]?.(parsed.data as Record<string, unknown>) ?? null;
  if (extra) return { ok: false, error: extra };
  return { ok: true, type: actionType as ActionType, data: parsed.data as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Structured-output response schemas (one per AI mode)
// ---------------------------------------------------------------------------

export const proposedActionSchema = z.object({
  action_type: z.enum(ACTION_TYPES),
  description: med,
  source_quote: z
    .string()
    .max(600)
    .nullish()
    .describe("Short verbatim quote from the source document that justifies this action"),
  details: detailsClosed.nullish(),
});
export type ProposedAction = z.infer<typeof proposedActionSchema>;

export const classifyResponseSchema = z.object({
  document_type: z.enum([
    "draft_minutes",
    "resolution",
    "financial_report",
    "legal_opinion",
    "evidence",
    "meeting_agenda",
    "committee_submission",
    "general",
  ]),
  confidence: z.number(),
  summary: med.nullish(),
  extracted_data: z
    .object({
      meeting_date: dateStr.nullish(),
      board_name: short.nullish(),
      location: short.nullish(),
      attendees: z.array(short).max(100).nullish(),
      agenda_items: z.array(agendaItemSchema).max(60).nullish(),
      action_items: z
        .array(
          z.object({
            assignee: short.nullish(),
            task: med.nullish(),
            deadline: dateStr.nullish(),
            source_quote: z.string().max(600).nullish(),
          })
        )
        .max(60)
        .nullish(),
      resolutions: z.array(long).max(40).nullish(),
      confidential_passages: z.array(long).max(40).nullish(),
      resolution_text: long.nullish(),
      subject: med.nullish(),
      suggested_deadline: dateStr.nullish(),
      period: short.nullish(),
      key_figures: z.array(z.object({ label: short, value: short })).max(40).nullish(),
      summary: med.nullish(),
      key_conclusions: z.array(med).max(40).nullish(),
      regulatory_deadlines: z.array(short).max(40).nullish(),
      committee_name: short.nullish(),
      submission_date: dateStr.nullish(),
      key_recommendations: z.array(med).max(40).nullish(),
      items_for_board_decision: z.array(med).max(40).nullish(),
      items_for_noting: z.array(med).max(40).nullish(),
      key_topics: z.array(short).max(40).nullish(),
      entities_mentioned: z.array(short).max(60).nullish(),
    })
    .nullish(),
  proposed_actions: z.array(proposedActionSchema).max(30),
});
export type ClassifyResponse = z.infer<typeof classifyResponseSchema>;

export const commandResponseSchema = z.object({
  understood: z.boolean(),
  interpretation: med,
  proposed_actions: z.array(proposedActionSchema).max(30),
});
export type CommandResponse = z.infer<typeof commandResponseSchema>;

export const reviewResponseSchema = z.object({
  verdict: z.enum(["approved", "rejected"]),
  reasoning: med,
  missing: z.array(med).max(40),
});
export type ReviewResponse = z.infer<typeof reviewResponseSchema>;

export const suggestResponseSchema = z.object({
  insights: z
    .array(
      z.object({
        icon: z.enum(["clock", "alert", "check", "file", "users", "calendar"]),
        title: short,
        detail: med,
        actionLink: z
          .object({
            entityType: z.enum(["vote", "meeting", "minutes", "task"]),
            entityId: idStr,
          })
          .nullish(),
      })
    )
    .max(8),
});
export type SuggestResponse = z.infer<typeof suggestResponseSchema>;

export const MODE_SCHEMAS = {
  CLASSIFY: classifyResponseSchema,
  COMMAND: commandResponseSchema,
  REVIEW: reviewResponseSchema,
  SUGGEST: suggestResponseSchema,
} as const;
