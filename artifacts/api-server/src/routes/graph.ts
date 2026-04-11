import { Router } from "express";
import {
  db,
  boardsTable,
  boardMembershipsTable,
  peopleTable,
  meetingsTable,
  votesTable,
  voteRecordsTable,
  voteDocumentsTable,
  minutesTable,
  minutesSignaturesTable,
  documentsTable,
  agendaItemsTable,
  agendaDocumentsTable,
  tasksTable,
  pendingActionsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../lib/auth";

const router = Router();

interface GraphNode {
  id: string;
  type: "board" | "person" | "vote" | "meeting" | "minutes" | "document" | "task";
  label: string;
  status?: string | null;
  date?: string | null;
  boardId?: string | null;
  role?: string | null;
}

interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
}

router.get("/graph", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const filterBoardId = req.query.boardId as string | undefined;

  let accessibleBoardIds: string[];

  if (user.role === "admin") {
    const allBoards = await db.select({ id: boardsTable.id }).from(boardsTable);
    accessibleBoardIds = allBoards.map((b) => b.id);
  } else {
    const memberships = await db
      .select({ boardId: boardMembershipsTable.boardId })
      .from(boardMembershipsTable)
      .where(eq(boardMembershipsTable.personId, user.id));
    accessibleBoardIds = memberships.map((m) => m.boardId).filter(Boolean) as string[];
  }

  if (filterBoardId) {
    if (!accessibleBoardIds.includes(filterBoardId)) {
      res.status(403).json({ error: "Access denied to this board" });
      return;
    }
    accessibleBoardIds = [filterBoardId];
  }

  if (accessibleBoardIds.length === 0) {
    res.json({ nodes: [], edges: [] });
    return;
  }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (node: GraphNode) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
  };

  const boards = await db.select().from(boardsTable).where(inArray(boardsTable.id, accessibleBoardIds));
  for (const b of boards) {
    addNode({ id: b.id, type: "board", label: b.abbreviation || b.name });
  }

  const memberships = await db
    .select()
    .from(boardMembershipsTable)
    .where(inArray(boardMembershipsTable.boardId, accessibleBoardIds));

  const personIds = [...new Set(memberships.map((m) => m.personId).filter(Boolean) as string[])];
  if (personIds.length > 0) {
    const people = await db.select().from(peopleTable).where(inArray(peopleTable.id, personIds));
    for (const p of people) {
      addNode({ id: p.id, type: "person", label: p.name, role: p.role });
    }
  }
  for (const m of memberships) {
    if (m.boardId && m.personId) {
      edges.push({ source: m.boardId, target: m.personId, relationship: "member" });
    }
  }

  const votes = await db.select().from(votesTable).where(inArray(votesTable.boardId, accessibleBoardIds));
  for (const v of votes) {
    addNode({
      id: v.id,
      type: "vote",
      label: v.title,
      status: v.status,
      date: v.createdAt?.toISOString() ?? null,
      boardId: v.boardId,
    });
    if (v.boardId) edges.push({ source: v.boardId, target: v.id, relationship: "contains" });
  }

  const voteIds = votes.map((v) => v.id);
  if (voteIds.length > 0) {
    const voteRecords = await db.select().from(voteRecordsTable).where(inArray(voteRecordsTable.voteId, voteIds));
    const secretVoteIds = new Set(votes.filter((v) => v.secret).map((v) => v.id));
    const isAdmin = user.role === "admin";

    for (const vr of voteRecords) {
      if (vr.personId) {
        addNode({ id: vr.personId, type: "person", label: "", role: null });
        const isSecret = secretVoteIds.has(vr.voteId!);
        let relationship = "voted";
        if (!isSecret || isAdmin) {
          relationship = `voted (${vr.decision})`;
        }
        edges.push({ source: vr.voteId!, target: vr.personId, relationship });
      }
    }

    if (!nodeIds.has("_people_fetched_for_votes")) {
      const voterIds = voteRecords.map((vr) => vr.personId).filter(Boolean) as string[];
      const missingIds = voterIds.filter((id) => {
        const existing = nodes.find((n) => n.id === id);
        return existing && !existing.label;
      });
      if (missingIds.length > 0) {
        const missingPeople = await db.select().from(peopleTable).where(inArray(peopleTable.id, missingIds));
        for (const p of missingPeople) {
          const existing = nodes.find((n) => n.id === p.id);
          if (existing) {
            existing.label = p.name;
            existing.role = p.role;
          }
        }
      }
    }

    const voteDocs = await db.select().from(voteDocumentsTable).where(inArray(voteDocumentsTable.voteId, voteIds));
    for (const vd of voteDocs) {
      addNode({
        id: vd.id,
        type: "document",
        label: vd.title || vd.filename,
        boardId: null,
      });
      edges.push({ source: vd.voteId, target: vd.id, relationship: "supporting document" });
    }
  }

  const meetings = await db
    .select()
    .from(meetingsTable)
    .where(inArray(meetingsTable.boardId, accessibleBoardIds));
  for (const m of meetings) {
    addNode({
      id: m.id,
      type: "meeting",
      label: m.title,
      status: m.status,
      date: m.date?.toISOString() ?? null,
      boardId: m.boardId,
    });
    if (m.boardId) edges.push({ source: m.boardId, target: m.id, relationship: "contains" });
  }

  const meetingIds = meetings.map((m) => m.id);

  const allMinutes = await db
    .select()
    .from(minutesTable)
    .where(meetingIds.length > 0 ? inArray(minutesTable.meetingId, meetingIds) : eq(minutesTable.id, ""));
  for (const m of allMinutes) {
    addNode({
      id: m.id,
      type: "minutes",
      label: `Minutes`,
      status: m.status,
      date: m.createdAt?.toISOString() ?? null,
      boardId: null,
    });
    if (m.meetingId) edges.push({ source: m.meetingId, target: m.id, relationship: "produced" });
  }

  const minutesIds = allMinutes.map((m) => m.id);
  if (minutesIds.length > 0) {
    const signatures = await db
      .select()
      .from(minutesSignaturesTable)
      .where(inArray(minutesSignaturesTable.minutesId, minutesIds));
    for (const s of signatures) {
      if (s.personId && s.minutesId) {
        edges.push({ source: s.minutesId, target: s.personId, relationship: "signed by" });
      }
    }
  }

  if (meetingIds.length > 0) {
    const agendaItems = await db
      .select()
      .from(agendaItemsTable)
      .where(inArray(agendaItemsTable.meetingId, meetingIds));
    const agendaItemIds = agendaItems.map((a) => a.id);

    if (agendaItemIds.length > 0) {
      const agendaDocs = await db
        .select()
        .from(agendaDocumentsTable)
        .where(inArray(agendaDocumentsTable.agendaItemId, agendaItemIds));

      const agendaItemToMeeting = new Map(agendaItems.map((a) => [a.id, a.meetingId]));

      const docIds = agendaDocs.map((ad) => ad.documentId).filter(Boolean) as string[];
      if (docIds.length > 0) {
        const docs = await db.select().from(documentsTable).where(inArray(documentsTable.id, docIds));
        for (const d of docs) {
          addNode({
            id: d.id,
            type: "document",
            label: d.title || d.filename,
            boardId: d.boardId,
          });
        }
        for (const ad of agendaDocs) {
          if (ad.documentId && ad.agendaItemId) {
            const meetingId = agendaItemToMeeting.get(ad.agendaItemId);
            if (meetingId) {
              edges.push({ source: meetingId, target: ad.documentId, relationship: "agenda document" });
            }
          }
        }
      }
    }
  }

  const boardDocs = await db
    .select()
    .from(documentsTable)
    .where(inArray(documentsTable.boardId, accessibleBoardIds));
  for (const d of boardDocs) {
    addNode({
      id: d.id,
      type: "document",
      label: d.title || d.filename,
      boardId: d.boardId,
    });
    if (d.boardId) edges.push({ source: d.boardId, target: d.id, relationship: "document" });
  }

  const tasks = await db
    .select()
    .from(tasksTable)
    .where(inArray(tasksTable.boardId, accessibleBoardIds));
  for (const t of tasks) {
    addNode({
      id: t.id,
      type: "task",
      label: t.title,
      status: t.status,
      date: t.dueDate ?? null,
      boardId: t.boardId,
    });
    if (t.sourceMeetingId) {
      edges.push({ source: t.sourceMeetingId, target: t.id, relationship: "created task" });
    }
    if (t.assigneeId) {
      edges.push({ source: t.id, target: t.assigneeId, relationship: "assigned to" });
    }
    if (t.boardId) {
      edges.push({ source: t.boardId, target: t.id, relationship: "contains" });
    }
  }

  const allDocIds = nodes.filter((n) => n.type === "document").map((n) => n.id);
  if (allDocIds.length > 0) {
    const pendingActions = await db
      .select()
      .from(pendingActionsTable)
      .where(inArray(pendingActionsTable.documentId, allDocIds));

    for (const pa of pendingActions) {
      if (!pa.documentId || pa.status !== "approved") continue;
      const data = pa.actionData as any;
      if (pa.actionType === "create_vote" && data?.resultVoteId && nodeIds.has(data.resultVoteId)) {
        edges.push({ source: pa.documentId, target: data.resultVoteId, relationship: "triggered vote" });
      } else if (pa.actionType === "create_meeting" && data?.resultMeetingId && nodeIds.has(data.resultMeetingId)) {
        edges.push({ source: pa.documentId, target: data.resultMeetingId, relationship: "triggered meeting" });
      }
    }
  }

  const dedupedEdges: GraphEdge[] = [];
  const edgeSet = new Set<string>();
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    const key = `${e.source}|${e.target}|${e.relationship}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      dedupedEdges.push(e);
    }
  }

  res.json({ nodes, edges: dedupedEdges });
});

export default router;
