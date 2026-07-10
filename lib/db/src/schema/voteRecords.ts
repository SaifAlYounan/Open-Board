import { pgTable, uuid, text, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { votesTable } from "./votes";
import { peopleTable } from "./people";

export const voteRecordsTable = pgTable("vote_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  voteId: uuid("vote_id").references(() => votesTable.id),
  personId: uuid("person_id").references(() => peopleTable.id),
  decision: text("decision", { enum: ["approved", "approved_with_comments", "not_approved", "not_approved_with_comments"] }).notNull(),
  comment: text("comment"),
  // When set, this ballot was cast by `castBy` acting as proxy FOR `personId`
  // (the ballot always belongs to — and weighs as — the principal in
  // `personId`; the proxy holder is never masqueraded). Null = cast in person.
  // A principal casting in person later SUPERSEDES a proxy-cast ballot: the
  // record is updated and castBy reset to null (audit-logged).
  castBy: uuid("cast_by").references(() => peopleTable.id),
  // Snapshot of the caster's board voting weight at the moment the ballot was
  // cast — the tally and the certificate hash use this persisted value, so a
  // later weight change can never silently rewrite a closed vote.
  weight: integer("weight").notNull().default(1),
  votedAt: timestamp("voted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: unique().on(t.voteId, t.personId),
  voteIdx: index("vote_records_vote_id_idx").on(t.voteId),
}));

export type VoteRecord = typeof voteRecordsTable.$inferSelect;
