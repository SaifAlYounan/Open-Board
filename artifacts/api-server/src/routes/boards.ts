import { Router } from "express";
import { db, boardsTable, boardMembershipsTable, peopleTable, organizationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { audit } from "../lib/auditLog";
import { sanitizeText } from "../lib/sanitize";
import { parsePagination } from "../lib/pagination";
import { sql } from "drizzle-orm";

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param("id", (_req, res, next, id) => {
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid id format" });
    return;
  }
  next();
});

router.get("/boards", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const { limit, offset } = parsePagination(req.query);

  let boardIds: string[] | null = null;

  if (user.role !== "admin") {
    // Get boards this user is a member of
    const memberships = await db
      .select()
      .from(boardMembershipsTable)
      .where(eq(boardMembershipsTable.personId, user.id));
    boardIds = memberships.map((m) => m.boardId).filter(Boolean) as string[];
  }

  const boards = await db.select().from(boardsTable);
  const filtered = boardIds !== null ? boards.filter((b) => boardIds!.includes(b.id)) : boards;
  const paginated = filtered.slice(offset, offset + limit);

  // Add member counts
  const result = await Promise.all(
    paginated.map(async (board) => {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(boardMembershipsTable)
        .where(eq(boardMembershipsTable.boardId, board.id));
      return { ...board, memberCount: Number(count) };
    })
  );

  res.json(result);
});

router.post("/boards", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { name, abbreviation, type } = req.body;
  if (!name || !type) {
    res.status(400).json({ error: "Required: name, type" });
    return;
  }

  // Get org id
  const [org] = await db.select().from(organizationsTable);
  const [board] = await db
    .insert(boardsTable)
    .values({ name: sanitizeText(name), abbreviation: abbreviation ? sanitizeText(abbreviation) : undefined, type, organizationId: org?.id })
    .returning();
  res.status(201).json({ ...board, memberCount: 0 });
});

router.get("/boards/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  const [board] = await db.select().from(boardsTable).where(eq(boardsTable.id, id));
  if (!board) {
    res.status(404).json({ error: "Board not found" });
    return;
  }

  if (user.role !== "admin") {
    const [membership] = await db
      .select()
      .from(boardMembershipsTable)
      .where(sql`${boardMembershipsTable.boardId} = ${id} AND ${boardMembershipsTable.personId} = ${user.id}`);
    if (!membership) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  const memberships = await db
    .select()
    .from(boardMembershipsTable)
    .where(eq(boardMembershipsTable.boardId, id));

  const members = await Promise.all(
    memberships.map(async (m) => {
      const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, m.personId!));
      const { passwordHash: _, ...safePerson } = person || { passwordHash: "" };
      return { ...m, person: safePerson };
    })
  );

  res.json({ ...board, members });
});

router.get("/boards/:id/members", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const user = req.user!;

  if (user.role !== "admin") {
    const [membership] = await db
      .select()
      .from(boardMembershipsTable)
      .where(sql`${boardMembershipsTable.boardId} = ${id} AND ${boardMembershipsTable.personId} = ${user.id}`);
    if (!membership) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
  }

  const memberships = await db
    .select()
    .from(boardMembershipsTable)
    .where(eq(boardMembershipsTable.boardId, id));

  const members = await Promise.all(
    memberships.map(async (m) => {
      const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, m.personId!));
      const { passwordHash: _, ...safePerson } = person || { passwordHash: "" };
      return { ...m, person: safePerson };
    })
  );

  res.json(members);
});

const VALID_BOARD_ROLES = ["chairperson", "vice_chairperson", "member", "secretary", "observer"];

// Voting weights are positive integers — exact, auditable arithmetic, and
// weight 1 everywhere reproduces classic one-member-one-vote behavior. The cap
// only guards against fat-fingered values.
const MAX_VOTING_WEIGHT = 1000;
function invalidWeight(votingWeight: unknown): string | null {
  if (typeof votingWeight !== "number" || !Number.isInteger(votingWeight) || votingWeight < 1 || votingWeight > MAX_VOTING_WEIGHT) {
    return `votingWeight must be an integer between 1 and ${MAX_VOTING_WEIGHT}`;
  }
  return null;
}

router.post("/boards/:id/members", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const boardId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { personId, roleInBoard, votingWeight } = req.body;
  if (!personId || typeof personId !== "string" || !/^[0-9a-f-]{36}$/i.test(personId)) {
    res.status(400).json({ error: "personId must be a valid UUID" });
    return;
  }
  if (roleInBoard != null && !VALID_BOARD_ROLES.includes(roleInBoard)) {
    res.status(400).json({ error: `Invalid roleInBoard. Must be one of: ${VALID_BOARD_ROLES.join(", ")}` });
    return;
  }
  if (votingWeight != null) {
    const weightError = invalidWeight(votingWeight);
    if (weightError) {
      res.status(400).json({ error: weightError });
      return;
    }
  }
  const [person] = await db.select({ id: peopleTable.id }).from(peopleTable).where(eq(peopleTable.id, personId));
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }

  await db
    .insert(boardMembershipsTable)
    .values({ boardId, personId, roleInBoard: roleInBoard || "member", votingWeight: votingWeight ?? 1 })
    .onConflictDoNothing();

  await audit(req, "board_member_added", "board", boardId, { personId, roleInBoard: roleInBoard || "member", votingWeight: votingWeight ?? 1 });
  res.status(201).json({ ok: true });
});

router.patch("/boards/:id/members/:personId", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const boardId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const personId = Array.isArray(req.params.personId) ? req.params.personId[0] : req.params.personId;
  const { roleInBoard, votingWeight } = req.body;
  if (roleInBoard == null && votingWeight == null) {
    res.status(400).json({ error: "roleInBoard or votingWeight required" });
    return;
  }
  if (roleInBoard != null && !VALID_BOARD_ROLES.includes(roleInBoard)) {
    res.status(400).json({ error: `Invalid roleInBoard. Must be one of: ${VALID_BOARD_ROLES.join(", ")}` });
    return;
  }
  if (votingWeight != null) {
    const weightError = invalidWeight(votingWeight);
    if (weightError) {
      res.status(400).json({ error: weightError });
      return;
    }
  }
  const updates: Record<string, unknown> = {};
  if (roleInBoard != null) updates.roleInBoard = roleInBoard;
  if (votingWeight != null) updates.votingWeight = votingWeight;
  await db
    .update(boardMembershipsTable)
    .set(updates)
    .where(
      and(
        eq(boardMembershipsTable.boardId, boardId),
        eq(boardMembershipsTable.personId, personId)
      )
    );
  // Note: already-cast ballots keep their snapshotted weight — a weight change
  // applies to future casts only, never to a ballot already on the record.
  await audit(req, "board_member_role_changed", "board", boardId, { personId, ...(roleInBoard != null ? { roleInBoard } : {}), ...(votingWeight != null ? { votingWeight } : {}) });
  res.json({ ok: true });
});

router.delete("/boards/:id/members/:personId", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const boardId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const personId = Array.isArray(req.params.personId) ? req.params.personId[0] : req.params.personId;
  await db
    .delete(boardMembershipsTable)
    .where(
      and(
        eq(boardMembershipsTable.boardId, boardId),
        eq(boardMembershipsTable.personId, personId)
      )
    );
  await audit(req, "board_member_removed", "board", boardId, { personId });
  res.sendStatus(204);
});

export default router;
