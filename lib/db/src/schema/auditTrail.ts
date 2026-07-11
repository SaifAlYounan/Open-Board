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
  // SHA-256 over the previous audit row (by seq) — hash chain. See lib/auditLog.ts.
  prevHash: text("prev_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  createdAtIdx: index("audit_trail_created_at_idx").on(t.createdAt),
  seqIdx: index("audit_trail_seq_idx").on(t.seq),
}));
