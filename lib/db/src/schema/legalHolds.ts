import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

/**
 * P0.9 — legal holds. An active hold (released_at IS NULL) on an entity, or on
 * its board, blocks deletion of that entity through every route. A records system
 * must be able to refuse disposal when litigation is reasonably anticipated.
 */
export const legalHoldsTable = pgTable("legal_holds", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(), // "board" | "meeting" | "document" | "vote" | "task"
  entityId: uuid("entity_id").notNull(),
  reason: text("reason").notNull(),
  placedBy: uuid("placed_by").references(() => peopleTable.id),
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  releasedBy: uuid("released_by").references(() => peopleTable.id),
  releasedAt: timestamp("released_at", { withTimezone: true }),
}, (t) => ({
  lookup: index("legal_holds_entity_idx").on(t.entityType, t.entityId),
}));

export type LegalHold = typeof legalHoldsTable.$inferSelect;
