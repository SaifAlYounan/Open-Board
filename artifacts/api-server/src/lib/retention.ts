import { db, deletedRecordsTable } from "@workspace/db";
import type { Request } from "express";
import type { DbClient } from "./numbering";
import { logger } from "./logger";

/**
 * Snapshot a governance record into the retention log before it is hard-deleted.
 * Fail-closed (P0.6): THROWS on failure — run it inside the delete's transaction
 * so a record can never be deleted without its retention snapshot. A delete that
 * cannot be evidenced is denied, not performed quietly.
 */
export async function retainDeleted(
  req: Request,
  entityType: string,
  entityId: string,
  snapshot: unknown,
  dbc: DbClient = db
): Promise<void> {
  try {
    await dbc.insert(deletedRecordsTable).values({
      entityType,
      entityId,
      snapshot: (snapshot ?? {}) as object,
      deletedBy: req.user?.id ?? null,
    });
  } catch (err) {
    logger.error({ err, entityType, entityId }, "RETENTION SNAPSHOT FAILED — rolling the delete back (fail-closed)");
    throw err;
  }
}
