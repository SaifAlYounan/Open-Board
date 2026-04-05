import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";
import { peopleTable } from "./people";

export const taskEvidenceTable = pgTable("task_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").references(() => tasksTable.id),
  submittedBy: uuid("submitted_by").references(() => peopleTable.id),
  filePath: text("file_path"),
  fileName: text("file_name"),
  fileSize: integer("file_size"),
  aiVerdict: text("ai_verdict", { enum: ["approved", "rejected", "pending"] }),
  aiReasoning: text("ai_reasoning"),
  aiMissing: jsonb("ai_missing"),
  secretaryDecision: text("secretary_decision", { enum: ["confirmed", "rejected", "pending"] }),
  secretaryComment: text("secretary_comment"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});

export type TaskEvidence = typeof taskEvidenceTable.$inferSelect;
