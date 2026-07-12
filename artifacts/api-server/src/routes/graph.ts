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
import { eq, inArray, ilike, or, sql, and, lt, ne } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { accessibleEntityIds } from "../lib/access";

const router = Router();

type AclEntityType = "document" | "vote" | "meeting" | "task" | "minutes";

/**
 * Per-request ENTITY-level visibility (external-review item 7): the graph
 * previously scoped by board membership only, so a member explicitly denied a
 * document (a recusal, an expired grant) still saw its title and edges here
 * while the document routes correctly 403'd. Same model as everywhere else —
 * membership OR unexpired grant, MINUS deny (lib/access.ts) — resolved once
 * per request. Admins see everything, as on the entity routes.
 */
async function entityVisibility(user: { id: string; role: string }): Promise<(type: AclEntityType, id: string) => boolean> {
  if (user.role === "admin") return () => true;
  const types: AclEntityType[] = ["document", "vote", "meeting", "task", "minutes"];
  const sets = new Map<AclEntityType, Set<string>>();
  await Promise.all(types.map(async (t) => sets.set(t, new Set(await accessibleEntityIds(user.id, t)))));
  return (type, id) => sets.get(type)!.has(id);
}

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

  const canSee = await entityVisibility(user);

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

  const votes = (await db.select().from(votesTable).where(inArray(votesTable.boardId, accessibleBoardIds)))
    .filter((v) => canSee("vote", v.id));
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

  const meetings = (
    await db
      .select()
      .from(meetingsTable)
      .where(inArray(meetingsTable.boardId, accessibleBoardIds))
  ).filter((m) => canSee("meeting", m.id));
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

  // (meetingIds can be empty — the old `eq(minutesTable.id, "")` fallback threw
  // on the uuid cast, 500ing the whole graph for any member with no meetings.)
  const allMinutes = (
    meetingIds.length > 0
      ? await db.select().from(minutesTable).where(inArray(minutesTable.meetingId, meetingIds))
      : []
  ).filter((m) => canSee("minutes", m.id));
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
        const docs = (await db.select().from(documentsTable).where(inArray(documentsTable.id, docIds)))
          .filter((d) => canSee("document", d.id));
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

  const boardDocs = (
    await db
      .select()
      .from(documentsTable)
      .where(inArray(documentsTable.boardId, accessibleBoardIds))
  ).filter((d) => canSee("document", d.id));
  for (const d of boardDocs) {
    addNode({
      id: d.id,
      type: "document",
      label: d.title || d.filename,
      boardId: d.boardId,
    });
    if (d.boardId) edges.push({ source: d.boardId, target: d.id, relationship: "document" });
  }

  const tasks = (
    await db
      .select()
      .from(tasksTable)
      .where(inArray(tasksTable.boardId, accessibleBoardIds))
  ).filter((t) => canSee("task", t.id));
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

// ── SUMMARY DASHBOARD ──
router.get("/graph/summary", requireAuth, async (req, res): Promise<void> => {
  const filterBoardId = req.query.boardId as string | undefined;
  const user = req.user!;

  let accessibleBoardIds: string[];
  if (user.role === "admin") {
    const allBoards = await db.select({ id: boardsTable.id }).from(boardsTable);
    accessibleBoardIds = allBoards.map((b) => b.id);
  } else {
    const memberships = await db.select({ boardId: boardMembershipsTable.boardId }).from(boardMembershipsTable).where(eq(boardMembershipsTable.personId, user.id));
    accessibleBoardIds = memberships.map((m) => m.boardId).filter(Boolean) as string[];
  }
  if (filterBoardId) {
    if (!accessibleBoardIds.includes(filterBoardId)) { res.status(403).json({ error: "Access denied" }); return; }
    accessibleBoardIds = [filterBoardId];
  }
  if (accessibleBoardIds.length === 0) { res.json({ votes: {}, meetings: {}, documents: {}, tasks: {}, minutes: {}, people: {}, projects: [], timeline: [] }); return; }

  const now = new Date();
  const canSee = await entityVisibility(user);

  const votes = (await db.select().from(votesTable).where(inArray(votesTable.boardId, accessibleBoardIds))).filter((v) => canSee("vote", v.id));
  const meetings = (await db.select().from(meetingsTable).where(inArray(meetingsTable.boardId, accessibleBoardIds))).filter((m) => canSee("meeting", m.id));
  const meetingIds = meetings.map((m) => m.id);
  const docs = (await db.select().from(documentsTable).where(inArray(documentsTable.boardId, accessibleBoardIds))).filter((d) => canSee("document", d.id));
  const tasks = (await db.select().from(tasksTable).where(inArray(tasksTable.boardId, accessibleBoardIds))).filter((t) => canSee("task", t.id));
  const mins = (meetingIds.length > 0
    ? await db.select().from(minutesTable).where(inArray(minutesTable.meetingId, meetingIds))
    : []
  ).filter((m) => canSee("minutes", m.id));

  const memberships = await db.select().from(boardMembershipsTable).where(inArray(boardMembershipsTable.boardId, accessibleBoardIds));
  const memberPersonIds = new Set(memberships.filter((m) => m.roleInBoard !== "observer").map((m) => m.personId));

  const boards = await db.select().from(boardsTable).where(inArray(boardsTable.id, accessibleBoardIds));
  const boardMap = new Map(boards.map((b) => [b.id, b.abbreviation || b.name]));

  const voteStats = {
    total: votes.length,
    open: votes.filter((v) => v.status === "open").length,
    approved: votes.filter((v) => v.status === "approved").length,
    rejected: votes.filter((v) => v.status === "rejected").length,
  };
  const meetingStats = {
    total: meetings.length,
    upcoming: meetings.filter((m) => m.date && m.date > now).length,
    past: meetings.filter((m) => m.date && m.date <= now).length,
  };
  const docStats = { total: docs.length };
  const overdueCount = tasks.filter((t) => t.status !== "done" && t.dueDate && new Date(t.dueDate) < now).length;
  const taskStats = {
    total: tasks.length,
    open: tasks.filter((t) => t.status !== "done").length,
    done: tasks.filter((t) => t.status === "done").length,
    overdue: overdueCount,
  };
  const minutesStats = {
    total: mins.length,
    signed: mins.filter((m) => m.status === "signed").length,
    review: mins.filter((m) => m.status === "review").length,
    draft: mins.filter((m) => m.status === "draft").length,
  };
  const peopleStats = { boardMembers: memberPersonIds.size };

  const projectKeywords: [string, string, string[]][] = [
    ["Project Zephyr", "Kazakhstan 1GW Wind", ["zephyr", "kazakhstan", "wind"]],
    ["Project Aurora", "SolarTech Acquisition", ["aurora", "solartech", "solar tech"]],
    ["ESG & Compliance", "Project Lighthouse", ["esg", "lighthouse", "whistleblower", "emissions", "carbon credit"]],
  ];

  function matchesProject(title: string, keywords: string[]): boolean {
    const lower = title.toLowerCase();
    return keywords.some((k) => lower.includes(k));
  }

  const projects = projectKeywords.map(([name, subtitle, keywords]) => {
    const pVotes = votes.filter((v) => matchesProject(v.title, keywords));
    const pMeetings = meetings.filter((m) => matchesProject(m.title, keywords));
    const pDocs = docs.filter((d) => matchesProject(d.title || d.filename, keywords));
    const pTasks = tasks.filter((t) => matchesProject(t.title, keywords));

    const latestVote = pVotes.sort((a, b) => {
      const da = a.closedAt || a.createdAt || new Date(0);
      const db2 = b.closedAt || b.createdAt || new Date(0);
      return new Date(db2).getTime() - new Date(da).getTime();
    })[0];

    const openTasks = pTasks.filter((t) => t.status !== "done").length;
    const doneTasks = pTasks.filter((t) => t.status === "done").length;
    const overdueTasks = pTasks.filter((t) => t.status !== "done" && t.dueDate && new Date(t.dueDate) < now).length;

    let status = "In Progress";
    let statusIcon = "yellow";
    if (keywords.includes("zephyr")) {
      status = "Under Investigation";
      statusIcon = "warning";
    } else if (keywords.includes("esg")) {
      status = "Remediation Underway";
      statusIcon = "wrench";
    }

    return {
      name,
      subtitle,
      status,
      statusIcon,
      searchTerm: keywords[0],
      votes: { total: pVotes.length, approved: pVotes.filter((v) => v.status === "approved").length },
      meetings: pMeetings.length,
      documents: pDocs.length,
      tasks: { total: pTasks.length, open: openTasks, done: doneTasks, overdue: overdueTasks },
      latest: latestVote ? { title: latestVote.title, date: latestVote.closedAt?.toISOString() || latestVote.createdAt?.toISOString() || null } : null,
    };
  });

  const timeline = votes
    .map((v) => ({
      id: v.id,
      title: v.title,
      status: v.status,
      date: v.closedAt?.toISOString() || v.createdAt?.toISOString() || null,
      board: boardMap.get(v.boardId || "") || "",
      resolutionNumber: v.resolutionNumber,
    }))
    .sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());

  res.json({
    votes: voteStats,
    meetings: meetingStats,
    documents: docStats,
    tasks: taskStats,
    minutes: minutesStats,
    people: peopleStats,
    projects,
    timeline,
  });
});

// ── SEARCH ──
router.get("/graph/search", requireAuth, async (req, res): Promise<void> => {
  const q = (req.query.q as string || "").trim();
  const filterBoardId = req.query.boardId as string | undefined;
  const user = req.user!;

  if (!q) { res.json({ nodes: [], edges: [], matches: [], summary: "Enter a search term" }); return; }

  let accessibleBoardIds: string[];
  if (user.role === "admin") {
    const allBoards = await db.select({ id: boardsTable.id }).from(boardsTable);
    accessibleBoardIds = allBoards.map((b) => b.id);
  } else {
    const memberships = await db.select({ boardId: boardMembershipsTable.boardId }).from(boardMembershipsTable).where(eq(boardMembershipsTable.personId, user.id));
    accessibleBoardIds = memberships.map((m) => m.boardId).filter(Boolean) as string[];
  }
  if (filterBoardId) {
    if (!accessibleBoardIds.includes(filterBoardId)) { res.status(403).json({ error: "Access denied" }); return; }
    accessibleBoardIds = [filterBoardId];
  }
  if (accessibleBoardIds.length === 0) { res.json({ nodes: [], edges: [], matches: [], summary: "No accessible boards" }); return; }

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>();
  const matchIds = new Set<string>();

  const addNode = (node: GraphNode, isMatch = false) => {
    if (!nodeIds.has(node.id)) {
      nodeIds.add(node.id);
      nodes.push(node);
    }
    if (isMatch) matchIds.add(node.id);
  };

  const lower = q.toLowerCase();
  const isSpecial = (kw: string) => lower === kw || lower.includes(kw);
  const now = new Date();

  const canSee = await entityVisibility(user);

  const allVotes = (await db.select().from(votesTable).where(inArray(votesTable.boardId, accessibleBoardIds))).filter((v) => canSee("vote", v.id));
  const allMeetings = (await db.select().from(meetingsTable).where(inArray(meetingsTable.boardId, accessibleBoardIds))).filter((m) => canSee("meeting", m.id));
  const allDocs = (await db.select().from(documentsTable).where(inArray(documentsTable.boardId, accessibleBoardIds))).filter((d) => canSee("document", d.id));
  const allTasks = (await db.select().from(tasksTable).where(inArray(tasksTable.boardId, accessibleBoardIds))).filter((t) => canSee("task", t.id));
  const boardMemberships = await db.select().from(boardMembershipsTable).where(inArray(boardMembershipsTable.boardId, accessibleBoardIds));
  const accessiblePersonIds = [...new Set(boardMemberships.map((m) => m.personId).filter(Boolean) as string[])];
  const allPeople = accessiblePersonIds.length > 0
    ? await db.select().from(peopleTable).where(inArray(peopleTable.id, accessiblePersonIds))
    : [];
  const meetingIds = allMeetings.map((m) => m.id);
  const allMinutes = (meetingIds.length > 0
    ? await db.select().from(minutesTable).where(inArray(minutesTable.meetingId, meetingIds))
    : []
  ).filter((m) => canSee("minutes", m.id));
  const boards = await db.select().from(boardsTable).where(inArray(boardsTable.id, accessibleBoardIds));
  const boardMap = new Map(boards.map((b) => [b.id, b]));

  const boardAbbrs = boards.map((b) => b.abbreviation?.toLowerCase() || "");
  const matchingBoardId = boards.find((b) => (b.abbreviation || "").toLowerCase() === lower)?.id;

  let matchedVotes: typeof allVotes = [];
  let matchedMeetings: typeof allMeetings = [];
  let matchedDocs: typeof allDocs = [];
  let matchedTasks: typeof allTasks = [];
  let matchedPeople: typeof allPeople = [];
  let matchedMinutes: typeof allMinutes = [];

  if (isSpecial("open") || isSpecial("pending")) {
    matchedVotes = allVotes.filter((v) => v.status === "open");
  } else if (isSpecial("overdue") || isSpecial("late")) {
    matchedTasks = allTasks.filter((t) => t.status !== "done" && t.dueDate && new Date(t.dueDate) < now);
  } else if (isSpecial("approved")) {
    matchedVotes = allVotes.filter((v) => v.status === "approved");
  } else if (isSpecial("rejected")) {
    matchedVotes = allVotes.filter((v) => v.status === "rejected");
  } else if (isSpecial("recent decisions") || isSpecial("recent")) {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    matchedVotes = allVotes.filter((v) => v.closedAt && new Date(v.closedAt) > thirtyDaysAgo);
  } else if (matchingBoardId) {
    matchedVotes = allVotes.filter((v) => v.boardId === matchingBoardId);
    matchedMeetings = allMeetings.filter((m) => m.boardId === matchingBoardId);
    matchedDocs = allDocs.filter((d) => d.boardId === matchingBoardId);
    matchedTasks = allTasks.filter((t) => t.boardId === matchingBoardId);
  } else {
    const terms = lower.split(/\s+/).filter(Boolean);
    const match = (text: string) => terms.some((t) => text.toLowerCase().includes(t));
    matchedVotes = allVotes.filter((v) => match(v.title));
    matchedMeetings = allMeetings.filter((m) => match(m.title));
    matchedDocs = allDocs.filter((d) => match(d.title || "") || match(d.filename));
    matchedTasks = allTasks.filter((t) => match(t.title));
    matchedPeople = allPeople.filter((p) => match(p.name) || match(p.email));
    matchedMinutes = allMinutes.filter((m) => {
      const meeting = allMeetings.find((mt) => mt.id === m.meetingId);
      return meeting && match(meeting.title);
    });
  }

  for (const v of matchedVotes) {
    addNode({ id: v.id, type: "vote", label: v.title, status: v.status, date: v.closedAt?.toISOString() || v.createdAt?.toISOString() || null, boardId: v.boardId }, true);
  }
  for (const m of matchedMeetings) {
    addNode({ id: m.id, type: "meeting", label: m.title, status: m.status, date: m.date?.toISOString() || null, boardId: m.boardId }, true);
  }
  for (const d of matchedDocs) {
    addNode({ id: d.id, type: "document", label: d.title || d.filename, boardId: d.boardId }, true);
  }
  for (const t of matchedTasks) {
    addNode({ id: t.id, type: "task", label: t.title, status: t.status, date: t.dueDate || null, boardId: t.boardId }, true);
  }
  for (const p of matchedPeople) {
    addNode({ id: p.id, type: "person", label: p.name, role: p.role }, true);
  }
  for (const m of matchedMinutes) {
    const meeting = allMeetings.find((mt) => mt.id === m.meetingId);
    addNode({ id: m.id, type: "minutes", label: `Minutes — ${meeting?.title || ""}`, status: m.status, date: m.createdAt?.toISOString() || null }, true);
  }

  // 1-hop expansion
  const voteIds = [...matchIds].filter((id) => allVotes.some((v) => v.id === id));
  const meetingMatchIds = [...matchIds].filter((id) => allMeetings.some((m) => m.id === id));
  const docMatchIds = [...matchIds].filter((id) => allDocs.some((d) => d.id === id));
  const taskMatchIds = [...matchIds].filter((id) => allTasks.some((t) => t.id === id));
  const personMatchIds = [...matchIds].filter((id) => allPeople.some((p) => p.id === id));

  // Expand votes → meeting, documents, voters
  for (const vid of voteIds) {
    const vote = allVotes.find((v) => v.id === vid)!;
    if (vote.meetingId) {
      const m = allMeetings.find((mt) => mt.id === vote.meetingId);
      if (m) {
        addNode({ id: m.id, type: "meeting", label: m.title, status: m.status, date: m.date?.toISOString() || null, boardId: m.boardId });
        edges.push({ source: m.id, target: vid, relationship: "discussed" });
      }
    }
    if (vote.boardId) {
      const b = boardMap.get(vote.boardId);
      if (b) {
        addNode({ id: b.id, type: "board", label: b.abbreviation || b.name });
        edges.push({ source: b.id, target: vid, relationship: "contains" });
      }
    }
  }

  if (voteIds.length > 0) {
    const voteRecords = await db.select().from(voteRecordsTable).where(inArray(voteRecordsTable.voteId, voteIds));
    const secretVoteIds = new Set(allVotes.filter((v) => v.secret).map((v) => v.id));
    for (const vr of voteRecords) {
      if (vr.personId) {
        const person = allPeople.find((p) => p.id === vr.personId);
        if (person) {
          addNode({ id: person.id, type: "person", label: person.name, role: person.role });
          const isSecret = secretVoteIds.has(vr.voteId!);
          edges.push({ source: vr.voteId!, target: person.id, relationship: (!isSecret || user.role === "admin") ? `voted (${vr.decision})` : "voted" });
        }
      }
    }

    const voteDocs = await db.select().from(voteDocumentsTable).where(inArray(voteDocumentsTable.voteId, voteIds));
    for (const vd of voteDocs) {
      addNode({ id: vd.id, type: "document", label: vd.title || vd.filename, boardId: null });
      edges.push({ source: vd.voteId, target: vd.id, relationship: "supporting document" });
    }
  }

  // Expand meetings → votes, documents, minutes, tasks
  for (const mid of meetingMatchIds) {
    const meeting = allMeetings.find((m) => m.id === mid)!;
    if (meeting.boardId) {
      const b = boardMap.get(meeting.boardId);
      if (b) {
        addNode({ id: b.id, type: "board", label: b.abbreviation || b.name });
        edges.push({ source: b.id, target: mid, relationship: "contains" });
      }
    }
    for (const v of allVotes.filter((v) => v.meetingId === mid)) {
      addNode({ id: v.id, type: "vote", label: v.title, status: v.status, date: v.closedAt?.toISOString() || v.createdAt?.toISOString() || null, boardId: v.boardId });
      edges.push({ source: mid, target: v.id, relationship: "discussed" });
    }
    for (const t of allTasks.filter((t) => t.sourceMeetingId === mid)) {
      addNode({ id: t.id, type: "task", label: t.title, status: t.status, date: t.dueDate || null, boardId: t.boardId });
      edges.push({ source: mid, target: t.id, relationship: "created task" });
    }
    for (const m of allMinutes.filter((m) => m.meetingId === mid)) {
      addNode({ id: m.id, type: "minutes", label: `Minutes`, status: m.status, date: m.createdAt?.toISOString() || null });
      edges.push({ source: mid, target: m.id, relationship: "produced" });
    }
  }

  // Expand tasks → meeting, assignee
  for (const tid of taskMatchIds) {
    const task = allTasks.find((t) => t.id === tid)!;
    if (task.sourceMeetingId) {
      const m = allMeetings.find((mt) => mt.id === task.sourceMeetingId);
      if (m) {
        addNode({ id: m.id, type: "meeting", label: m.title, status: m.status, date: m.date?.toISOString() || null, boardId: m.boardId });
        edges.push({ source: m.id, target: tid, relationship: "created task" });
      }
    }
    if (task.assigneeId) {
      const person = allPeople.find((p) => p.id === task.assigneeId);
      if (person) {
        addNode({ id: person.id, type: "person", label: person.name, role: person.role });
        edges.push({ source: tid, target: person.id, relationship: "assigned to" });
      }
    }
  }

  const secretVoteIdSet = new Set(allVotes.filter((v) => v.secret).map((v) => v.id));
  const isAdmin = user.role === "admin";

  // Expand people → votes, tasks
  for (const pid of personMatchIds) {
    const personVoteRecords = await db.select().from(voteRecordsTable).where(eq(voteRecordsTable.personId, pid));
    for (const vr of personVoteRecords) {
      const vote = allVotes.find((v) => v.id === vr.voteId);
      if (vote) {
        addNode({ id: vote.id, type: "vote", label: vote.title, status: vote.status, date: vote.closedAt?.toISOString() || vote.createdAt?.toISOString() || null, boardId: vote.boardId });
        const isSecret = secretVoteIdSet.has(vote.id);
        edges.push({ source: vote.id, target: pid, relationship: (!isSecret || isAdmin) ? `voted (${vr.decision})` : "voted" });
      }
    }
    for (const t of allTasks.filter((t) => t.assigneeId === pid)) {
      addNode({ id: t.id, type: "task", label: t.title, status: t.status, date: t.dueDate || null, boardId: t.boardId });
      edges.push({ source: t.id, target: pid, relationship: "assigned to" });
    }
  }

  // Expand documents → meetings and votes via agenda_documents and vote_documents
  if (docMatchIds.length > 0) {
    const agendaItems = meetingIds.length > 0
      ? await db.select().from(agendaItemsTable).where(inArray(agendaItemsTable.meetingId, meetingIds))
      : [];
    const agendaItemIds = agendaItems.map((a) => a.id);
    if (agendaItemIds.length > 0) {
      const agendaDocs = await db.select().from(agendaDocumentsTable).where(inArray(agendaDocumentsTable.agendaItemId, agendaItemIds));
      const aiToMeeting = new Map(agendaItems.map((a) => [a.id, a.meetingId]));
      for (const ad of agendaDocs) {
        if (ad.documentId && docMatchIds.includes(ad.documentId) && ad.agendaItemId) {
          const mId = aiToMeeting.get(ad.agendaItemId);
          if (mId) {
            const m = allMeetings.find((mt) => mt.id === mId);
            if (m) {
              addNode({ id: m.id, type: "meeting", label: m.title, status: m.status, date: m.date?.toISOString() || null, boardId: m.boardId });
              edges.push({ source: m.id, target: ad.documentId, relationship: "agenda document" });
            }
          }
        }
      }
    }
  }

  // Deduplicate edges
  const dedupedEdges: GraphEdge[] = [];
  const edgeSet = new Set<string>();
  for (const e of edges) {
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    const key = `${e.source}|${e.target}|${e.relationship}`;
    if (!edgeSet.has(key)) { edgeSet.add(key); dedupedEdges.push(e); }
  }

  const matches = nodes.filter((n) => matchIds.has(n.id)).map((n) => ({
    id: n.id,
    type: n.type,
    label: n.label,
    status: n.status,
    date: n.date,
    boardId: n.boardId,
  }));

  res.json({
    nodes,
    edges: dedupedEdges,
    matches,
    summary: `Found ${matchIds.size} entities matching "${q}"`,
  });
});

export default router;
