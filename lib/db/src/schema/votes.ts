import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { boardsTable } from "./boards";
import { meetingsTable } from "./meetings";

export const votesTable = pgTable("votes", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").references(() => boardsTable.id),
  meetingId: uuid("meeting_id").references(() => meetingsTable.id),
  resolutionNumber: text("resolution_number").unique().notNull(),
  title: text("title").notNull(),
  resolutionText: text("resolution_text").notNull(),
  type: text("type", { enum: ["circulation", "meeting", "simple", "resolution", "election", "special"] }).notNull(),
  deadline: timestamp("deadline", { withTimezone: true }),
  status: text("status", { enum: ["open", "approved", "rejected", "lapsed", "cancelled"] }).default("open"),
  certificateHash: text("certificate_hash"),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Vote = typeof votesTable.$inferSelect;
