import { pgTable, uuid, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const peopleTable = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["admin", "member", "observer", "management"] }).notNull(),
  title: text("title"),
  avatarColor: text("avatar_color"),
  active: boolean("active").notNull().default(true),
  // Bumped on password reset or deactivation — invalidates all outstanding JWTs for this person.
  tokenVersion: integer("token_version").notNull().default(0),
  mustResetPassword: boolean("must_reset_password").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Person = typeof peopleTable.$inferSelect;
