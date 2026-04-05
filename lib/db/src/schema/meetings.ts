import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { boardsTable } from "./boards";

export const meetingsTable = pgTable("meetings", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").references(() => boardsTable.id),
  title: text("title").notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  location: text("location"),
  status: text("status", { enum: ["scheduled", "concluded"] }).default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Meeting = typeof meetingsTable.$inferSelect;
