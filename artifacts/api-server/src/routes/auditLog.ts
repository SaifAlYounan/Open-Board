import { Router } from "express";
import { db, auditTrailTable, peopleTable } from "@workspace/db";
import { desc, eq, and, like, or } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";

const router = Router();

const ACTION_LABELS: Record<string, string> = {
  login: "Signed in",
  document_uploaded: "Uploaded document",
  document_viewed: "Viewed document",
  document_deleted: "Deleted document",
  vote_created: "Created vote",
  vote_cast: "Cast vote",
  vote_extended: "Extended vote deadline",
  vote_cancelled: "Cancelled vote",
  vote_deleted: "Deleted vote",
  vote_material_uploaded: "Uploaded vote material",
  vote_material_downloaded: "Downloaded vote material",
  meeting_created: "Created meeting",
  meeting_updated: "Updated meeting",
  meeting_deleted: "Deleted meeting",
  minutes_saved: "Saved minutes",
  minutes_status_changed: "Updated minutes status",
  minutes_signed: "Signed minutes",
  task_created: "Created task",
  task_updated: "Updated task",
  task_deleted: "Deleted task",
  task_evidence_uploaded: "Uploaded task evidence",
  data_reset: "Reset all data",
};

router.get("/audit", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const { personId, action, search, limit = "200", offset = "0" } = req.query;

  const rows = await db
    .select()
    .from(auditTrailTable)
    .orderBy(desc(auditTrailTable.createdAt))
    .limit(Number(limit))
    .offset(Number(offset));

  let filtered = rows;
  if (personId) filtered = filtered.filter((r) => r.personId === personId);
  if (action) filtered = filtered.filter((r) => r.action === action);
  if (search) {
    const q = (search as string).toLowerCase();
    filtered = filtered.filter((r) =>
      r.action.toLowerCase().includes(q) ||
      JSON.stringify(r.details || {}).toLowerCase().includes(q) ||
      r.ipAddress?.toLowerCase().includes(q)
    );
  }

  const withPeople = await Promise.all(
    filtered.map(async (row) => {
      if (!row.personId) return { ...row, person: null, actionLabel: ACTION_LABELS[row.action] || row.action };
      const [person] = await db
        .select({ id: peopleTable.id, name: peopleTable.name, email: peopleTable.email, role: peopleTable.role, avatarColor: peopleTable.avatarColor })
        .from(peopleTable)
        .where(eq(peopleTable.id, row.personId));
      return {
        ...row,
        person: person ?? null,
        actionLabel: ACTION_LABELS[row.action] || row.action,
      };
    })
  );

  res.json(withPeople);
});

router.get("/audit/people", requireAuth, requireAdmin, async (req, res): Promise<void> => {
  const people = await db
    .select({ id: peopleTable.id, name: peopleTable.name, email: peopleTable.email, role: peopleTable.role })
    .from(peopleTable)
    .orderBy(peopleTable.name);
  res.json(people);
});

export default router;
