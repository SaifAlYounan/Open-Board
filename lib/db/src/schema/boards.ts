import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const boardsTable = pgTable("boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizationsTable.id),
  name: text("name").notNull(),
  abbreviation: text("abbreviation"),
  type: text("type", { enum: ["board", "committee"] }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Board = typeof boardsTable.$inferSelect;
