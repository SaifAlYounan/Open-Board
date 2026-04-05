import { pgTable, uuid, text, primaryKey } from "drizzle-orm/pg-core";
import { meetingsTable } from "./meetings";
import { peopleTable } from "./people";

export const attendanceTable = pgTable("attendance", {
  meetingId: uuid("meeting_id").references(() => meetingsTable.id, { onDelete: "cascade" }),
  personId: uuid("person_id").references(() => peopleTable.id),
  status: text("status", { enum: ["confirmed", "pending", "proxy", "absent"] }).default("pending"),
  proxyHolderId: uuid("proxy_holder_id").references(() => peopleTable.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.meetingId, t.personId] }),
}));

export type Attendance = typeof attendanceTable.$inferSelect;
