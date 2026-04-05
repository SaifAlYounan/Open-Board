import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

export const auditTrailTable = pgTable("audit_trail", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").references(() => peopleTable.id),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
