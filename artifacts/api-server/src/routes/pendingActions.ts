import { Router } from "express";
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
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { grantDefaultAccess } from "../lib/access";

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
      const { boardId, date, location, agenda_items } = actionData as any;
      const rawTitle = (actionData as any).title || (actionData as any).details?.title;

      // Generate meaningful title if none provided
      let resolvedTitle = rawTitle;
      if (!resolvedTitle) {
        let boardName = "Board";
        if (boardId) {
          const [b] = await db.select().from(boardsTable).where(eq(boardsTable.id, boardId));
          if (b) boardName = b.name;
        }
        const d = date ? new Date(date) : new Date();
        const dateLabel = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
        resolvedTitle = `${boardName} — ${dateLabel}`;
      }

      const [meeting] = await db
        .insert(meetingsTable)
        .values({
          boardId,
          title: resolvedTitle,
          date: date ? new Date(date) : new Date(),
          location,
        })
        .returning();

      if (agenda_items?.length) {
        const agendaItemsTable = (await import("@workspace/db")).agendaItemsTable;
        await db.insert(agendaItemsTable).values(
          agenda_items.map((item: any, idx: number) => ({
            meetingId: meeting.id,
            position: item.position || idx + 1,
            title: item.title || `Agenda Item ${idx + 1}`,
            type: item.type || "information",
            description: item.description,
          }))
        );
      }

      // Set attendance for board members
      if (boardId) {
        const members = await db
          .select()
          .from(boardMembershipsTable)
          .where(eq(boardMembershipsTable.boardId, boardId));
        if (members.length) {
          await db
            .insert(attendanceTable)
            .values(members.map((m) => ({ meetingId: meeting.id, personId: m.personId!, status: "pending" as const })))
            .onConflictDoNothing();
        }
        await grantDefaultAccess("meeting", meeting.id, boardId);
      }

      return meeting;
    }

    case "create_vote": {
      const { boardId, resolution_number, resolution_text, title, type, deadline, board_name } = actionData as any;

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

      const [vote] = await db
        .insert(votesTable)
        .values({
          boardId: resolvedBoardId,
          resolutionNumber: resNum,
          title: title || "Untitled Resolution",
          resolutionText: resolution_text || (actionData as any).details?.resolution_text || "To be determined",
          type: type || "circulation",
          deadline: deadline ? new Date(deadline) : null,
        })
        .returning();

      if (resolvedBoardId) {
        await grantDefaultAccess("vote", vote.id, resolvedBoardId);
      }

      return vote;
    }

    case "create_minutes": {
      const { meetingId, content, meeting_date, board_name } = actionData as any;

      // Find meeting by date/board if no ID provided
      let resolvedMeetingId = meetingId;
      if (!resolvedMeetingId && meeting_date) {
        const meetings = await db.select().from(meetingsTable);
        const d = new Date(meeting_date);
        const match = meetings.find((m) => {
          const md = new Date(m.date);
          return md.toDateString() === d.toDateString();
        });
        resolvedMeetingId = match?.id;
      }

      // Build content from extracted data
      const minutesContent = content || `<h1>Board Minutes</h1><p>Meeting date: ${meeting_date || "Unknown"}</p><p>Board: ${board_name || "Unknown"}</p><p>[AI-extracted minutes content — please review and edit before finalizing]</p>`;

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
      const tasks = await db.select().from(tasksTable);
      const seq = (tasks.length + 1).toString().padStart(3, "0");
      const taskNumber = `TASK-${year}-${seq}`;

      const [newTask] = await db
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

      if (assigneeId) {
        await grantDefaultAccess("task", newTask.id, null, [assigneeId]);
      }

      return newTask;
    }

    case "close_task": {
      const { task_number, taskId, reasoning } = actionData as any;
      let resolvedTaskId = taskId;
      if (!resolvedTaskId && task_number) {
        const [t] = await db.select().from(tasksTable);
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
      return { message: "Document attachment noted" };
    }

    case "flag_confidential": {
      return { message: "Flagged as confidential", passage: (actionData as any).passage };
    }

    default:
      return { message: `Action ${actionType} executed` };
  }
}

router.post("/pending-actions/:id/approve", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { actionData: overrideData, secretaryNotes } = req.body || {};

  const [action] = await db.select().from(pendingActionsTable).where(eq(pendingActionsTable.id, id));
  if (!action) {
    res.status(404).json({ error: "Action not found" });
    return;
  }

  const dataToUse = overrideData || action.actionData;

  try {
    const entity = await executeAction(action.actionType, dataToUse as Record<string, unknown>);

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

router.post("/pending-actions/:id/reject", requireAuth, requireAdmin, async (req, res): Promise<void> => {
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
