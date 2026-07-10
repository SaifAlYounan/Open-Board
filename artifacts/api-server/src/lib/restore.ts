import {
  db,
  boardsTable,
  peopleTable,
  meetingsTable,
  minutesTable,
  votesTable,
  voteDocumentsTable,
  voteProxiesTable,
  tasksTable,
  documentsTable,
  deletedRecordsTable,
  type DeletedRecord,
} from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import type { Request } from "express";
import { grantDefaultAccess } from "./access";
import { audit } from "./auditLog";

/**
 * The governance ENTITY TYPES that snapshot on delete and can be restored.
 * These are the four top-level governance RECORDS whose DELETE handler writes a
 * `deleted_records` snapshot (see routes/{votes,meetings,tasks,documents}.ts):
 *
 *   - vote     → snapshot { vote, documents, proxies }
 *   - meeting  → snapshot = the meeting row
 *   - task     → snapshot = the task row
 *   - document → snapshot = the document row
 *
 * People, board memberships, agenda items, vote proxies/documents (as
 * standalone sub-resource deletes) are NOT restorable on their own: people are
 * a directory entity (not a governance record) with a wide dependent FK web,
 * and the sub-resources ride along inside their parent's snapshot. Cancelled /
 * closed votes and concluded meetings are LIFECYCLE states, not deletions, so
 * they never reach this table.
 */
export const RESTORABLE_ENTITY_TYPES = ["vote", "meeting", "task", "document"] as const;
export type RestorableEntityType = (typeof RESTORABLE_ENTITY_TYPES)[number];

export function isRestorableEntityType(t: string): t is RestorableEntityType {
  return (RESTORABLE_ENTITY_TYPES as readonly string[]).includes(t);
}

/**
 * A restore that can't proceed for a reason the admin should see verbatim
 * (already restored, a live record still holds the id/unique key, a parent that
 * no longer exists). Mapped to HTTP 409 by the route.
 */
export class RestoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RestoreConflictError";
  }
}

/** jsonb serializes timestamps to ISO strings; drizzle timestamp columns want Date. */
function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v : new Date(v as string);
}

async function rowExists(table: any, idColumn: any, id: string): Promise<boolean> {
  const [row] = await db.select({ id: idColumn }).from(table).where(eq(idColumn, id)).limit(1);
  return !!row;
}

/** A short human label for a snapshot, for the recycle-bin list. */
export function snapshotTitle(entityType: string, snapshot: any): string {
  if (!snapshot || typeof snapshot !== "object") return "(unknown)";
  switch (entityType) {
    case "vote":
      return snapshot.vote?.title ?? snapshot.vote?.resolutionNumber ?? "(untitled vote)";
    case "meeting":
      return snapshot.title ?? "(untitled meeting)";
    case "task":
      return snapshot.title ?? "(untitled task)";
    case "document":
      return snapshot.title ?? snapshot.filename ?? "(untitled document)";
    default:
      return "(unknown)";
  }
}

/**
 * Restore a snapshotted governance record back into its source table.
 *
 * Guarantees:
 *  - The deleted_records row must not already be restored (double-restore → conflict).
 *  - The original id is preserved (the row was hard-deleted, so nothing holds it —
 *    but we verify: a live record with that id, or with the same unique key
 *    (resolutionNumber / taskNumber), is a conflict rather than an overwrite).
 *  - Referential integrity: if the parent board is gone, we refuse (409) rather
 *    than orphan-insert. Nullable soft references (assignee, source meeting/minutes,
 *    uploader, proxy people) are re-pointed only if the target still exists;
 *    otherwise they are nulled so the record restores cleanly.
 *  - Default access is re-granted (delete removed the access-control rows), so the
 *    restored record is visible to its board again, not just to admins.
 *
 * Throws RestoreConflictError for the guarded cases. The whole re-insert runs in
 * one transaction; the caller stamps restoredAt/restoredBy after this resolves.
 */
export async function restoreDeletedRecord(req: Request, record: DeletedRecord): Promise<void> {
  if (record.restoredAt) {
    throw new RestoreConflictError("This record has already been restored.");
  }
  if (!isRestorableEntityType(record.entityType)) {
    throw new RestoreConflictError(`Records of type "${record.entityType}" cannot be restored.`);
  }

  const snapshot = record.snapshot as any;

  switch (record.entityType) {
    case "vote":
      await restoreVote(record.entityId, snapshot);
      break;
    case "meeting":
      await restoreMeeting(record.entityId, snapshot);
      break;
    case "task":
      await restoreTask(record.entityId, snapshot);
      break;
    case "document":
      await restoreDocument(record.entityId, snapshot);
      break;
  }

  await audit(req, "record_restored", record.entityType, record.entityId, {
    deletedRecordId: record.id,
  });
}

async function assertBoardAlive(boardId: string | null | undefined): Promise<void> {
  if (!boardId) return; // nullable FK — nothing to check
  if (!(await rowExists(boardsTable, boardsTable.id, boardId))) {
    throw new RestoreConflictError("Cannot restore: the board this record belonged to no longer exists.");
  }
}

async function restoreVote(id: string, snapshot: any): Promise<void> {
  const vote = snapshot?.vote;
  if (!vote) throw new RestoreConflictError("Snapshot is missing the vote row; cannot restore.");

  if (await rowExists(votesTable, votesTable.id, id)) {
    throw new RestoreConflictError("Cannot restore: a live vote with this id already exists.");
  }
  // resolutionNumber is UNIQUE across all votes — a different live vote may have
  // taken it since the delete.
  if (vote.resolutionNumber) {
    const [clash] = await db
      .select({ id: votesTable.id })
      .from(votesTable)
      .where(and(eq(votesTable.resolutionNumber, vote.resolutionNumber), ne(votesTable.id, id)))
      .limit(1);
    if (clash) {
      throw new RestoreConflictError(
        `Cannot restore: resolution number ${vote.resolutionNumber} is already in use by another vote.`,
      );
    }
  }
  await assertBoardAlive(vote.boardId);
  // meetingId is a nullable soft reference — null it if the meeting is gone.
  const meetingId =
    vote.meetingId && (await rowExists(meetingsTable, meetingsTable.id, vote.meetingId)) ? vote.meetingId : null;

  const documents: any[] = Array.isArray(snapshot.documents) ? snapshot.documents : [];
  const proxies: any[] = Array.isArray(snapshot.proxies) ? snapshot.proxies : [];

  await db.transaction(async (tx) => {
    await tx.insert(votesTable).values({
      id: vote.id,
      boardId: vote.boardId ?? null,
      meetingId,
      resolutionNumber: vote.resolutionNumber,
      title: vote.title,
      resolutionText: vote.resolutionText,
      type: vote.type,
      deadline: toDate(vote.deadline),
      status: vote.status,
      certificateHash: vote.certificateHash ?? null,
      secret: vote.secret ?? false,
      closedAt: toDate(vote.closedAt),
      createdAt: toDate(vote.createdAt) ?? new Date(),
    });

    for (const doc of documents) {
      const uploadedBy =
        doc.uploadedBy && (await rowExists(peopleTable, peopleTable.id, doc.uploadedBy)) ? doc.uploadedBy : null;
      await tx.insert(voteDocumentsTable).values({
        id: doc.id,
        voteId: id,
        title: doc.title,
        filename: doc.filename,
        filePath: doc.filePath ?? null,
        fileSize: doc.fileSize ?? null,
        mimeType: doc.mimeType ?? null,
        uploadedBy,
        createdAt: toDate(doc.createdAt) ?? new Date(),
      });
    }

    for (const proxy of proxies) {
      // A proxy needs both people alive (NOT NULL FKs) — skip any grant whose
      // principal or holder was deleted since; it is advisory, not the record.
      const principalOk = await rowExists(peopleTable, peopleTable.id, proxy.principalId);
      const holderOk = await rowExists(peopleTable, peopleTable.id, proxy.holderId);
      if (!principalOk || !holderOk) continue;
      const createdBy =
        proxy.createdBy && (await rowExists(peopleTable, peopleTable.id, proxy.createdBy)) ? proxy.createdBy : null;
      await tx.insert(voteProxiesTable).values({
        id: proxy.id,
        voteId: id,
        principalId: proxy.principalId,
        holderId: proxy.holderId,
        createdBy,
        createdAt: toDate(proxy.createdAt) ?? new Date(),
      });
    }
  });

  await grantDefaultAccess("vote", id, vote.boardId ?? null);
}

async function restoreMeeting(id: string, snapshot: any): Promise<void> {
  const meeting = snapshot;
  if (!meeting?.id) throw new RestoreConflictError("Snapshot is missing the meeting row; cannot restore.");
  if (await rowExists(meetingsTable, meetingsTable.id, id)) {
    throw new RestoreConflictError("Cannot restore: a live meeting with this id already exists.");
  }
  await assertBoardAlive(meeting.boardId);

  await db.insert(meetingsTable).values({
    id: meeting.id,
    boardId: meeting.boardId ?? null,
    title: meeting.title,
    date: toDate(meeting.date) ?? new Date(),
    location: meeting.location ?? null,
    status: meeting.status,
    createdAt: toDate(meeting.createdAt) ?? new Date(),
  });

  await grantDefaultAccess("meeting", id, meeting.boardId ?? null);
}

async function restoreTask(id: string, snapshot: any): Promise<void> {
  const task = snapshot;
  if (!task?.id) throw new RestoreConflictError("Snapshot is missing the task row; cannot restore.");
  if (await rowExists(tasksTable, tasksTable.id, id)) {
    throw new RestoreConflictError("Cannot restore: a live task with this id already exists.");
  }
  if (task.taskNumber) {
    const [clash] = await db
      .select({ id: tasksTable.id })
      .from(tasksTable)
      .where(and(eq(tasksTable.taskNumber, task.taskNumber), ne(tasksTable.id, id)))
      .limit(1);
    if (clash) {
      throw new RestoreConflictError(
        `Cannot restore: task number ${task.taskNumber} is already in use by another task.`,
      );
    }
  }
  await assertBoardAlive(task.boardId);

  // Nullable soft references: re-point only if the target still exists.
  const assigneeId =
    task.assigneeId && (await rowExists(peopleTable, peopleTable.id, task.assigneeId)) ? task.assigneeId : null;
  const sourceMeetingId =
    task.sourceMeetingId && (await rowExists(meetingsTable, meetingsTable.id, task.sourceMeetingId))
      ? task.sourceMeetingId
      : null;
  const sourceMinutesId =
    task.sourceMinutesId && (await rowExists(minutesTable, minutesTable.id, task.sourceMinutesId))
      ? task.sourceMinutesId
      : null;

  await db.insert(tasksTable).values({
    id: task.id,
    boardId: task.boardId ?? null,
    title: task.title,
    description: task.description ?? null,
    assigneeId,
    sourceMeetingId,
    sourceMinutesId,
    taskNumber: task.taskNumber ?? null,
    status: task.status,
    dueDate: task.dueDate ?? null, // `date` column — stored/expected as a YYYY-MM-DD string
    aiExtracted: task.aiExtracted ?? false,
    sourceParagraph: task.sourceParagraph ?? null,
    createdAt: toDate(task.createdAt) ?? new Date(),
  });

  await grantDefaultAccess("task", id, task.boardId ?? null);
}

async function restoreDocument(id: string, snapshot: any): Promise<void> {
  const doc = snapshot;
  if (!doc?.id) throw new RestoreConflictError("Snapshot is missing the document row; cannot restore.");
  if (await rowExists(documentsTable, documentsTable.id, id)) {
    throw new RestoreConflictError("Cannot restore: a live document with this id already exists.");
  }
  await assertBoardAlive(doc.boardId);
  const uploadedBy =
    doc.uploadedBy && (await rowExists(peopleTable, peopleTable.id, doc.uploadedBy)) ? doc.uploadedBy : null;

  await db.insert(documentsTable).values({
    id: doc.id,
    boardId: doc.boardId ?? null,
    title: doc.title,
    filename: doc.filename,
    filePath: doc.filePath ?? null,
    fileSize: doc.fileSize ?? null,
    mimeType: doc.mimeType ?? null,
    aiClassification: doc.aiClassification ?? null,
    confidential: doc.confidential ?? false,
    confidentialNote: doc.confidentialNote ?? null,
    uploadedBy,
    createdAt: toDate(doc.createdAt) ?? new Date(),
  });

  await grantDefaultAccess("document", id, doc.boardId ?? null);
}
