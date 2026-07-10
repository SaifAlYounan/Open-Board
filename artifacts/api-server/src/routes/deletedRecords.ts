import { Router } from "express";
import { db, deletedRecordsTable, peopleTable } from "@workspace/db";
import { desc, eq, sql } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import { uuidParam } from "../lib/validateUuid";
import { writeLimiter } from "../lib/rateLimiters";
import {
  restoreDeletedRecord,
  RestoreConflictError,
  isRestorableEntityType,
  snapshotTitle,
} from "../lib/restore";
import { logger } from "../lib/logger";

const router = Router();

/**
 * GET /deleted-records — the recycle bin (admin only).
 *
 * A paginated view of the retention log: every snapshotted governance record,
 * newest deletion first, with who deleted it, who (if anyone) restored it, and
 * whether it is still restorable. The heavy `snapshot` blob is NOT returned in
 * the list — only a short title — so the bin stays cheap to page through.
 */
router.get("/deleted-records", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(deletedRecordsTable);

  const rows = await db
    .select()
    .from(deletedRecordsTable)
    .orderBy(desc(deletedRecordsTable.deletedAt))
    .limit(limit)
    .offset(offset);

  const items = await Promise.all(
    rows.map(async (row) => {
      const deleter = row.deletedBy
        ? (await db
            .select({ id: peopleTable.id, name: peopleTable.name })
            .from(peopleTable)
            .where(eq(peopleTable.id, row.deletedBy)))[0] ?? null
        : null;
      const restorer = row.restoredBy
        ? (await db
            .select({ id: peopleTable.id, name: peopleTable.name })
            .from(peopleTable)
            .where(eq(peopleTable.id, row.restoredBy)))[0] ?? null
        : null;
      return {
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        title: snapshotTitle(row.entityType, row.snapshot),
        deletedAt: row.deletedAt,
        deletedBy: deleter,
        restoredAt: row.restoredAt,
        restoredBy: restorer,
        // Still restorable when it hasn't been restored and its type is one we
        // know how to restore. Live-conflict / missing-parent are only known for
        // certain at restore time (they 409 there) — kept off the list to keep
        // paging cheap.
        restorable: !row.restoredAt && isRestorableEntityType(row.entityType),
      };
    }),
  );

  res.json({ items, total: Number(total), limit, offset });
});

/**
 * POST /deleted-records/:id/restore — re-insert a snapshot into its source
 * table (admin only). Never hard-deletes the audit trail of the deletion:
 * on success the row is stamped restoredAt/restoredBy.
 *
 * 404 — no such deleted-records row.
 * 409 — already restored · a live record holds the id/unique key · the parent
 *       board is gone. (Message is surfaced verbatim.)
 */
router.post(
  "/deleted-records/:id/restore",
  requireAuth,
  requireAdmin,
  writeLimiter,
  uuidParam("id"),
  async (req, res): Promise<void> => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const [record] = await db
      .select()
      .from(deletedRecordsTable)
      .where(eq(deletedRecordsTable.id, id));
    if (!record) {
      res.status(404).json({ error: "Deleted record not found" });
      return;
    }

    try {
      await restoreDeletedRecord(req, record);
    } catch (err) {
      if (err instanceof RestoreConflictError) {
        res.status(409).json({ error: err.message });
        return;
      }
      logger.error({ err, deletedRecordId: id }, "RESTORE FAILED");
      res.status(500).json({ error: "Failed to restore record" });
      return;
    }

    // Stamp the deletion row as restored — the deletion stays on the trail.
    await db
      .update(deletedRecordsTable)
      .set({ restoredAt: new Date(), restoredBy: req.user?.id ?? null })
      .where(eq(deletedRecordsTable.id, id));

    res.json({
      success: true,
      entityType: record.entityType,
      entityId: record.entityId,
    });
  },
);

export default router;
