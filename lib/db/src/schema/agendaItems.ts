import { pgTable, uuid, text, integer } from "drizzle-orm/pg-core";
import { meetingsTable } from "./meetings";
import { votesTable } from "./votes";

export const agendaItemsTable = pgTable("agenda_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  meetingId: uuid("meeting_id").references(() => meetingsTable.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  type: text("type", { enum: ["information", "discussion", "decision"] }).notNull(),
  description: text("description"),
  voteId: uuid("vote_id").references(() => votesTable.id),
});

export type AgendaItem = typeof agendaItemsTable.$inferSelect;
