import { pgTable, uuid, text, timestamp, boolean } from "drizzle-orm/pg-core";

export const peopleTable = pgTable("people", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique().notNull(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role", { enum: ["admin", "member", "observer", "management"] }).notNull(),
  title: text("title"),
  avatarColor: text("avatar_color"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Person = typeof peopleTable.$inferSelect;
