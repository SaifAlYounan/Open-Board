import { pgTable, uuid, text, boolean, timestamp, unique, index } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

export const accessControlTable = pgTable("access_control", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  personId: uuid("person_id").references(() => peopleTable.id),
  // true = explicit grant, false = explicit DENY (recusal) which takes precedence
  // over any grant or board membership. See lib/access.ts for the resolution order.
  hasAccess: boolean("has_access").default(true),
  // Optional expiry for a grant (NULL = no expiry). Ignored for deny rows.
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (t) => ({
  uniq: unique().on(t.entityType, t.entityId, t.personId),
  entityLookup: index("access_control_entity_lookup").on(t.entityType, t.entityId),
  personIdx: index("access_control_person_id_idx").on(t.personId),
}));
