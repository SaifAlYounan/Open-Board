import { pgTable, uuid, text, unique } from "drizzle-orm/pg-core";
import { boardsTable } from "./boards";
import { peopleTable } from "./people";

export const boardMembershipsTable = pgTable("board_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").references(() => boardsTable.id),
  personId: uuid("person_id").references(() => peopleTable.id),
  roleInBoard: text("role_in_board").default("member"),
}, (t) => ({
  uniq: unique().on(t.boardId, t.personId),
}));

export type BoardMembership = typeof boardMembershipsTable.$inferSelect;
