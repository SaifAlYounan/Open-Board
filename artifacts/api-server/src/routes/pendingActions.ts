import { Router } from "express";
import fs from "fs";
import {
  db,
  pendingActionsTable,
  documentsTable,
  meetingsTable,
  votesTable,
  minutesTable,
  tasksTable,
  boardsTable,
  boardMembershipsTable,
  peopleTable,
  attendanceTable,
  agendaItemsTable,
  approvalWorkflowsTable,
  workflowStagesTable,
  voteDocumentsTable,
  agendaDocumentsTable,
} from "@workspace/db";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin, requireFreshMfa } from "../lib/auth";
import { grantDefaultAccess } from "../lib/access";
import { auditInTx } from "../lib/auditLog";
import { logger } from "../lib/logger";
import { writeLimiter } from "../lib/rateLimiters";
import { validateActionData } from "../lib/aiSchemas";
import { ActionError } from "../lib/errors";
import { nextResolutionNumber, nextTaskNumber, type DbClient } from "../lib/numbering";
import { emitInvalidate, type RealtimeResource } from "../lib/realtime";
import { sanitizeText } from "../lib/sanitize";

/**
 * Parse an AI-proposed date string treating it as wall-clock time (no timezone conversion).
 * Strips any timezone suffix so that "10:00 AM" is stored as 10:00, not converted to UTC.
 */
function parseAIDate(dateStr: string | undefined | null): Date {
  if (!dateStr) return new Date();
  const s = String(dateStr).trim();

  // Detect and extract a timezone offset suffix (e.g. "-06:00", "+05:30", "Z").
  // The AI is instructed to return wall-clock time with NO suffix, but it sometimes
  // adds one. Strategy: take the literal date/time digits as the intended wall-clock
  // time and discard the offset entirely — never let JS interpret it as UTC-adjusted.
  const offsetMatch = s.match(/([+-])(\d{2}):?(\d{2})$/);
  const hasZ = s.endsWith("Z");

  // Strip any suffix to get the bare "YYYY-MM-DDTHH:MM:SS" (or "YYYY-MM-DD") string.
  let bare = s;
  if (offsetMatch) {
    bare = s.slice(0, s.length - offsetMatch[0].length);
  } else if (hasZ) {
    bare = s.slice(0, -1);
  }

  if (bare.includes("T")) {
    // Parse the date/time components from the bare (suffix-free) string.
    const [datePart, timePart] = bare.split("T");
    const [yr, mo, dy] = datePart.split("-").map(Number);
    const [hh = 0, mm = 0, ss = 0] = timePart.split(":").map(Number);

    // If the AI included a timezone offset, convert the local wall-clock time to UTC:
    //   UTC = local − offset  →  UTC_minutes = local_minutes − offset_minutes
    // Example: "10:00:00-06:00" means 10am in UTC-6, which is 16:00 UTC.
    //   offsetSign=-1, offH=6, offM=0 → offsetMins = -1*(360) = -360
    //   utcMins = 0 − (−360) = +360  →  Date.UTC(yr,mo,dy, 10, 360, 0) = 16:00 UTC ✓
    // Without an offset (Z is treated as UTC, offsetMins stays 0): store as-is in UTC.
    let offsetMins = 0;
    if (offsetMatch) {
      const sign = offsetMatch[1] === "+" ? 1 : -1;
      offsetMins = sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));
    }
    return new Date(Date.UTC(yr, mo - 1, dy, hh, mm - offsetMins, ss));
  }

  // Date-only string — use noon UTC to avoid DST rollover issues
  const [yr, mo, dy] = bare.split("-").map(Number);
  return new Date(Date.UTC(yr, mo - 1, dy, 12, 0, 0));
}

/**
 * Resolve a board reference (UUID, exact name, exact abbreviation, or unique
 * name fragment). Ambiguous or unmatched references throw an ActionError so
 * the Secretary edits the action instead of an entity landing on the wrong
 * board — or silently on no board at all.
 */
async function resolveBoard(dbc: DbClient, ref: string | undefined | null): Promise<string | undefined> {
  if (!ref) return undefined;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
    const [board] = await dbc.select({ id: boardsTable.id }).from(boardsTable).where(eq(boardsTable.id, ref));
    if (!board) throw new ActionError(`Board with id ${ref} does not exist`);
    return board.id;
  }
  const boards = await dbc.select().from(boardsTable);
  const lower = ref.toLowerCase().trim();
  const exact = boards.find(
    (b) => b.name.toLowerCase() === lower || b.abbreviation?.toLowerCase() === lower
  );
  if (exact) return exact.id;
  const partial = boards.filter((b) => b.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0].id;
  throw new ActionError(
    partial.length === 0
      ? `No board matches "${ref}" — edit the action and select the board`
      : `"${ref}" matches ${partial.length} boards — edit the action and select the exact board`
  );
}

/**
 * Resolve an assignee (UUID or person name). Exact-match first; a named but
 * unresolvable assignee is an ActionError, not a silent unassigned task.
 */
async function resolveAssignee(
  dbc: DbClient,
  assigneeId: string | undefined | null,
  assigneeName: string | undefined | null
): Promise<string | null> {
  if (assigneeId) {
    const [person] = await dbc.select({ id: peopleTable.id }).from(peopleTable).where(eq(peopleTable.id, assigneeId));
    if (person) return person.id;
    throw new ActionError(`Assignee id ${assigneeId} does not exist — edit the action and pick the assignee`);
  }
  if (!assigneeName) return null;
  const people = await dbc.select({ id: peopleTable.id, name: peopleTable.name }).from(peopleTable);
  const lower = assigneeName.toLowerCase().trim();
  const exact = people.filter((p) => p.name.toLowerCase() === lower);
  if (exact.length === 1) return exact[0].id;
  const partial = people.filter((p) => p.name.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0].id;
  throw new ActionError(
    `Assignee "${assigneeName}" did not match exactly one person — edit the action and pick the assignee`
  );
}

const router = Router();

router.get("/pending-actions", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { status } = req.query;

  const actions = await db
    .select()
    .from(pendingActionsTable)
    .where(typeof status === "string" ? eq(pendingActionsTable.status, status as never) : undefined)
    .orderBy(pendingActionsTable.createdAt);

  // Batch the source-document lookups (was one query per action).
  const docIds = [...new Set(actions.map((a) => a.documentId).filter((v): v is string => v != null))];
  const docs = docIds.length ? await db.select({ id: documentsTable.id, title: documentsTable.title, filename: documentsTable.filename }).from(documentsTable).where(inArray(documentsTable.id, docIds)) : [];
  const docById = new Map(docs.map((d) => [d.id, d]));

  const result = actions.map((a) => {
    const doc = a.documentId ? docById.get(a.documentId) : null;
    const data = a.actionData as Record<string, unknown>;
    return {
      ...a,
      documentTitle: doc?.title || null,
      documentFilename: doc?.filename || null,
      aiConfidence: (data?.confidence as number) || null,
      aiDescription: (data?.description as string) || null,
      aiSourceQuote: (data?.source_quote as string) || null,
    };
  });

  res.json(result);
});

async function executeAction(
  dbc: DbClient,
  actionType: string,
  actionData: Record<string, unknown>
): Promise<unknown> {
  switch (actionType) {
    case "create_meeting": {
      const d = actionData as any;
      const resolvedBoardId = await resolveBoard(dbc, d.boardId || d.board_id || d.board_name);

      // Title from multiple possible locations
      const rawTitle = d.title || d.details?.title;

      // Agenda items from multiple possible locations the AI might use
      const agendaItems: any[] = (
        d.agenda_items ||
        d.details?.agenda_items ||
        d.agendaItems ||
        d.agenda ||
        d.details?.agenda ||
        []
      );
      // If AI mentioned an agenda topic in description but no structured items, create one
      const normalizedAgenda: any[] = agendaItems.length
        ? agendaItems
        : d.description
          ? [{ title: String(d.description).split('.')[0].trim().slice(0, 120), type: "information" }]
          : [];

      const meetingDate = parseAIDate(d.date || d.meeting_date);

      // Generate meaningful title if none provided
      let resolvedTitle = rawTitle;
      if (!resolvedTitle) {
        let boardName = "Board";
        if (resolvedBoardId) {
          const [b] = await dbc.select().from(boardsTable).where(eq(boardsTable.id, resolvedBoardId));
          if (b) boardName = b.name;
        }
        const dateLabel = meetingDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
        resolvedTitle = `${boardName} — ${dateLabel}`;
      }

      const [meeting] = await dbc
        .insert(meetingsTable)
        .values({
          boardId: resolvedBoardId,
          title: resolvedTitle,
          date: meetingDate,
          location: d.location,
        })
        .returning();

      if (normalizedAgenda.length) {
        await dbc.insert(agendaItemsTable).values(
          normalizedAgenda.map((item: any, idx: number) => ({
            meetingId: meeting.id,
            position: item.position || idx + 1,
            title: item.title || `Agenda Item ${idx + 1}`,
            type: item.type || "information",
            description: item.description,
          }))
        );
      }

      // Set attendance for board members
      if (resolvedBoardId) {
        const members = await dbc
          .select()
          .from(boardMembershipsTable)
          .where(eq(boardMembershipsTable.boardId, resolvedBoardId));
        if (members.length) {
          await dbc
            .insert(attendanceTable)
            .values(members.map((m) => ({ meetingId: meeting.id, personId: m.personId!, status: "pending" as const })))
            .onConflictDoNothing();
        }
        await grantDefaultAccess("meeting", meeting.id, resolvedBoardId, [], dbc);
      }

      // Auto-attach the source document to the first agenda item
      if (actionData._sourceDocumentId && normalizedAgenda.length) {
        const [firstAgendaItem] = await dbc
          .select()
          .from(agendaItemsTable)
          .where(eq(agendaItemsTable.meetingId, meeting.id))
          .orderBy(agendaItemsTable.position)
          .limit(1);
        if (firstAgendaItem) {
          await dbc
            .insert(agendaDocumentsTable)
            .values({ agendaItemId: firstAgendaItem.id, documentId: actionData._sourceDocumentId as string })
            .onConflictDoNothing();
        }
        // P0.7/A1 — filing the document to a board grants that board's members
        // access to it (via live membership) once the Secretary approves.
        if (resolvedBoardId) {
          await dbc
            .update(documentsTable)
            .set({ boardId: resolvedBoardId })
            .where(and(eq(documentsTable.id, actionData._sourceDocumentId as string), isNull(documentsTable.boardId)));
        }
      }

      return meeting;
    }

    case "create_vote": {
      const { boardId, resolution_number, resolution_text, title, type, deadline, board_name, description, secret, is_secret } = actionData as any;

      const VALID_VOTE_TYPES = ["circulation", "meeting", "simple", "resolution", "election", "special"];
      const voteType = type || "simple";
      if (!VALID_VOTE_TYPES.includes(voteType)) {
        throw new ActionError(`Invalid vote type: ${voteType}`);
      }

      const resolvedBoardId = await resolveBoard(dbc, boardId || board_name);

      const abbrev = resolvedBoardId
        ? (await dbc.select().from(boardsTable).where(eq(boardsTable.id, resolvedBoardId)))[0]?.abbreviation || "GEN"
        : "GEN";

      // Sanitize a caller-/model-supplied resolution number (defense-in-depth
      // against stored XSS in the certificate print view). Auto-generated
      // numbers are already safe.
      const resNum = resolution_number ? sanitizeText(resolution_number) : (await nextResolutionNumber(dbc, abbrev));

      // Extract a meaningful title from the first sentence of description or resolution_text
      const extractTitle = (text: string | undefined): string | undefined => {
        if (!text) return undefined;
        const sentence = text.split(/[.!?\n]/)[0]?.trim();
        return sentence && sentence.length > 5 ? sentence.slice(0, 120) : undefined;
      };
      const resolvedTitle = title || extractTitle(description) || extractTitle(resolution_text) || `Resolution — ${abbrev}`;

      const [vote] = await dbc
        .insert(votesTable)
        .values({
          boardId: resolvedBoardId,
          resolutionNumber: resNum,
          title: resolvedTitle,
          resolutionText: resolution_text || (actionData as any).details?.resolution_text || "To be determined",
          type: voteType,
          deadline: deadline ? new Date(deadline) : null,
          secret: secret === true || is_secret === true,
        })
        .returning();

      if (resolvedBoardId) {
        await grantDefaultAccess("vote", vote.id, resolvedBoardId, [], dbc);
      }

      // Auto-attach the source document to the vote
      if (actionData._sourceDocumentId) {
        const [sourceDoc] = await dbc
          .select()
          .from(documentsTable)
          .where(eq(documentsTable.id, actionData._sourceDocumentId as string));
        if (sourceDoc) {
          await dbc
            .insert(voteDocumentsTable)
            .values({
              voteId: vote.id,
              title: sourceDoc.title || sourceDoc.filename,
              filename: sourceDoc.filename,
              filePath: sourceDoc.filePath,
              fileSize: sourceDoc.fileSize,
              mimeType: sourceDoc.mimeType,
              uploadedBy: sourceDoc.uploadedBy,
            })
            .onConflictDoNothing();
          // P0.7/A1 — file the source document to the vote's board so members see it.
          if (resolvedBoardId && !sourceDoc.boardId) {
            await dbc.update(documentsTable).set({ boardId: resolvedBoardId }).where(eq(documentsTable.id, sourceDoc.id));
          }
        }
      }

      return vote;
    }

    case "create_minutes": {
      const d = actionData as any;
      const meetingId = d.meetingId || d.meeting_id;
      const meetingDate = d.meeting_date;
      const boardName = d.board_name;
      const documentId = d.documentId;

      // Find meeting by date/board if no ID provided
      let resolvedMeetingId = meetingId;
      if (!resolvedMeetingId && meetingDate) {
        const meetings = await dbc.select().from(meetingsTable);
        const dt = parseAIDate(meetingDate);
        const match = meetings.find((m) => {
          const md = new Date(m.date);
          return md.toDateString() === dt.toDateString();
        });
        resolvedMeetingId = match?.id;
      }

      // Always prefer the actual source document file over any AI-generated placeholder.
      // d.content may already be set to placeholder text by the AI, so check documentId first.
      let minutesContent: string | undefined;
      if (documentId) {
        const [doc] = await dbc.select().from(documentsTable).where(eq(documentsTable.id, documentId));
        if (doc?.filePath && fs.existsSync(doc.filePath)) {
          // Only read files we can meaningfully render as text — skip binary formats (PDF, DOCX, etc.)
          const textMimeTypes = ["text/plain", "text/html", "text/markdown", "text/csv"];
          const isText = textMimeTypes.some((m) => (doc.mimeType || "").startsWith(m));
          if (isText) {
            try {
              const raw = fs.readFileSync(doc.filePath, "utf-8");
              // Wrap plain text in HTML paragraphs; leave HTML as-is
              if (!raw.trim().startsWith("<")) {
                minutesContent = raw
                  .split("\n\n")
                  .filter((p: string) => p.trim())
                  .map((p: string) => `<p>${p.trim().replace(/\n/g, " ")}</p>`)
                  .join("\n");
              } else {
                minutesContent = raw;
              }
            } catch {
              // Fall through to d.content fallback
            }
          }
        }
      }
      // Fall back to AI-provided content only if we couldn't read the file
      if (!minutesContent) minutesContent = d.content;

      if (!minutesContent) {
        minutesContent = `<h1>Board Minutes</h1><p>Meeting date: ${meetingDate || "Unknown"}</p><p>Board: ${boardName || "Unknown"}</p><p>[Minutes content — please review and edit before finalizing]</p>`;
      }

      const [minutes] = await dbc
        .insert(minutesTable)
        .values({ meetingId: resolvedMeetingId, content: minutesContent })
        .returning();

      if (resolvedMeetingId) {
        const [meeting] = await dbc.select().from(meetingsTable).where(eq(meetingsTable.id, resolvedMeetingId));
        if (meeting?.boardId) {
          await grantDefaultAccess("minutes", minutes.id, meeting.boardId, [], dbc);
        }
      }

      return minutes;
    }

    case "create_task": {
      const { assignee, assigneeId: rawAssigneeId, task, deadline, sourceParagraph, sourceMeetingId, source_quote } = actionData as any;

      const assigneeId = await resolveAssignee(dbc, rawAssigneeId, assignee);
      const taskNumber = await nextTaskNumber(dbc);

      const [newTask] = await dbc
        .insert(tasksTable)
        .values({
          title: task || "Untitled Task",
          assigneeId,
          dueDate: deadline,
          sourceParagraph: sourceParagraph || source_quote,
          sourceMeetingId,
          taskNumber,
          aiExtracted: true,
        })
        .returning();

      if (assigneeId) {
        await grantDefaultAccess("task", newTask.id, null, [assigneeId], dbc);
      }

      return newTask;
    }

    case "create_workflow": {
      const d = actionData as any;
      const rawStages: Array<{
        title: string;
        board?: string;
        board_name?: string;
        approval_type?: string;
        description?: string;
        stage_group?: number;
      }> = d.stages || d.details?.stages || [];

      if (!rawStages.length) throw new ActionError("Workflow has no stages defined — edit the action first");

      // If the AI didn't assign stage_group, default: all but last are group 0 (parallel endorsements),
      // the last is group 1 (final approval). If only one stage, it's group 0 alone.
      const hasGroups = rawStages.some((s) => s.stage_group !== undefined && s.stage_group !== null);
      const stages = rawStages.map((s, i) => ({
        ...s,
        stage_group: hasGroups
          ? (s.stage_group ?? 0)
          : rawStages.length === 1
          ? 0
          : i < rawStages.length - 1
          ? 0
          : 1,
      }));

      // Resolve final board (last stage) for the workflow parent record
      const finalStage = stages[stages.length - 1];
      const finalBoardId = await resolveBoard(dbc, finalStage.board || finalStage.board_name);

      const [workflow] = await dbc
        .insert(approvalWorkflowsTable)
        .values({
          title: d.title || "Approval Workflow",
          description: d.description,
          boardId: finalBoardId,
        })
        .returning();

      const minGroup = Math.min(...stages.map((s) => s.stage_group));
      let firstVote: typeof votesTable.$inferSelect | null = null;

      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        const stageBoardId = await resolveBoard(dbc, (stage as any).board || (stage as any).board_name);
        const isInitialGroup = stage.stage_group === minGroup;

        let voteId: string | null = null;

        if (isInitialGroup) {
          const abbrev = stageBoardId
            ? (await dbc.select().from(boardsTable).where(eq(boardsTable.id, stageBoardId)))[0]?.abbreviation || "GEN"
            : "GEN";

          const resNum = await nextResolutionNumber(dbc, abbrev);

          const [vote] = await dbc
            .insert(votesTable)
            .values({
              boardId: stageBoardId,
              resolutionNumber: resNum,
              title: `${stage.title} — ${workflow.title}`,
              resolutionText: stage.description || d.description || "To be determined",
              type: "circulation",
              deadline: null,
            })
            .returning();

          if (stageBoardId) {
            await grantDefaultAccess("vote", vote.id, stageBoardId, [], dbc);
          }

          voteId = vote.id;
          if (!firstVote) firstVote = vote;
        }

        await dbc.insert(workflowStagesTable).values({
          workflowId: workflow.id,
          stageIndex: i,
          stageGroup: stage.stage_group,
          title: stage.title,
          description: stage.description,
          boardId: stageBoardId,
          approvalType: (stage.approval_type as any) || "majority",
          voteId,
          status: isInitialGroup ? "active" : "pending",
        });
      }

      // Auto-attach the source document to the first vote in the workflow
      if (actionData._sourceDocumentId && firstVote) {
        const [sourceDoc] = await dbc
          .select()
          .from(documentsTable)
          .where(eq(documentsTable.id, actionData._sourceDocumentId as string));

        if (sourceDoc) {
          await dbc
            .insert(voteDocumentsTable)
            .values({
              voteId: firstVote.id,
              title: sourceDoc.title || sourceDoc.filename,
              filename: sourceDoc.filename,
              filePath: sourceDoc.filePath,
              fileSize: sourceDoc.fileSize,
              mimeType: sourceDoc.mimeType,
              uploadedBy: sourceDoc.uploadedBy,
            })
            .onConflictDoNothing();
        }
      }

      return { workflow, firstVote };
    }

    case "close_task": {
      const { task_number, taskId } = actionData as any;
      let resolvedTaskId = taskId;
      if (!resolvedTaskId && task_number) {
        const [t] = await dbc.select().from(tasksTable)
          .where(eq(tasksTable.taskNumber, task_number))
          .limit(1);
        resolvedTaskId = t?.id;
      }
      if (resolvedTaskId) {
        const [updated] = await dbc
          .update(tasksTable)
          .set({ status: "done" })
          .where(eq(tasksTable.id, resolvedTaskId))
          .returning();
        return updated;
      }
      throw new ActionError("Task not found — edit the action and set the task number, or reject it");
    }

    case "attach_to_meeting": {
      const meetingId = (actionData.meetingId || actionData.meeting_id) as string | undefined;
      const docId = (actionData._sourceDocumentId || actionData.documentId) as string | undefined;
      if (meetingId && docId) {
        const [firstAgendaItem] = await dbc
          .select()
          .from(agendaItemsTable)
          .where(eq(agendaItemsTable.meetingId, meetingId))
          .orderBy(agendaItemsTable.position)
          .limit(1);
        if (firstAgendaItem) {
          await dbc
            .insert(agendaDocumentsTable)
            .values({ agendaItemId: firstAgendaItem.id, documentId: docId })
            .onConflictDoNothing();
          return { message: "Document attached to meeting" };
        }
      }
      return { message: "Document attachment noted (no matching agenda item)" };
    }

    case "flag_confidential": {
      const d = actionData as any;
      const docId = (d.documentId || d._sourceDocumentId) as string | undefined;
      if (!docId) throw new ActionError("No document to flag — edit the action or reject it");
      const note = [d.reason, d.passage].filter(Boolean).join(" — ").slice(0, 5000) || "Flagged confidential by AI classification (Secretary approved)";
      const [doc] = await dbc
        .update(documentsTable)
        .set({ confidential: true, confidentialNote: note })
        .where(eq(documentsTable.id, docId))
        .returning();
      if (!doc) throw new ActionError("Document not found");
      return doc;
    }

    default:
      // validateActionData rejects unknown types before we get here; this is a
      // hard failure, not a silent success.
      throw new Error(`No executor for action type: ${actionType}`);
  }
}

// P0.2 — approving an AI-proposed action is the human-in-the-loop moment that
// makes it real. Second factor required, and recent.
router.post("/pending-actions/:id/approve", requireAuth, requireAdmin, requireFreshMfa, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { actionData: overrideData, secretaryNotes } = req.body || {};

  const [action] = await db.select().from(pendingActionsTable).where(eq(pendingActionsTable.id, id));
  if (!action) {
    res.status(404).json({ error: "Action not found" });
    return;
  }
  if (action.status !== "pending") {
    res.status(409).json({ error: `Action has already been resolved (status: ${action.status})` });
    return;
  }

  const dataToUse = overrideData || action.actionData;

  // Validate BEFORE executing — applies equally to the stored AI proposal and
  // to any Secretary override sent in the request body.
  const validation = validateActionData(action.actionType, dataToUse);
  if (!validation.ok) {
    res.status(422).json({ error: validation.error });
    return;
  }

  // Merge documentId from the action row into the data so create_minutes can read document text
  // _sourceDocumentId is used by create_meeting/create_vote/attach_to_meeting to auto-attach
  const dataWithContext = action.documentId
    ? { ...validation.data, documentId: action.documentId, _sourceDocumentId: action.documentId }
    : validation.data;

  try {
    // Entity creation and the approval-status flip are one atomic unit — a
    // mid-way failure leaves neither a half-built entity graph nor a consumed action.
    const { entity, updated } = await db.transaction(async (tx) => {
      const entity = await executeAction(tx, action.actionType, dataWithContext as Record<string, unknown>);
      const [updated] = await tx
        .update(pendingActionsTable)
        .set({
          status: overrideData ? "modified" : "approved",
          secretaryNotes,
          resolvedAt: new Date(),
          actionData: dataToUse as any,
        })
        .where(eq(pendingActionsTable.id, id))
        .returning();
      // Fail-closed (P0.6): the approval and its audit entry commit together.
      await auditInTx(tx, req, "pending_action_approved", "pending_action", id, {
        actionType: action.actionType,
        modified: !!overrideData,
      });
      return { entity, updated };
    });
    emitInvalidate("pendingActions", { id });
    // Also invalidate the entity the approval just created/changed.
    const RESOURCE_BY_ACTION: Record<string, RealtimeResource> = {
      create_meeting: "meetings",
      create_vote: "votes",
      create_task: "tasks",
      close_task: "tasks",
      create_minutes: "minutes",
      create_workflow: "votes",
      attach_to_meeting: "meetings",
      flag_confidential: "documents",
    };
    const resource = RESOURCE_BY_ACTION[action.actionType];
    if (resource) {
      const entityBoardId = (entity as { boardId?: string | null } | null)?.boardId ?? null;
      emitInvalidate(resource, { boardId: entityBoardId });
    }
    res.json({ action: updated, createdEntity: entity });
  } catch (err: unknown) {
    if (err instanceof ActionError) {
      res.status(422).json({ error: err.message });
      return;
    }
    logger.error({ err, actionId: id, actionType: action.actionType }, "Failed to execute approved action");
    res.status(500).json({ error: "Failed to execute action — see server logs" });
  }
});

router.post("/pending-actions/:id/reject", requireAuth, requireAdmin, requireFreshMfa, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { secretaryNotes } = req.body || {};

  const [action] = await db.select().from(pendingActionsTable).where(eq(pendingActionsTable.id, id));
  if (!action) {
    res.status(404).json({ error: "Action not found" });
    return;
  }
  // Idempotency: an already-resolved action (approved/rejected/modified) can't be
  // flipped — otherwise an approved action's created entity would be orphaned.
  if (action.status !== "pending") {
    res.status(409).json({ error: `Action has already been resolved (status: ${action.status})` });
    return;
  }

  // Fail-closed (P0.6): the rejection and its audit entry commit together.
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(pendingActionsTable)
      .set({ status: "rejected", secretaryNotes, resolvedAt: new Date() })
      .where(eq(pendingActionsTable.id, id))
      .returning();
    await auditInTx(tx, req, "pending_action_rejected", "pending_action", id, { actionType: rows[0].actionType });
    return rows;
  });
  emitInvalidate("pendingActions", { id });
  res.json(updated);
});

export default router;
