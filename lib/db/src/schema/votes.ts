import { pgTable, uuid, text, timestamp, boolean, integer, jsonb, index } from "drizzle-orm/pg-core";
import { boardsTable } from "./boards";
import { meetingsTable } from "./meetings";
import { serverSigningKeysTable } from "./serverSigningKeys";

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
  // v3 signed certificate (external-review item 1). null = pre-v3 vote whose
  // certificateHash verifies via the v2/v1 recompute fallback; 3 = the frozen
  // canonical payload below is Ed25519-signed by the server key. The payload is
  // PERSISTED (not recomputed) because it snapshots mutable inputs — attendance
  // rows and recusal reasons — exactly as they stood at close.
  certificateVersion: integer("certificate_version"),
  certificatePayload: jsonb("certificate_payload"),
  certificateSignature: text("certificate_signature"),
  certificateKeyId: uuid("certificate_key_id").references(() => serverSigningKeysTable.id),
  // Idempotence markers for deadline enforcement (item 4): each behavior fires
  // at most once.
  deadlineExtendedAt: timestamp("deadline_extended_at", { withTimezone: true }),
  deadlineNotifiedAt: timestamp("deadline_notified_at", { withTimezone: true }),
  secret: boolean("secret").default(false),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  boardIdx: index("votes_board_id_idx").on(t.boardId),
}));

export type Vote = typeof votesTable.$inferSelect;
