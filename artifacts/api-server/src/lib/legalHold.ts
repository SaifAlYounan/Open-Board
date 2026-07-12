import { db, legalHoldsTable } from "@workspace/db";
import { and, eq, isNull, or } from "drizzle-orm";
import type { DbClient } from "./numbering";

/**
 * P0.9 — is this entity under an active legal hold? True when an unreleased hold
 * targets the entity itself OR its board (a board-level hold cascades to every
 * meeting/document/vote/task on that board). Deletion routes call this and refuse
 * with 409 when it returns true.
 */
export async function isUnderHold(
  entityType: string,
  entityId: string,
  boardId?: string | null,
  dbc: DbClient = db
): Promise<boolean> {
  const targets = [
    and(eq(legalHoldsTable.entityType, entityType), eq(legalHoldsTable.entityId, entityId)),
  ];
  if (boardId) {
    targets.push(and(eq(legalHoldsTable.entityType, "board"), eq(legalHoldsTable.entityId, boardId)));
  }
  const [row] = await dbc
    .select({ id: legalHoldsTable.id })
    .from(legalHoldsTable)
    .where(and(isNull(legalHoldsTable.releasedAt), or(...targets)))
    .limit(1);
  return !!row;
}
