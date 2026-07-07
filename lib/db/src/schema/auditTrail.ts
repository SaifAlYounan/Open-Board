import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

export const auditTrailTable = pgTable("audit_trail", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").references(() => peopleTable.id),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  // SHA-256 over the previous audit row — tamper-evident hash chain.
  prevHash: text("prev_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Every audit write reads the latest row (ORDER BY created_at DESC LIMIT 1).
  createdAtIdx: index("audit_trail_created_at_idx").on(t.createdAt),
}));
