import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

// Persistent login-failure counters and lockouts (issue #7). Keyed by whatever
// the login route counts by — currently the account email. Living in Postgres
// (instead of a per-process Map) means the lockout survives restarts and is
// shared by every app process pointing at the same database.
export const loginLockoutsTable = pgTable("login_lockouts", {
  key: text("key").primaryKey(),
  failedCount: integer("failed_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
