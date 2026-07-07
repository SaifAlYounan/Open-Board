import { pgTable, uuid, text, date, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { boardsTable } from "./boards";
import { peopleTable } from "./people";
import { meetingsTable } from "./meetings";
import { minutesTable } from "./minutes";

export const tasksTable = pgTable("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").references(() => boardsTable.id),
  title: text("title").notNull(),
  description: text("description"),
  assigneeId: uuid("assignee_id").references(() => peopleTable.id),
  sourceMeetingId: uuid("source_meeting_id").references(() => meetingsTable.id),
  sourceMinutesId: uuid("source_minutes_id").references(() => minutesTable.id),
  taskNumber: text("task_number").unique(),
  status: text("status", { enum: ["todo", "in_progress", "done", "blocked", "evidence_submitted", "pending_review", "overdue"] }).default("todo"),
  dueDate: date("due_date"),
  aiExtracted: boolean("ai_extracted").default(false),
  sourceParagraph: text("source_paragraph"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  boardIdx: index("tasks_board_id_idx").on(t.boardId),
  assigneeIdx: index("tasks_assignee_id_idx").on(t.assigneeId),
}));

export type Task = typeof tasksTable.$inferSelect;
