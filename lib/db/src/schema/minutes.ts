import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { meetingsTable } from "./meetings";

export const minutesTable = pgTable("minutes", {
  id: uuid("id").primaryKey().defaultRandom(),
  meetingId: uuid("meeting_id").references(() => meetingsTable.id).unique(),
  content: text("content").notNull(),
  status: text("status", { enum: ["draft", "review", "signing", "signed"] }).default("draft"),
  pdfPath: text("pdf_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Minutes = typeof minutesTable.$inferSelect;
