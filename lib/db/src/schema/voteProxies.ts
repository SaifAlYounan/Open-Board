import { pgTable, uuid, timestamp, unique, index } from "drizzle-orm/pg-core";
import { votesTable } from "./votes";
import { peopleTable } from "./people";

/**
 * A proxy grant for one specific vote (per-VOTE, not per-meeting — the
 * circulation-vote model has no session to scope a meeting-wide proxy to, so
 * every absence is authorized vote by vote and the audit trail stays exact).
 *
 * `holderId` may cast on behalf of `principalId` for `voteId` only. The ballot
 * is recorded against the principal (vote_records.person_id = principal,
 * cast_by = holder) — never masquerading as the holder's own vote. One grant
 * per principal per vote; how many grants one holder may hold is capped by
 * boards.proxy_limit.
 */
export const voteProxiesTable = pgTable("vote_proxies", {
  id: uuid("id").primaryKey().defaultRandom(),
  voteId: uuid("vote_id").notNull().references(() => votesTable.id),
  principalId: uuid("principal_id").notNull().references(() => peopleTable.id),
  holderId: uuid("holder_id").notNull().references(() => peopleTable.id),
  createdBy: uuid("created_by").references(() => peopleTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: unique().on(t.voteId, t.principalId),
  voteIdx: index("vote_proxies_vote_id_idx").on(t.voteId),
  holderIdx: index("vote_proxies_holder_id_idx").on(t.holderId),
}));

export type VoteProxy = typeof voteProxiesTable.$inferSelect;
