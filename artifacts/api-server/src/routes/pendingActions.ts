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
  attendanceTable,
  approvalWorkflowsTable,
  workflowStagesTable,
  voteDocumentsTable,
  agendaDocumentsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { grantDefaultAccess } from "../lib/access";
import { writeLimiter } from "../lib/rateLimiters";

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
 * Resolve a boardId that might be a UUID or a board name/abbreviation.
 */
async function resolveBoardId(boardIdOrName: string | undefined | null): Promise<string | undefined> {
  if (!boardIdOrName) return undefined;
  // UUID format
  if (/^[0-9a-f-]{36}$/.test(boardIdOrName)) return boardIdOrName;
  // Try matching by name or abbreviation
  const boards = await db.select().from(boardsTable);
  const match = boards.find(
    (b) =>
      b.name.toLowerCase().includes(boardIdOrName.toLowerCase()) ||
      b.abbreviation?.toLowerCase() === boardIdOrName.toLowerCase()
  );
  return match?.id;
}

const router = Router();

router.get("/pending-actions", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { status } = req.query;

  let actions = await db.select().from(pendingActionsTable).orderBy(pendingActionsTable.createdAt);
  if (status) actions = actions.filter((a) => a.status === status);

  const result = await Promise.all(
    actions.map(async (a) => {
      const [doc] = a.documentId
        ? await db.select().from(documentsTable).where(eq(documentsTable.id, a.documentId))
        : [null];
      const data = a.actionData as Record<string, unknown>;
      return {
        ...a,
        documentTitle: doc?.title || null,
        documentFilename: doc?.filename || null,
        aiConfidence: (data?.confidence as number) || null,
        aiDescription: (data?.description as string) || null,
      };
    })
  );

  res.json(result);
});

async function executeAction(actionType: string, actionData: Record<string, unknown>): Promise<unknown> {
  switch (actionType) {
    case "create_meeting": {
      const d = actionData as any;
      // Resolve boardId — may be a UUID, name, or abbreviation
      const resolvedBoardId = await resolveBoardId(d.boardId || d.board_id || d.board_name);

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

      // Parse date safely (BUG 6 fix)
      const meetingDate = parseAIDate(d.date || d.meeting_date);

      // Generate meaningful title if none provided
      let resolvedTitle = rawTitle;
      if (!resolvedTitle) {
        let boardName = "Board";
        if (resolvedBoardId) {
          const [b] = await db.select().from(boardsTable).where(eq(boardsTable.id, resolvedBoardId));
          if (b) boardName = b.name;
        }
        const dateLabel = meetingDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
        resolvedTitle = `${boardName} — ${dateLabel}`;
      }

      const [meeting] = await db
        .insert(meetingsTable)
        .values({
          boardId: resolvedBoardId,
          title: resolvedTitle,
          date: meetingDate,
          location: d.location,
        })
        .returning();

      if (normalizedAgenda.length) {
        const agendaItemsTable = (await import("@workspace/db")).agendaItemsTable;
        await db.insert(agendaItemsTable).values(
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
        const members = await db
          .select()
          .from(boardMembershipsTable)
          .where(eq(boardMembershipsTable.boardId, resolvedBoardId));
        if (members.length) {
          await db
            .insert(attendanceTable)
            .values(members.map((m) => ({ meetingId: meeting.id, personId: m.personId!, status: "pending" as const })))
            .onConflictDoNothing();
        }
        await grantDefaultAccess("meeting", meeting.id, resolvedBoardId);
      }

      // Auto-attach the source document to the first agenda item
      if (actionData._sourceDocumentId && normalizedAgenda.length) {
        try {
          const agendaItemsForAttach = (await import("@workspace/db")).agendaItemsTable;
          const [firstAgendaItem] = await db
            .select()
            .from(agendaItemsForAttach)
            .where(eq(agendaItemsForAttach.meetingId, meeting.id))
            .orderBy(agendaItemsForAttach.position)
            .limit(1);
          if (firstAgendaItem) {
            await db
              .insert(agendaDocumentsTable)
              .values({ agendaItemId: firstAgendaItem.id, documentId: actionData._sourceDocumentId as string })
              .onConflictDoNothing();
          }
        } catch (e) {
          console.error("Failed to attach document to meeting agenda:", e);
        }
      }

      return meeting;
    }

    case "create_vote": {
      const { boardId, resolution_number, resolution_text, title, type, deadline, board_name, description } = actionData as any;

      const VALID_VOTE_TYPES = ["circulation", "meeting", "simple", "resolution", "election", "special"];
      const voteType = type || "simple";
      if (!VALID_VOTE_TYPES.includes(voteType)) {
        res.status(400).json({ error: `Invalid vote type: ${voteType}` });
        return;
      }

      // Auto-find board by name if needed
      let resolvedBoardId = boardId;
      if (!resolvedBoardId && board_name) {
        const boards = await db.select().from(boardsTable);
        const match = boards.find((b) => b.name.toLowerCase().includes(board_name.toLowerCase()));
        resolvedBoardId = match?.id;
      }

      const year = new Date().getFullYear();
      const votes = await db.select().from(votesTable);
      const seq = (votes.length + 1).toString().padStart(3, "0");
      const abbrev = resolvedBoardId
        ? (await db.select().from(boardsTable).where(eq(boardsTable.id, resolvedBoardId)))[0]?.abbreviation || "GEN"
        : "GEN";

      const resNum = resolution_number || `RES-${abbrev}-${year}-${seq}`;

      // Extract a meaningful title from the first sentence of description or resolution_text
      const extractTitle = (text: string | undefined): string | undefined => {
        if (!text) return undefined;
        const sentence = text.split(/[.!?\n]/)[0]?.trim();
        return sentence && sentence.length > 5 ? sentence.slice(0, 120) : undefined;
      };
      const resolvedTitle = title || extractTitle(description) || extractTitle(resolution_text) || `Resolution — ${abbrev}`;

      const [vote] = await db
        .insert(votesTable)
        .values({
          boardId: resolvedBoardId,
          resolutionNumber: resNum,
          title: resolvedTitle,
          resolutionText: resolution_text || (actionData as any).details?.resolution_text || "To be determined",
          type: voteType,
          deadline: deadline ? new Date(deadline) : null,
          secret: d.secret === true || d.is_secret === true,
        })
        .returning();

      if (resolvedBoardId) {
        await grantDefaultAccess("vote", vote.id, resolvedBoardId);
      }

      // Auto-attach the source document to the vote
      if (actionData._sourceDocumentId) {
        try {
          const [sourceDoc] = await db
            .select()
            .from(documentsTable)
            .where(eq(documentsTable.id, actionData._sourceDocumentId as string));
          if (sourceDoc) {
            await db
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
          }
        } catch (e) {
          console.error("Failed to attach document to vote:", e);
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
        const meetings = await db.select().from(meetingsTable);
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
        const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, documentId));
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

      const [minutes] = await db
        .insert(minutesTable)
        .values({ meetingId: resolvedMeetingId, content: minutesContent })
        .returning();

      if (resolvedMeetingId) {
        const [meeting] = await db.select().from(meetingsTable).where(eq(meetingsTable.id, resolvedMeetingId));
        if (meeting?.boardId) {
          await grantDefaultAccess("minutes", minutes.id, meeting.boardId);
        }
      }

      return minutes;
    }

    case "create_task": {
      const { assignee, task, deadline, sourceParagraph, sourceMeetingId } = actionData as any;

      // Find person by name
      let assigneeId: string | null = null;
      if (assignee) {
        const { peopleTable: pt } = await import("@workspace/db");
        const people = await db.select().from(pt);
        const match = people.find((p) => p.name.toLowerCase().includes(assignee.toLowerCase()));
        assigneeId = match?.id || null;
      }

      const year = new Date().getFullYear();

      // Retry up to 5 times if the generated task number collides with an existing one
      let newTask: typeof tasksTable.$inferSelect | undefined;
      let attempts = 0;
      while (!newTask && attempts < 5) {
        try {
          const existingTasks = await db.select().from(tasksTable);
          const seq = (existingTasks.length + 1 + attempts).toString().padStart(3, "0");
          const taskNumber = `TASK-${year}-${seq}`;

          [newTask] = await db
            .insert(tasksTable)
            .values({
              title: task || "Untitled Task",
              assigneeId,
              dueDate: deadline,
              sourceParagraph,
              sourceMeetingId,
              taskNumber,
              aiExtracted: true,
            })
            .returning();
        } catch (e: any) {
          if (e.message?.includes("unique") || e.code === "23505") {
            attempts++;
          } else {
            throw e;
          }
        }
      }
      if (!newTask) throw new Error("Failed to generate unique task number after 5 attempts");

      if (assigneeId) {
        await grantDefaultAccess("task", newTask.id, null, [assigneeId]);
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
      }> = d.stages || [];

      if (!rawStages.length) return { error: "No stages defined" };

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
      const finalBoardId = await resolveBoardId(finalStage.board || finalStage.board_name);

      const [workflow] = await db
        .insert(approvalWorkflowsTable)
        .values({
          title: d.title || "Approval Workflow",
          description: d.description,
          boardId: finalBoardId,
        })
        .returning();

      const minGroup = Math.min(...stages.map((s) => s.stage_group));
      let firstVote: typeof votesTable.$inferSelect | null = null;
      const allVotesNow = await db.select().from(votesTable);
      let seqBase = allVotesNow.length;

      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        const stageBoardId = await resolveBoardId((stage as any).board || (stage as any).board_name);
        const isInitialGroup = stage.stage_group === minGroup;

        let voteId: string | null = null;

        if (isInitialGroup) {
          seqBase += 1;
          const abbrev = stageBoardId
            ? (await db.select().from(boardsTable).where(eq(boardsTable.id, stageBoardId)))[0]?.abbreviation || "GEN"
            : "GEN";

          const year = new Date().getFullYear();
          const resNum = `RES-${abbrev}-${year}-${seqBase.toString().padStart(3, "0")}`;

          const [vote] = await db
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
            await grantDefaultAccess("vote", vote.id, stageBoardId);
          }

          voteId = vote.id;
          if (!firstVote) firstVote = vote;
        }

        await db.insert(workflowStagesTable).values({
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
        try {
          const [sourceDoc] = await db
            .select()
            .from(documentsTable)
            .where(eq(documentsTable.id, actionData._sourceDocumentId as string));

          if (sourceDoc) {
            await db
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
        } catch (e) {
          console.error("Failed to attach document to workflow vote:", e);
        }
      }

      return { workflow, firstVote };
    }

    case "close_task": {
      const { task_number, taskId, reasoning } = actionData as any;
      let resolvedTaskId = taskId;
      if (!resolvedTaskId && task_number) {
        const [t] = await db.select().from(tasksTable)
          .where(eq(tasksTable.taskNumber, task_number))
          .limit(1);
        resolvedTaskId = t?.id;
      }
      if (resolvedTaskId) {
        const [updated] = await db
          .update(tasksTable)
          .set({ status: "done" })
          .where(eq(tasksTable.id, resolvedTaskId))
          .returning();
        return updated;
      }
      return { message: "Task not found, marked manually" };
    }

    case "attach_to_meeting": {
      const meetingId = (actionData.meetingId || actionData.meeting_id) as string | undefined;
      const docId = (actionData._sourceDocumentId || actionData.documentId) as string | undefined;
      if (meetingId && docId) {
        try {
          const agendaItemsTable = (await import("@workspace/db")).agendaItemsTable;
          const [firstAgendaItem] = await db
            .select()
            .from(agendaItemsTable)
            .where(eq(agendaItemsTable.meetingId, meetingId))
            .orderBy(agendaItemsTable.position)
            .limit(1);
          if (firstAgendaItem) {
            await db
              .insert(agendaDocumentsTable)
              .values({ agendaItemId: firstAgendaItem.id, documentId: docId })
              .onConflictDoNothing();
            return { message: "Document attached to meeting" };
          }
        } catch (e) {
          console.error("Failed to attach document to meeting:", e);
        }
      }
      return { message: "Document attachment noted (no matching agenda item)" };
    }

    case "flag_confidential": {
      return { message: "Flagged as confidential", passage: (actionData as any).passage };
    }

    default:
      return { message: `Action ${actionType} executed` };
  }
}

router.post("/pending-actions/:id/approve", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { actionData: overrideData, secretaryNotes } = req.body || {};

  const [action] = await db.select().from(pendingActionsTable).where(eq(pendingActionsTable.id, id));
  if (!action) {
    res.status(404).json({ error: "Action not found" });
    return;
  }

  const dataToUse = overrideData || action.actionData;

  // Merge documentId from the action row into the data so create_minutes can read document text
  // _sourceDocumentId is used by create_meeting/create_vote/attach_to_meeting to auto-attach
  const dataWithContext = action.documentId
    ? { ...(dataToUse as object), documentId: action.documentId, _sourceDocumentId: action.documentId }
    : dataToUse;

  try {
    const entity = await executeAction(action.actionType, dataWithContext as Record<string, unknown>);

    const [updated] = await db
      .update(pendingActionsTable)
      .set({
        status: overrideData ? "modified" : "approved",
        secretaryNotes,
        resolvedAt: new Date(),
        actionData: dataToUse as any,
      })
      .where(eq(pendingActionsTable.id, id))
      .returning();

    res.json({ action: updated, createdEntity: entity });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: `Failed to execute action: ${msg}` });
  }
});

router.post("/pending-actions/:id/reject", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { secretaryNotes } = req.body || {};

  const [updated] = await db
    .update(pendingActionsTable)
    .set({ status: "rejected", secretaryNotes, resolvedAt: new Date() })
    .where(eq(pendingActionsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Action not found" });
    return;
  }

  res.json(updated);
});

export default router;
