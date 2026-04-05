import { pgTable, uuid, text, boolean, unique } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

export const accessControlTable = pgTable("access_control", {
  id: uuid("id").primaryKey().defaultRandom(),
  entityType: text("entity_type").notNull(),
  entityId: uuid("entity_id").notNull(),
  personId: uuid("person_id").references(() => peopleTable.id),
  hasAccess: boolean("has_access").default(true),
}, (t) => ({
  uniq: unique().on(t.entityType, t.entityId, t.personId),
}));
