import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { votesTable } from "./votes";
import { peopleTable } from "./people";

export const voteDocumentsTable = pgTable("vote_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  voteId: uuid("vote_id").references(() => votesTable.id, { onDelete: "cascade" }).notNull(),
  title: text("title").notNull(),
  filename: text("filename").notNull(),
  filePath: text("file_path"),
  fileSize: integer("file_size"),
  mimeType: text("mime_type").default("application/pdf"),
  uploadedBy: uuid("uploaded_by").references(() => peopleTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VoteDocument = typeof voteDocumentsTable.$inferSelect;
