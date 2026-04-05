import { db, accessControlTable, boardMembershipsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

/**
 * Grant default access to an entity for all relevant people.
 * Called whenever a new entity is created (meeting, vote, minutes, task, document).
 */
export async function grantDefaultAccess(
  entityType: string,
  entityId: string,
  boardId: string | null | undefined,
  additionalPersonIds: string[] = []
): Promise<void> {
  const personIds = new Set<string>(additionalPersonIds);

  if (boardId) {
    // Get all board members and observers
    const members = await db
      .select()
      .from(boardMembershipsTable)
      .where(eq(boardMembershipsTable.boardId, boardId));

    for (const m of members) {
      if (m.personId) personIds.add(m.personId);
    }
  }

  for (const personId of personIds) {
    await db
      .insert(accessControlTable)
      .values({ entityType, entityId, personId, hasAccess: true })
      .onConflictDoNothing();
  }
}

/**
 * Check if a person has access to an entity.
 * Admins always have access.
 */
export async function hasAccess(
  personId: string,
  role: string,
  entityType: string,
  entityId: string
): Promise<boolean> {
  if (role === "admin") return true;

  const [row] = await db
    .select()
    .from(accessControlTable)
    .where(
      and(
        eq(accessControlTable.entityType, entityType),
        eq(accessControlTable.entityId, entityId),
        eq(accessControlTable.personId, personId),
        eq(accessControlTable.hasAccess, true)
      )
    );

  return !!row;
}
