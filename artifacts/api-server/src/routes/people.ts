import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, peopleTable, boardMembershipsTable, boardsTable } from "@workspace/db";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { audit } from "../lib/auditLog";
import { pick } from "../lib/pick";
import { parsePagination } from "../lib/pagination";

const router = Router();

router.get("/people", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { limit, offset } = parsePagination(req.query);
  const people = await db.select().from(peopleTable).orderBy(peopleTable.name);
  const safe = people.map(({ passwordHash: _, ...p }) => p).slice(offset, offset + limit);
  res.json(safe);
});

const VALID_ROLES = ["admin", "member", "observer", "management"];
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

router.post("/people", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { email, password, name, role, title, avatarColor } = req.body;
  if (!email || !password || !name || !role) {
    res.status(400).json({ error: "Required: email, password, name, role" });
    return;
  }

  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email format" });
    return;
  }

  if (!VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` });
    return;
  }

  if (password.length < 12) {
    res.status(400).json({ error: "Password must be at least 12 characters" });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [person] = await db
      .insert(peopleTable)
      .values({ email, passwordHash, name, role, title, avatarColor })
      .returning();

    await audit(req, "person_created", "person", person.id, { email: person.email, role: person.role });
    const { passwordHash: _, ...safe } = person;
    res.status(201).json(safe);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("unique") || msg.includes("duplicate")) {
      res.status(409).json({ error: "A person with this email already exists" });
    } else {
      res.status(500).json({ error: "Failed to create person" });
    }
  }
});

router.get("/people/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const requester = req.user!;

  // Non-admins may only look up themselves or people they share a board with,
  // and only see directory fields — not email/role/account state.
  if (requester.role !== "admin" && id !== requester.id) {
    const myBoards = await db
      .select({ boardId: boardMembershipsTable.boardId })
      .from(boardMembershipsTable)
      .where(eq(boardMembershipsTable.personId, requester.id));
    const boardIds = myBoards.map((m) => m.boardId).filter((b): b is string => b != null);
    const shared = boardIds.length
      ? await db
          .select({ id: boardMembershipsTable.id })
          .from(boardMembershipsTable)
          .where(and(eq(boardMembershipsTable.personId, id), inArray(boardMembershipsTable.boardId, boardIds)))
      : [];
    if (shared.length === 0) {
      res.status(404).json({ error: "Person not found" });
      return;
    }
  }

  const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, id));
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  if (requester.role !== "admin" && id !== requester.id) {
    res.json({ id: person.id, name: person.name, title: person.title, avatarColor: person.avatarColor });
    return;
  }
  const { passwordHash: _, ...safe } = person;
  res.json(safe);
});

router.patch("/people/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { name, title, avatarColor, role, active } = pick(req.body, ["name", "title", "avatarColor", "role", "active"] as (keyof typeof req.body)[]) as { name?: string; title?: string; avatarColor?: string; role?: string; active?: boolean };
  if (role != null && !VALID_ROLES.includes(role)) {
    res.status(400).json({ error: `Invalid role. Must be one of: ${VALID_ROLES.join(", ")}` });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (title != null) updates.title = title;
  if (avatarColor != null) updates.avatarColor = avatarColor;
  if (role != null) updates.role = role;
  if (active != null) {
    updates.active = active;
    // Deactivation (or role-relevant reactivation) kills outstanding sessions immediately.
    if (active === false) updates.tokenVersion = sql`${peopleTable.tokenVersion} + 1`;
  }

  const [person] = await db.update(peopleTable).set(updates).where(eq(peopleTable.id, id)).returning();
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  await audit(req, "person_updated", "person", person.id, { changed: Object.keys(updates) });
  const { passwordHash: _, ...safe } = person;
  res.json(safe);
});

router.delete("/people/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  await db.delete(peopleTable).where(eq(peopleTable.id, id));
  await audit(req, "person_deleted", "person", id, {});
  res.sendStatus(204);
});

export default router;
