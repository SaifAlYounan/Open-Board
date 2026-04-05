import { Router } from "express";
import { db, boardsTable, boardMembershipsTable, peopleTable, organizationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { sql } from "drizzle-orm";

const router = Router();

router.get("/boards", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;

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

  // Add member counts
  const result = await Promise.all(
    filtered.map(async (board) => {
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
    .values({ name, abbreviation, type, organizationId: org?.id })
    .returning();
  res.status(201).json({ ...board, memberCount: 0 });
});

router.get("/boards/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [board] = await db.select().from(boardsTable).where(eq(boardsTable.id, id));
  if (!board) {
    res.status(404).json({ error: "Board not found" });
    return;
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

export default router;
