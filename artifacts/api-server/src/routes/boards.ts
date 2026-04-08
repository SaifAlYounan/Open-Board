import { Router } from "express";
import { db, boardsTable, boardMembershipsTable, peopleTable, organizationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
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

router.post("/boards/:id/members", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const boardId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { personId, roleInBoard } = req.body;
  if (!personId) {
    res.status(400).json({ error: "personId required" });
    return;
  }

  await db
    .insert(boardMembershipsTable)
    .values({ boardId, personId, roleInBoard: roleInBoard || "member" })
    .onConflictDoNothing();

  res.status(201).json({ ok: true });
});

router.patch("/boards/:id/members/:personId", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const boardId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const personId = Array.isArray(req.params.personId) ? req.params.personId[0] : req.params.personId;
  const { roleInBoard } = req.body;
  if (!roleInBoard) {
    res.status(400).json({ error: "roleInBoard required" });
    return;
  }
  await db
    .update(boardMembershipsTable)
    .set({ roleInBoard })
    .where(
      and(
        eq(boardMembershipsTable.boardId, boardId),
        eq(boardMembershipsTable.personId, personId)
      )
    );
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
  res.sendStatus(204);
});

export default router;
