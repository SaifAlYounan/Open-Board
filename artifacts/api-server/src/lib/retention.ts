import { db, deletedRecordsTable } from "@workspace/db";
import type { Request } from "express";
import { logger } from "./logger";

/**
 * Snapshot a governance record into the retention log before it is hard-deleted.
 * Await this before the delete so the record is preserved even if the delete
 * partially fails. Never throws — retention must not block a delete the user is
 * entitled to perform (failures are logged loudly).
 */
export async function retainDeleted(
  req: Request,
  entityType: string,
  entityId: string,
  snapshot: unknown
): Promise<void> {
  try {
    await db.insert(deletedRecordsTable).values({
      entityType,
      entityId,
      snapshot: (snapshot ?? {}) as object,
      deletedBy: req.user?.id ?? null,
    });
  } catch (err) {
    logger.error({ err, entityType, entityId }, "RETENTION SNAPSHOT FAILED — record deleted without a snapshot");
  }
}
