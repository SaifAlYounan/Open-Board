import bcrypt from "bcryptjs";
import {
  db,
  organizationsTable,
  boardsTable,
  peopleTable,
  boardMembershipsTable,
  accessControlTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger";

const PASSWORD = "Meridian2024!";

const PEOPLE = [
  // Admin (Secretary)
  { email: "ahmed@meridian.ae", name: "Ahmed Al-Rashid", role: "admin" as const, title: "Board Secretary", avatarColor: "#5856d6" },
  // Board members
  { email: "sarah@meridian.ae", name: "Sarah Al-Mansoori", role: "member" as const, title: "Chairperson", avatarColor: "#0071e3" },
  { email: "khalid@meridian.ae", name: "Khalid Ibrahim", role: "member" as const, title: "Deputy Chairman", avatarColor: "#34c759" },
  { email: "fatima@meridian.ae", name: "Fatima Al-Zaabi", role: "member" as const, title: "Board Director", avatarColor: "#ff9500" },
  { email: "omar@meridian.ae", name: "Omar Al-Shamsi", role: "member" as const, title: "Board Director", avatarColor: "#ff3b30" },
  { email: "laila@meridian.ae", name: "Laila Hassan", role: "member" as const, title: "Independent Director", avatarColor: "#af52de" },
  { email: "yousef@meridian.ae", name: "Yousef Al-Mazrouei", role: "member" as const, title: "Independent Director", avatarColor: "#ff2d55" },
  { email: "mariam@meridian.ae", name: "Mariam Al-Ketbi", role: "member" as const, title: "Executive Director", avatarColor: "#30b0c7" },
  // Observers
  { email: "james@meridian.ae", name: "James Thornton", role: "observer" as const, title: "Strategy Observer (FAC)", avatarColor: "#64d2ff" },
  { email: "rania@meridian.ae", name: "Rania Khoury", role: "observer" as const, title: "Audit Observer (BoD)", avatarColor: "#5ac8fa" },
  // Management
  { email: "david@meridian.ae", name: "David Chen", role: "management" as const, title: "CFO", avatarColor: "#0071e3" },
  { email: "nadia@meridian.ae", name: "Nadia Saleh", role: "management" as const, title: "Head of Legal", avatarColor: "#34c759" },
  { email: "hassan@meridian.ae", name: "Hassan Al-Farsi", role: "management" as const, title: "VP Operations", avatarColor: "#ff9500" },
  { email: "priya@meridian.ae", name: "Priya Sharma", role: "management" as const, title: "Chief Risk Officer", avatarColor: "#5856d6" },
  { email: "lucas@meridian.ae", name: "Lucas Fernandez", role: "management" as const, title: "Head of Finance", avatarColor: "#af52de" },
  { email: "aisha@meridian.ae", name: "Aisha Mohammed", role: "management" as const, title: "VP Strategy", avatarColor: "#ff2d55" },
  { email: "tom@meridian.ae", name: "Tom Barrett", role: "management" as const, title: "Head of Projects", avatarColor: "#30b0c7" },
  { email: "chen@meridian.ae", name: "Chen Wei", role: "management" as const, title: "IT Director", avatarColor: "#64d2ff" },
  { email: "sara@meridian.ae", name: "Sara Al-Nuaimi", role: "management" as const, title: "Compliance Officer", avatarColor: "#ff9500" },
  { email: "michael@meridian.ae", name: "Michael Foster", role: "management" as const, title: "Head of HR", avatarColor: "#34c759" },
];

const BOARDS = [
  { name: "Board of Directors", abbreviation: "BOD", type: "board" as const },
  { name: "Finance & Audit Committee", abbreviation: "FAC", type: "committee" as const },
  { name: "Strategy & Investment Committee", abbreviation: "SIC", type: "committee" as const },
  { name: "Nomination & Remuneration Committee", abbreviation: "NRC", type: "committee" as const },
  { name: "Technical & Projects Committee", abbreviation: "TPC", type: "committee" as const },
];

export async function seed(): Promise<void> {
  // Check if already seeded
  const existingPeople = await db.select().from(peopleTable).limit(1);
  if (existingPeople.length > 0) {
    logger.info("Database already seeded — skipping");
    return;
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

  const [ahmed, sarah, khalid, fatima, omar, laila, yousef, mariam, james, rania, david, nadia, hassan, priya, lucas, aisha, tom, chen, sara, michael] = createdPeople;

  // Board of Directors: all 7 board members + secretary
  const bodMembers = [sarah, khalid, fatima, omar, laila, yousef, mariam, rania];
  for (const m of bodMembers) {
    await db
      .insert(boardMembershipsTable)
      .values({ boardId: bodBoard.id, personId: m.id, roleInBoard: m.id === sarah.id ? "chairperson" : "member" })
      .onConflictDoNothing();
  }

  // Finance & Audit Committee
  const facMembers = [sarah, khalid, fatima, omar, james, rania];
  for (const m of facMembers) {
    await db
      .insert(boardMembershipsTable)
      .values({ boardId: facBoard.id, personId: m.id, roleInBoard: m.id === sarah.id ? "chair" : m.role === "observer" ? "observer" : "member" })
      .onConflictDoNothing();
  }

  // Strategy & Investment Committee
  const sicMembers = [khalid, fatima, laila, yousef, mariam, james];
  for (const m of sicMembers) {
    await db
      .insert(boardMembershipsTable)
      .values({ boardId: sicBoard.id, personId: m.id, roleInBoard: m.id === khalid.id ? "chair" : m.role === "observer" ? "observer" : "member" })
      .onConflictDoNothing();
  }

  // Nomination & Remuneration Committee
  const nrcMembers = [laila, yousef, mariam];
  for (const m of nrcMembers) {
    await db
      .insert(boardMembershipsTable)
      .values({ boardId: nrcBoard.id, personId: m.id, roleInBoard: m.id === laila.id ? "chair" : "member" })
      .onConflictDoNothing();
  }

  // Technical & Projects Committee
  const tpcMembers = [omar, mariam, yousef];
  for (const m of tpcMembers) {
    await db
      .insert(boardMembershipsTable)
      .values({ boardId: tpcBoard.id, personId: m.id, roleInBoard: m.id === omar.id ? "chair" : "member" })
      .onConflictDoNothing();
  }

  // Grant admin access to all boards
  for (const board of boards) {
    await db
      .insert(accessControlTable)
      .values({ entityType: "board", entityId: board.id, personId: ahmed.id, hasAccess: true })
      .onConflictDoNothing();
  }

  logger.info(
    { peopleCount: createdPeople.length, boardsCount: boards.length },
    "Database seeded successfully"
  );
}
