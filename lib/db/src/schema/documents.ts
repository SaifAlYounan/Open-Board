import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { boardsTable } from "./boards";
import { peopleTable } from "./people";

export const documentsTable = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").references(() => boardsTable.id),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  filePath: text("file_path"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type").default("application/pdf"),
  aiClassification: jsonb("ai_classification"),
  uploadedBy: uuid("uploaded_by").references(() => peopleTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Document = typeof documentsTable.$inferSelect;
