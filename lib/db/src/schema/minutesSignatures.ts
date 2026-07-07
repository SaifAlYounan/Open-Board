import { pgTable, uuid, text, timestamp, unique, index } from "drizzle-orm/pg-core";
import { minutesTable } from "./minutes";
import { peopleTable } from "./people";

export const minutesSignaturesTable = pgTable("minutes_signatures", {
  id: uuid("id").primaryKey().defaultRandom(),
  minutesId: uuid("minutes_id").references(() => minutesTable.id),
  personId: uuid("person_id").references(() => peopleTable.id),
  signatureHash: text("signature_hash").notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: unique().on(t.minutesId, t.personId),
  minutesIdx: index("minutes_signatures_minutes_id_idx").on(t.minutesId),
}));

export type MinutesSignature = typeof minutesSignaturesTable.$inferSelect;
