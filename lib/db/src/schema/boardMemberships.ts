import { pgTable, uuid, text, integer, unique, index } from "drizzle-orm/pg-core";
import { boardsTable } from "./boards";
import { peopleTable } from "./people";

export const boardMembershipsTable = pgTable("board_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  boardId: uuid("board_id").references(() => boardsTable.id),
  personId: uuid("person_id").references(() => peopleTable.id),
  roleInBoard: text("role_in_board").default("member"),
  // Voting weight of this member on this board. Positive integer (integer
  // weights keep the tally exact and auditable); 1 = the classic
  // one-member-one-vote default, so unweighted boards behave exactly as before.
  votingWeight: integer("voting_weight").notNull().default(1),
}, (t) => ({
  uniq: unique().on(t.boardId, t.personId),
  // The (boardId, personId) unique index serves boardId-prefixed lookups;
  // this covers the frequent "boards for a person" filter.
  personIdx: index("board_memberships_person_id_idx").on(t.personId),
}));

export type BoardMembership = typeof boardMembershipsTable.$inferSelect;
