import { pgTable, uuid, text, timestamp, jsonb, bigserial, index } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

export const auditTrailTable = pgTable("audit_trail", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Strictly-monotonic insert order (P0.6/A2). The hash chain is ordered by this,
  // NOT by created_at — created_at can collide at microsecond resolution, which
  // let the writer and verifier disagree on the predecessor and false-positive.
  seq: bigserial("seq", { mode: "number" }).notNull(),
  personId: uuid("person_id").references(() => peopleTable.id),
  action: text("action").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  details: jsonb("details"),
  ipAddress: text("ip_address"),
  // Hash over the previous audit row (by seq) — hash chain. See lib/auditLog.ts.
  // When key_id is set the link is HMAC-SHA-256 under the server audit key
  // (derived from SERVER_SIGNING_SECRET); when null it is plain SHA-256
  // (legacy/unkeyed). Each link is computed under THIS row's regime, so the
  // first keyed row seals the entire unkeyed history behind it: recomputing any
  // earlier link then requires the key. External-review item 1.
  prevHash: text("prev_hash"),
  // Identifier of the HMAC key that sealed this row's prev_hash (a digest of
  // the key itself, not the secret). null = unkeyed sha256 link.
  keyId: text("key_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  createdAtIdx: index("audit_trail_created_at_idx").on(t.createdAt),
  seqIdx: index("audit_trail_seq_idx").on(t.seq),
}));
