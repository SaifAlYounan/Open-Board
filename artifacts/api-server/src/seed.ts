import bcrypt from "bcryptjs";
import {
  db,
  organizationsTable,
  boardsTable,
  peopleTable,
  boardMembershipsTable,
  accessControlTable,
  minutesSignaturesTable,
  minutesSuggestionsTable,
  minutesTable,
  agendaItemsTable,
  attendanceTable,
  pendingActionsTable,
  voteRecordsTable,
  votesTable,
  meetingsTable,
  documentsTable,
  tasksTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger";

const PASSWORD = "Meridian2024!";

const PEOPLE = [
  // Admin (Secretary)
  { email: "a.alrashid@meridian-energy.com",  name: "Ahmed Al-Rashid",    role: "admin"      as const, title: "Board Secretary",          avatarColor: "#5856d6" },
  // Board members
  { email: "n.petrov@meridian-energy.com",     name: "Nadia Petrov",       role: "member"     as const, title: "Chairperson",               avatarColor: "#0071e3" },
  { email: "k.almansouri@meridian-energy.com", name: "Khalid Al-Mansouri", role: "member"     as const, title: "Deputy Chairman",           avatarColor: "#34c759" },
  { email: "f.alzaabi@meridian-energy.com",    name: "Fatima Al-Zaabi",    role: "member"     as const, title: "Board Director",            avatarColor: "#ff9500" },
  { email: "o.alshami@meridian-energy.com",    name: "Omar Al-Shamsi",     role: "member"     as const, title: "Board Director",            avatarColor: "#ff3b30" },
  { email: "e.vasquez@meridian-energy.com",    name: "Elena Vasquez",      role: "member"     as const, title: "Independent Director",      avatarColor: "#af52de" },
  { email: "m.thornton@meridian-energy.com",   name: "Marcus Thornton",    role: "member"     as const, title: "Independent Director",      avatarColor: "#ff2d55" },
  { email: "a.alketbi@meridian-energy.com",    name: "Aisha Al-Ketbi",     role: "member"     as const, title: "Executive Director",        avatarColor: "#30b0c7" },
  // Observers
  { email: "j.richardson@meridian-energy.com", name: "James Richardson",   role: "observer"   as const, title: "Strategy Observer (FAC)",   avatarColor: "#64d2ff" },
  { email: "r.khoury@meridian-energy.com",     name: "Rania Khoury",       role: "observer"   as const, title: "Audit Observer (BoD)",       avatarColor: "#5ac8fa" },
  // Management
  { email: "d.chen@meridian-energy.com",       name: "David Chen",         role: "management" as const, title: "CFO",                        avatarColor: "#0071e3" },
  { email: "n.saleh@meridian-energy.com",      name: "Nadia Saleh",        role: "management" as const, title: "Head of Legal",              avatarColor: "#34c759" },
  { email: "h.alfarsi@meridian-energy.com",    name: "Hassan Al-Farsi",    role: "management" as const, title: "VP Operations",              avatarColor: "#ff9500" },
  { email: "p.sharma@meridian-energy.com",     name: "Priya Sharma",       role: "management" as const, title: "Chief Risk Officer",         avatarColor: "#5856d6" },
  { email: "l.fernandez@meridian-energy.com",  name: "Lucas Fernandez",    role: "management" as const, title: "Head of Finance",            avatarColor: "#af52de" },
  { email: "l.mohammed@meridian-energy.com",   name: "Laila Mohammed",     role: "management" as const, title: "VP Strategy",                avatarColor: "#ff2d55" },
  { email: "t.barrett@meridian-energy.com",    name: "Tom Barrett",        role: "management" as const, title: "Head of Projects",           avatarColor: "#30b0c7" },
  { email: "w.zhang@meridian-energy.com",      name: "Wei Zhang",          role: "management" as const, title: "IT Director",                avatarColor: "#64d2ff" },
  { email: "s.khalil@meridian-energy.com",     name: "Sara Khalil",        role: "management" as const, title: "Compliance Officer",         avatarColor: "#ff9500" },
  { email: "m.foster@meridian-energy.com",     name: "Michael Foster",     role: "management" as const, title: "Head of HR",                 avatarColor: "#34c759" },
];

const BOARDS = [
  { name: "Board of Directors",                abbreviation: "BOD", type: "board"     as const },
  { name: "Finance & Audit Committee",         abbreviation: "FAC", type: "committee" as const },
  { name: "Strategy & Investment Committee",   abbreviation: "SIC", type: "committee" as const },
  { name: "Nomination & Remuneration Committee", abbreviation: "NRC", type: "committee" as const },
  { name: "Technical & Projects Committee",    abbreviation: "TPC", type: "committee" as const },
];

async function clearAll(): Promise<void> {
  await db.delete(minutesSignaturesTable);
  await db.delete(minutesSuggestionsTable);
  await db.delete(minutesTable);
  await db.delete(agendaItemsTable);
  await db.delete(attendanceTable);
  await db.delete(pendingActionsTable);
  await db.delete(voteRecordsTable);
  await db.delete(votesTable);
  await db.delete(meetingsTable);
  await db.delete(documentsTable);
  await db.delete(tasksTable);
  await db.delete(accessControlTable);
  await db.delete(boardMembershipsTable);
  await db.delete(boardsTable);
  await db.delete(peopleTable);
  await db.delete(organizationsTable);
}

export async function seed(): Promise<void> {
  // Check if already seeded with the correct emails
  const existingPeople = await db.select().from(peopleTable).limit(1);
  if (existingPeople.length > 0) {
    const hasCorrectDomain = existingPeople[0].email?.includes("@meridian-energy.com");
    if (hasCorrectDomain) {
      logger.info("Database already seeded with correct data — skipping");
      return;
    }
    // Wrong domain — wipe and re-seed
    logger.info("Detected outdated seed data — wiping and re-seeding...");
    await clearAll();
  }

  logger.info("Seeding database...");
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // Create organization
  const [org] = await db
    .insert(organizationsTable)
    .values({ name: "Meridian Energy Group" })
    .returning();

  // Create boards
  const boards: Array<typeof boardsTable.$inferSelect> = [];
  for (const b of BOARDS) {
    const [board] = await db
      .insert(boardsTable)
      .values({ ...b, organizationId: org.id })
      .returning();
    boards.push(board);
  }

  const [bodBoard, facBoard, sicBoard, nrcBoard, tpcBoard] = boards;

  // Create people
  const createdPeople: Array<typeof peopleTable.$inferSelect> = [];
  for (const p of PEOPLE) {
    const [person] = await db
      .insert(peopleTable)
      .values({ ...p, passwordHash })
      .returning();
    createdPeople.push(person);
  }

  const [ahmed, nadia, khalid, fatima, omar, elena, marcus, aisha, james, rania, david, nadiaSaleh, hassan, priya, lucas, laila, tom, wei, sara, michael] = createdPeople;

  // Board of Directors: all 7 board members + both observers
  const bodMembers = [nadia, khalid, fatima, omar, elena, marcus, aisha, rania];
  for (const m of bodMembers) {
    await db.insert(boardMembershipsTable)
      .values({ boardId: bodBoard.id, personId: m.id, roleInBoard: m.id === nadia.id ? "chairperson" : m.role === "observer" ? "observer" : "member" })
      .onConflictDoNothing();
  }

  // Finance & Audit Committee
  const facMembers = [nadia, khalid, fatima, omar, james, rania];
  for (const m of facMembers) {
    await db.insert(boardMembershipsTable)
      .values({ boardId: facBoard.id, personId: m.id, roleInBoard: m.id === nadia.id ? "chair" : m.role === "observer" ? "observer" : "member" })
      .onConflictDoNothing();
  }

  // Strategy & Investment Committee
  const sicMembers = [khalid, fatima, elena, marcus, aisha, james];
  for (const m of sicMembers) {
    await db.insert(boardMembershipsTable)
      .values({ boardId: sicBoard.id, personId: m.id, roleInBoard: m.id === khalid.id ? "chair" : m.role === "observer" ? "observer" : "member" })
      .onConflictDoNothing();
  }

  // Nomination & Remuneration Committee
  const nrcMembers = [elena, marcus, aisha];
  for (const m of nrcMembers) {
    await db.insert(boardMembershipsTable)
      .values({ boardId: nrcBoard.id, personId: m.id, roleInBoard: m.id === elena.id ? "chair" : "member" })
      .onConflictDoNothing();
  }

  // Technical & Projects Committee
  const tpcMembers = [omar, aisha, marcus];
  for (const m of tpcMembers) {
    await db.insert(boardMembershipsTable)
      .values({ boardId: tpcBoard.id, personId: m.id, roleInBoard: m.id === omar.id ? "chair" : "member" })
      .onConflictDoNothing();
  }

  // Grant admin access to all boards
  for (const board of boards) {
    await db.insert(accessControlTable)
      .values({ entityType: "board", entityId: board.id, personId: ahmed.id, hasAccess: true })
      .onConflictDoNothing();
  }

  logger.info(
    { peopleCount: createdPeople.length, boardsCount: boards.length },
    "Database seeded successfully"
  );
}
