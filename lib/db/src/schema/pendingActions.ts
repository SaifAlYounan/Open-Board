import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { documentsTable } from "./documents";

export const pendingActionsTable = pgTable("pending_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id").references(() => documentsTable.id),
  actionType: text("action_type", { enum: ["create_minutes", "create_vote", "create_meeting", "create_task", "close_task", "attach_to_meeting", "flag_confidential", "create_workflow"] }).notNull(),
  actionData: jsonb("action_data").notNull(),
  status: text("status", { enum: ["pending", "approved", "rejected", "modified"] }).default("pending"),
  secretaryNotes: text("secretary_notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type PendingAction = typeof pendingActionsTable.$inferSelect;
