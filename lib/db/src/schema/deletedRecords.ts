import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

// Retention log + recycle bin: a full snapshot of every governance record that
// is deleted, so a board can account for — and export — records that were
// removed, AND restore them (issue #11). The row is NEVER hard-deleted: a
// restore stamps restoredAt/restoredBy so the deletion itself stays on the
// audit trail even after the record is brought back.
export const deletedRecordsTable = pgTable("deleted_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  deletedBy: uuid("deleted_by").references(() => peopleTable.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  // Set when the snapshot is restored back into its source table. A non-null
  // restoredAt means the row has already been restored (double-restore guard).
  restoredAt: timestamp("restored_at", { withTimezone: true }),
  restoredBy: uuid("restored_by").references(() => peopleTable.id),
}, (t) => ({
  entityIdx: index("deleted_records_entity_idx").on(t.entityType, t.entityId),
}));

export type DeletedRecord = typeof deletedRecordsTable.$inferSelect;
