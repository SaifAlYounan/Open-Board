import { Router } from "express";
import { db, legalHoldsTable, peopleTable } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { auditInTx } from "../lib/auditLog";
import { writeLimiter } from "../lib/rateLimiters";

const router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOLDABLE = new Set(["board", "meeting", "document", "vote", "task"]);

// List holds (active by default; ?all=true includes released ones).
router.get("/legal-holds", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(legalHoldsTable)
    .where(req.query.all === "true" ? undefined : isNull(legalHoldsTable.releasedAt))
    .orderBy(desc(legalHoldsTable.placedAt));
  res.json(rows);
});

// Place a hold (admin). Audited.
router.post("/legal-holds", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const { entityType, entityId, reason } = req.body ?? {};
  if (!HOLDABLE.has(entityType)) {
    res.status(400).json({ error: `entityType must be one of ${[...HOLDABLE].join(", ")}` });
    return;
  }
  if (typeof entityId !== "string" || !UUID_REGEX.test(entityId)) {
    res.status(400).json({ error: "entityId must be a UUID" });
    return;
  }
  if (typeof reason !== "string" || reason.trim().length === 0) {
    res.status(400).json({ error: "reason is required" });
    return;
  }
  // Fail-closed (P0.6): the hold and its audit entry commit together.
  const [hold] = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(legalHoldsTable)
      .values({ entityType, entityId, reason: reason.trim(), placedBy: req.user!.id })
      .returning();
    await auditInTx(tx, req, "legal_hold_placed", entityType, entityId, { holdId: rows[0].id, reason: reason.trim() });
    return rows;
  });
  res.status(201).json(hold);
});

// Release a hold (admin). Audited. Idempotent-ish: releasing an already-released
// hold is a 409.
router.post("/legal-holds/:id/release", requireAuth, requireAdmin, writeLimiter, async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!UUID_REGEX.test(id)) {
    res.status(400).json({ error: "Invalid hold id" });
    return;
  }
  const [hold] = await db.select().from(legalHoldsTable).where(eq(legalHoldsTable.id, id));
  if (!hold) {
    res.status(404).json({ error: "Hold not found" });
    return;
  }
  if (hold.releasedAt) {
    res.status(409).json({ error: "Hold already released" });
    return;
  }
  // Fail-closed (P0.6): the release and its audit entry commit together.
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(legalHoldsTable)
      .set({ releasedAt: new Date(), releasedBy: req.user!.id })
      .where(and(eq(legalHoldsTable.id, id), isNull(legalHoldsTable.releasedAt)))
      .returning();
    await auditInTx(tx, req, "legal_hold_released", hold.entityType, hold.entityId, { holdId: id });
    return rows;
  });
  res.json(updated);
});

export default router;
