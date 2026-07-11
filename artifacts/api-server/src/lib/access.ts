import {
  db,
  accessControlTable,
  accessEventsTable,
  boardMembershipsTable,
  documentsTable,
  votesTable,
  meetingsTable,
  minutesTable,
  tasksTable,
} from "@workspace/db";
import { eq, and, lte, asc } from "drizzle-orm";
import type { DbClient } from "./numbering";

/**
 * ONE access-control model (P0.7). A person may access an entity iff, in order:
 *   1. they are an admin                                         -> allow
 *   2. an explicit DENY row (has_access = false) exists          -> deny  (recusal wins)
 *   3. an unexpired explicit GRANT row (has_access = true) exists-> allow
 *   4. they are a current member of the entity's board           -> allow
 *   5. otherwise                                                 -> deny
 *
 * Deny takes precedence over every grant and over board membership, so a
 * conflict-of-interest recusal is a single `has_access = false` row. Board
 * membership is evaluated live, so a director appointed after a document was
 * uploaded sees it, and a director removed from the board loses access — neither
 * depends on a snapshot taken at creation time.
 *
 * `access_control` holds only EXCEPTIONS for every entity type: deny rows
 * (recusal) and explicit grants to people who are not board members (e.g. a task
 * assignee, or the uploader of a board-less document). A board member sees board
 * material via live membership, with no row at all. All read paths — detail
 * (`hasAccess`) and lists (`accessibleEntityIds`) — use this one resolver, so
 * deny-precedence, grant expiry, and live membership apply uniformly.
 */

/** Resolve the board an entity belongs to (null when board-less). */
async function boardIdForEntity(
  entityType: string,
  entityId: string,
  dbc: DbClient
): Promise<string | null> {
  switch (entityType) {
    case "document": {
      const [r] = await dbc.select({ b: documentsTable.boardId }).from(documentsTable).where(eq(documentsTable.id, entityId));
      return r?.b ?? null;
    }
    case "vote": {
      const [r] = await dbc.select({ b: votesTable.boardId }).from(votesTable).where(eq(votesTable.id, entityId));
      return r?.b ?? null;
    }
    case "meeting": {
      const [r] = await dbc.select({ b: meetingsTable.boardId }).from(meetingsTable).where(eq(meetingsTable.id, entityId));
      return r?.b ?? null;
    }
    case "task": {
      const [r] = await dbc.select({ b: tasksTable.boardId }).from(tasksTable).where(eq(tasksTable.id, entityId));
      return r?.b ?? null;
    }
    case "minutes": {
      const [m] = await dbc.select({ meetingId: minutesTable.meetingId }).from(minutesTable).where(eq(minutesTable.id, entityId));
      if (!m?.meetingId) return null;
      const [mt] = await dbc.select({ b: meetingsTable.boardId }).from(meetingsTable).where(eq(meetingsTable.id, m.meetingId));
      return mt?.b ?? null;
    }
    default:
      return null;
  }
}

export async function isBoardMember(personId: string, boardId: string, dbc: DbClient = db): Promise<boolean> {
  const [m] = await dbc
    .select({ id: boardMembershipsTable.id })
    .from(boardMembershipsTable)
    .where(and(eq(boardMembershipsTable.boardId, boardId), eq(boardMembershipsTable.personId, personId)));
  return !!m;
}

/**
 * Grant explicit access rows. Under the exceptions model this is only needed for
 * people who are NOT board members (they would otherwise be covered by membership)
 * — e.g. the uploader of a board-less document, or an entity shared with an
 * external individual. Board members are intentionally NOT snapshotted here, so
 * that removing a member actually removes their access.
 *
 * `additionalPersonIds` are always granted as explicit rows (they may be people
 * who are NOT board members, e.g. a task assignee). `includeBoardMembers` now
 * defaults to FALSE: every read path resolves board members via LIVE membership
 * (`hasAccess` / `accessibleEntityIds`), so snapshotting members here would only
 * create grant rows that outlive their board membership — the deprovisioning
 * leak. No read path depends on those snapshots any more.
 */
export async function grantDefaultAccess(
  entityType: string,
  entityId: string,
  boardId: string | null | undefined,
  additionalPersonIds: string[] = [],
  dbc: DbClient = db,
  includeBoardMembers = false
): Promise<void> {
  const personIds = new Set<string>(additionalPersonIds);

  if (includeBoardMembers && boardId) {
    const members = await dbc.select().from(boardMembershipsTable).where(eq(boardMembershipsTable.boardId, boardId));
    for (const m of members) if (m.personId) personIds.add(m.personId);
  }

  for (const personId of personIds) {
    await dbc
      .insert(accessControlTable)
      .values({ entityType, entityId, personId, hasAccess: true })
      .onConflictDoNothing();
  }
}

/**
 * Set (upsert) an explicit access exception for one person on one entity.
 * `hasAccess=false` is a recusal (deny); `true` is an explicit grant. Unlike a
 * bare UPDATE, this works even when no prior row exists, so an admin can recuse a
 * board member who has never had an explicit row.
 */
export async function setAccess(
  entityType: string,
  entityId: string,
  personId: string,
  hasAccess: boolean,
  dbc: DbClient = db,
  actorId?: string
): Promise<void> {
  await dbc
    .insert(accessControlTable)
    .values({ entityType, entityId, personId, hasAccess })
    .onConflictDoUpdate({
      target: [accessControlTable.entityType, accessControlTable.entityId, accessControlTable.personId],
      set: { hasAccess, expiresAt: null },
    });
  await recordAccessEvent(entityType, entityId, personId, hasAccess ? "granted" : "denied", actorId, dbc);
}

/**
 * Append one immutable access event (P0.10). Never updates/deletes — the log is
 * the evidence for "who could see what, when".
 */
export async function recordAccessEvent(
  entityType: string,
  entityId: string,
  personId: string,
  event: "granted" | "denied" | "revoked" | "board_joined" | "board_left",
  actorId?: string,
  dbc: DbClient = db
): Promise<void> {
  await dbc.insert(accessEventsTable).values({ entityType, entityId, personId, event, actorId: actorId ?? null });
}

/**
 * The single per-entity access check. See the model comment above for the order.
 * Admins always pass.
 */
export async function hasAccess(
  personId: string,
  role: string,
  entityType: string,
  entityId: string,
  dbc: DbClient = db
): Promise<boolean> {
  if (role === "admin") return true;

  const rows = await dbc
    .select({ hasAccess: accessControlTable.hasAccess, expiresAt: accessControlTable.expiresAt })
    .from(accessControlTable)
    .where(
      and(
        eq(accessControlTable.entityType, entityType),
        eq(accessControlTable.entityId, entityId),
        eq(accessControlTable.personId, personId)
      )
    );

  // (2) explicit deny wins over everything.
  if (rows.some((r) => r.hasAccess === false)) return false;
  // (3) unexpired explicit grant.
  const now = new Date();
  if (rows.some((r) => r.hasAccess === true && (!r.expiresAt || r.expiresAt > now))) return true;
  // (4) live board membership.
  const boardId = await boardIdForEntity(entityType, entityId, dbc);
  if (boardId && (await isBoardMember(personId, boardId, dbc))) return true;
  // (5) default deny.
  return false;
}

/**
 * The set-based counterpart of `hasAccess` for list endpoints: every entity id of
 * `entityType` the non-admin `personId` may see. Same model — membership OR
 * unexpired grant, MINUS explicit deny. Callers already special-case admins (who
 * see everything) and should not call this for them.
 */
export async function accessibleEntityIds(
  personId: string,
  entityType: "document" | "vote" | "meeting" | "task" | "minutes",
  dbc: DbClient = db
): Promise<string[]> {
  const rows = await dbc
    .select({ id: accessControlTable.entityId, hasAccess: accessControlTable.hasAccess, expiresAt: accessControlTable.expiresAt })
    .from(accessControlTable)
    .where(and(eq(accessControlTable.entityType, entityType), eq(accessControlTable.personId, personId)));

  const denied = new Set<string>();
  const granted = new Set<string>();
  const now = new Date();
  for (const r of rows) {
    if (!r.id) continue;
    if (r.hasAccess === false) denied.add(r.id);
    else if (r.hasAccess === true && (!r.expiresAt || r.expiresAt > now)) granted.add(r.id);
  }

  // Entities of this type whose board the person is a current member of.
  const memberIds = await memberEntityIds(personId, entityType, dbc);

  const visible = new Set<string>();
  for (const id of memberIds) if (!denied.has(id)) visible.add(id);
  for (const id of granted) if (!denied.has(id)) visible.add(id);
  return [...visible];
}

/**
 * P0.10 — reconstruct the set of people who could access an entity AS OF a date,
 * by replaying the append-only access-events log. Effective access =
 * (board members as of D) ∪ (explicit grants as of D) − (explicit denies as of D).
 *
 * Honest limitation: the entity's board is resolved at its CURRENT value (a
 * document's board is rarely reassigned); and reconstruction is only as complete
 * as the event log — events before logging began (or a fresh install's seeded
 * memberships) must be backfilled for pre-logging history to appear.
 */
export async function whoCouldAccess(
  entityType: string,
  entityId: string,
  asOf: Date,
  dbc: DbClient = db
): Promise<string[]> {
  const boardId = entityType === "board" ? entityId : await boardIdForEntity(entityType, entityId, dbc);

  // Latest-state-per-person from an ordered event replay up to `asOf`.
  const reduce = async (etype: string, eid: string): Promise<Map<string, string>> => {
    const rows = await dbc
      .select({ personId: accessEventsTable.personId, event: accessEventsTable.event })
      .from(accessEventsTable)
      .where(and(eq(accessEventsTable.entityType, etype), eq(accessEventsTable.entityId, eid), lte(accessEventsTable.at, asOf)))
      .orderBy(asc(accessEventsTable.at));
    const state = new Map<string, string>();
    for (const r of rows) state.set(r.personId, r.event);
    return state;
  };

  const members = boardId ? await reduce("board", boardId) : new Map<string, string>();
  const explicit = await reduce(entityType, entityId);

  const effective = new Set<string>();
  for (const [pid, ev] of members) if (ev === "board_joined") effective.add(pid);
  for (const [pid, ev] of explicit) {
    if (ev === "granted") effective.add(pid);
    else if (ev === "denied" || ev === "revoked") effective.delete(pid);
  }
  return [...effective];
}

/** Ids of `entityType` whose board the person currently belongs to. */
async function memberEntityIds(
  personId: string,
  entityType: "document" | "vote" | "meeting" | "task" | "minutes",
  dbc: DbClient
): Promise<string[]> {
  switch (entityType) {
    case "document": {
      const rows = await dbc
        .select({ id: documentsTable.id })
        .from(documentsTable)
        .innerJoin(
          boardMembershipsTable,
          and(eq(boardMembershipsTable.boardId, documentsTable.boardId), eq(boardMembershipsTable.personId, personId))
        );
      return rows.map((r) => r.id).filter((v): v is string => v != null);
    }
    case "vote": {
      const rows = await dbc
        .select({ id: votesTable.id })
        .from(votesTable)
        .innerJoin(
          boardMembershipsTable,
          and(eq(boardMembershipsTable.boardId, votesTable.boardId), eq(boardMembershipsTable.personId, personId))
        );
      return rows.map((r) => r.id).filter((v): v is string => v != null);
    }
    case "meeting": {
      const rows = await dbc
        .select({ id: meetingsTable.id })
        .from(meetingsTable)
        .innerJoin(
          boardMembershipsTable,
          and(eq(boardMembershipsTable.boardId, meetingsTable.boardId), eq(boardMembershipsTable.personId, personId))
        );
      return rows.map((r) => r.id).filter((v): v is string => v != null);
    }
    case "task": {
      const rows = await dbc
        .select({ id: tasksTable.id })
        .from(tasksTable)
        .innerJoin(
          boardMembershipsTable,
          and(eq(boardMembershipsTable.boardId, tasksTable.boardId), eq(boardMembershipsTable.personId, personId))
        );
      return rows.map((r) => r.id).filter((v): v is string => v != null);
    }
    case "minutes": {
      const rows = await dbc
        .select({ id: minutesTable.id })
        .from(minutesTable)
        .innerJoin(meetingsTable, eq(meetingsTable.id, minutesTable.meetingId))
        .innerJoin(
          boardMembershipsTable,
          and(eq(boardMembershipsTable.boardId, meetingsTable.boardId), eq(boardMembershipsTable.personId, personId))
        );
      return rows.map((r) => r.id).filter((v): v is string => v != null);
    }
    default:
      return [];
  }
}
