import { Router } from "express";
import { db, accessEventsTable, peopleTable } from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { whoCouldAccess } from "../lib/access";

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The raw access-events log for one entity (admin), oldest first.
router.get("/access-events", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { entityType, entityId } = req.query;
  if (typeof entityType !== "string" || typeof entityId !== "string" || !UUID_REGEX.test(entityId)) {
    res.status(400).json({ error: "entityType and a UUID entityId are required" });
    return;
  }
  const rows = await db
    .select()
    .from(accessEventsTable)
    .where(and(eq(accessEventsTable.entityType, entityType), eq(accessEventsTable.entityId, entityId)))
    .orderBy(asc(accessEventsTable.at));
  res.json(rows);
});

// Point-in-time reconstruction: who could access this entity as of ?asOf (admin).
router.get("/access-events/reconstruct", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { entityType, entityId, asOf } = req.query;
  if (typeof entityType !== "string" || typeof entityId !== "string" || !UUID_REGEX.test(entityId)) {
    res.status(400).json({ error: "entityType and a UUID entityId are required" });
    return;
  }
  const at = typeof asOf === "string" ? new Date(asOf) : new Date();
  if (isNaN(at.getTime())) {
    res.status(400).json({ error: "asOf must be an ISO date" });
    return;
  }
  const personIds = await whoCouldAccess(entityType, entityId, at);
  const people = personIds.length
    ? await db.select({ id: peopleTable.id, name: peopleTable.name, email: peopleTable.email }).from(peopleTable).where(inArray(peopleTable.id, personIds))
    : [];
  res.json({ entityType, entityId, asOf: at.toISOString(), count: people.length, people });
});

export default router;
