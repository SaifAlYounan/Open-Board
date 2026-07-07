import { pgTable, uuid, text, timestamp, unique, index } from "drizzle-orm/pg-core";
import { votesTable } from "./votes";
import { peopleTable } from "./people";

export const voteRecordsTable = pgTable("vote_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  voteId: uuid("vote_id").references(() => votesTable.id),
  personId: uuid("person_id").references(() => peopleTable.id),
  decision: text("decision", { enum: ["approved", "approved_with_comments", "not_approved", "not_approved_with_comments"] }).notNull(),
  comment: text("comment"),
  proxyFor: uuid("proxy_for").references(() => peopleTable.id),
  votedAt: timestamp("voted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: unique().on(t.voteId, t.personId),
  voteIdx: index("vote_records_vote_id_idx").on(t.voteId),
}));

export type VoteRecord = typeof voteRecordsTable.$inferSelect;
