import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const boardsTable = pgTable("boards", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").references(() => organizationsTable.id),
  name: text("name").notNull(),
  abbreviation: text("abbreviation"),
  type: text("type", { enum: ["board", "committee"] }).notNull(),
  // Maximum number of proxies one member may hold on a single vote (standard
  // governance default: 1). 0 disables proxy voting on this board.
  proxyLimit: integer("proxy_limit").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Board = typeof boardsTable.$inferSelect;
