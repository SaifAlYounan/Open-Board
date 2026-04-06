import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { boardsTable } from "./boards";
import { peopleTable } from "./people";
import { documentsTable } from "./documents";
import { votesTable } from "./votes";

export const approvalWorkflowsTable = pgTable("approval_workflows", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  boardId: uuid("board_id").references(() => boardsTable.id),
  documentId: uuid("document_id").references(() => documentsTable.id),
  status: text("status", { enum: ["active", "completed", "rejected", "cancelled"] }).notNull().default("active"),
  createdBy: uuid("created_by").references(() => peopleTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workflowStagesTable = pgTable("workflow_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  workflowId: uuid("workflow_id").notNull().references(() => approvalWorkflowsTable.id, { onDelete: "cascade" }),
  stageIndex: integer("stage_index").notNull(),
  stageGroup: integer("stage_group").notNull().default(0),
  title: text("title").notNull(),
  description: text("description"),
  boardId: uuid("board_id").references(() => boardsTable.id),
  approvalType: text("approval_type", { enum: ["unanimous", "majority", "two_thirds", "three_quarters", "custom"] }).notNull().default("majority"),
  voteId: uuid("vote_id").references(() => votesTable.id),
  status: text("status", { enum: ["pending", "active", "approved", "rejected", "cancelled"] }).notNull().default("pending"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApprovalWorkflow = typeof approvalWorkflowsTable.$inferSelect;
export type WorkflowStage = typeof workflowStagesTable.$inferSelect;
