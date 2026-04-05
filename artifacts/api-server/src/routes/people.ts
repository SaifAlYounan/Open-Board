import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, peopleTable, boardMembershipsTable, boardsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";

const router = Router();

router.get("/people", requireAuth, requireAdmin, async (_req, res): Promise<void> => {
  const people = await db.select().from(peopleTable).orderBy(peopleTable.name);
  const safe = people.map(({ passwordHash: _, ...p }) => p);
  res.json(safe);
});

router.post("/people", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { email, password, name, role, title, avatarColor } = req.body;
  if (!email || !password || !name || !role) {
    res.status(400).json({ error: "Required: email, password, name, role" });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const [person] = await db
      .insert(peopleTable)
      .values({ email, passwordHash, name, role, title, avatarColor })
      .returning();

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
  const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, id));
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  const { passwordHash: _, ...safe } = person;
  res.json(safe);
});

router.patch("/people/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { name, title, avatarColor, role, active } = req.body;
  const updates: Record<string, unknown> = {};
  if (name != null) updates.name = name;
  if (title != null) updates.title = title;
  if (avatarColor != null) updates.avatarColor = avatarColor;
  if (role != null) updates.role = role;
  if (active != null) updates.active = active;

  const [person] = await db.update(peopleTable).set(updates).where(eq(peopleTable.id, id)).returning();
  if (!person) {
    res.status(404).json({ error: "Person not found" });
    return;
  }
  const { passwordHash: _, ...safe } = person;
  res.json(safe);
});

router.delete("/people/:id", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  await db.delete(peopleTable).where(eq(peopleTable.id, id));
  res.sendStatus(204);
});

export default router;
