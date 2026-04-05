import { pgTable, uuid, text, date, boolean, timestamp } from "drizzle-orm/pg-core";
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
  status: text("status", { enum: ["todo", "in_progress", "evidence_submitted", "pending_review", "done", "overdue"] }).default("todo"),
  dueDate: date("due_date"),
  aiExtracted: boolean("ai_extracted").default(false),
  sourceParagraph: text("source_paragraph"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Task = typeof tasksTable.$inferSelect;
