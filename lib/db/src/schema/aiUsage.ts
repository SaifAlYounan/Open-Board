import { pgTable, text, integer, bigint } from "drizzle-orm/pg-core";

// One row per UTC day. Persisted so the AI budget survives restarts and is
// shared across processes/replicas (the old in-memory counter did neither).
export const aiUsageTable = pgTable("ai_usage", {
  day: text("day").primaryKey(), // YYYY-MM-DD (UTC)
  calls: integer("calls").notNull().default(0),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
});

export type AiUsage = typeof aiUsageTable.$inferSelect;
