import { pgTable, uuid, text, integer, boolean, timestamp, numeric, primaryKey } from "drizzle-orm/pg-core";
import { votesTable } from "./votes";
import { peopleTable } from "./people";

export const approvalRulesTable = pgTable("approval_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  voteId: uuid("vote_id").references(() => votesTable.id).unique(),
  type: text("type", { enum: ["unanimous", "majority", "two_thirds", "three_quarters", "custom"] }).notNull(),
  minApprovals: integer("min_approvals"),
  quorum: integer("quorum"),
  weighted: boolean("weighted").default(false),
  deadlineBehavior: text("deadline_behavior", { enum: ["lapse", "extend", "notify"] }).default("lapse"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const approvalRuleRequiredVotersTable = pgTable("approval_rule_required_voters", {
  ruleId: uuid("rule_id").references(() => approvalRulesTable.id, { onDelete: "cascade" }),
  personId: uuid("person_id").references(() => peopleTable.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.ruleId, t.personId] }),
}));

export const approvalRuleRecusalsTable = pgTable("approval_rule_recusals", {
  ruleId: uuid("rule_id").references(() => approvalRulesTable.id, { onDelete: "cascade" }),
  personId: uuid("person_id").references(() => peopleTable.id),
  reason: text("reason"),
}, (t) => ({
  pk: primaryKey({ columns: [t.ruleId, t.personId] }),
}));

export const approvalRuleWeightsTable = pgTable("approval_rule_weights", {
  ruleId: uuid("rule_id").references(() => approvalRulesTable.id, { onDelete: "cascade" }),
  personId: uuid("person_id").references(() => peopleTable.id),
  weight: numeric("weight").default("1"),
}, (t) => ({
  pk: primaryKey({ columns: [t.ruleId, t.personId] }),
}));

export type ApprovalRule = typeof approvalRulesTable.$inferSelect;
