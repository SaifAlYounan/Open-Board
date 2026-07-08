import { pgTable, uuid, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

// Retention log: a full snapshot of every governance record that is deleted, so
// a board can still account for — and export — records that were removed. This
// is a retention/audit trail, not a restore mechanism.
export const deletedRecordsTable = pgTable("deleted_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  deletedBy: uuid("deleted_by").references(() => peopleTable.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  entityIdx: index("deleted_records_entity_idx").on(t.entityType, t.entityId),
}));

export type DeletedRecord = typeof deletedRecordsTable.$inferSelect;
