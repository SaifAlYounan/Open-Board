import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { minutesTable } from "./minutes";
import { peopleTable } from "./people";

export const minutesSuggestionsTable = pgTable("minutes_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  minutesId: uuid("minutes_id").references(() => minutesTable.id),
  personId: uuid("person_id").references(() => peopleTable.id),
  type: text("type", { enum: ["comment"] }).notNull().default("comment"),
  originalText: text("original_text").notNull(),
  commentText: text("comment_text").notNull(),
  status: text("status", { enum: ["pending", "resolved"] }).default("pending"),
  color: text("color").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MinutesSuggestion = typeof minutesSuggestionsTable.$inferSelect;
