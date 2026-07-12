import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

/**
 * P0.10 — append-only log of every change to effective access, so the system can
 * answer "as of date D, who could read entity X?" A privilege claim or a recusal
 * that cannot be proven after the fact is not defensible.
 *
 * Two kinds of event feed effective access under the one access model
 * (lib/access.ts):
 *   - explicit exceptions: "granted" / "denied" / "revoked" on a specific entity;
 *   - board membership: "board_joined" / "board_left" (entity_type='board'),
 *     because board members see board material via live membership.
 *
 * NEVER updated or deleted — corrections are new rows.
 */
export const accessEventsTable = pgTable("access_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(), // board | document | vote | meeting | task | minutes
  entityId: uuid("entity_id").notNull(),
  personId: uuid("person_id").notNull(),
  event: text("event").notNull(), // granted | denied | revoked | board_joined | board_left
  actorId: uuid("actor_id").references(() => peopleTable.id),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  lookup: index("access_events_entity_at_idx").on(t.entityType, t.entityId, t.at),
}));

export type AccessEvent = typeof accessEventsTable.$inferSelect;
