import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { boardsTable } from "./boards";

export const meetingsTable = pgTable("meetings", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").references(() => boardsTable.id),
  title: text("title").notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  location: text("location"),
  status: text("status", { enum: ["scheduled", "concluded", "cancelled"] }).default("scheduled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  boardIdx: index("meetings_board_id_idx").on(t.boardId),
}));

export type Meeting = typeof meetingsTable.$inferSelect;
