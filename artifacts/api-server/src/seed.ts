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
  agendaDocumentsTable,
  agendaItemsTable,
  attendanceTable,
  pendingActionsTable,
  voteRecordsTable,
  votesTable,
  meetingsTable,
  documentsTable,
  tasksTable,
  taskEvidenceTable,
  approvalRulesTable,
  approvalRuleRequiredVotersTable,
  approvalRuleRecusalsTable,
  approvalRuleWeightsTable,
  voteDocumentsTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./lib/logger";

const PASSWORD = process.env.SEED_PASSWORD;

const PEOPLE = [
  { email: "a.alrashid@meridian-energy.com",  name: "Ahmed Al-Rashid",    role: "admin"      as const, title: "Board Secretary",            avatarColor: "#5856d6" },
  { email: "n.petrov@meridian-energy.com",    name: "Nadia Petrov",       role: "member"     as const, title: "Chairperson",                 avatarColor: "#0071e3" },
  { email: "s.chen@meridian-energy.com",      name: "Sarah Chen",         role: "member"     as const, title: "Independent Director",        avatarColor: "#34c759" },
  { email: "k.weber@meridian-energy.com",     name: "Dr. Klaus Weber",    role: "member"     as const, title: "Independent Director",        avatarColor: "#ff9500" },
  { email: "f.alhosani@meridian-energy.com",  name: "Fatima Al-Hosani",   role: "member"     as const, title: "Non-Executive Director",      avatarColor: "#ff3b30" },
  { email: "j.obrien@meridian-energy.com",    name: "James O'Brien",      role: "member"     as const, title: "Independent Director",        avatarColor: "#af52de" },
  { email: "y.tanaka@meridian-energy.com",    name: "Yuki Tanaka",        role: "member"     as const, title: "Independent Director",        avatarColor: "#ff2d55" },
  { email: "m.santos@meridian-energy.com",    name: "Maria Santos",       role: "member"     as const, title: "Non-Executive Director",      avatarColor: "#30b0c7" },
  { email: "d.park@meridian-energy.com",      name: "David Park",         role: "observer"   as const, title: "External Legal Counsel",      avatarColor: "#64d2ff" },
  { email: "a.khalil@meridian-energy.com",    name: "Amira Khalil",       role: "observer"   as const, title: "External Auditor",            avatarColor: "#5ac8fa" },
  { email: "t.henderson@meridian-energy.com", name: "Thomas Henderson",   role: "observer"   as const, title: "Regulatory Advisor",          avatarColor: "#0071e3" },
  { email: "l.martinez@meridian-energy.com",  name: "Laura Martinez",     role: "observer"   as const, title: "External Tax Counsel",        avatarColor: "#34c759" },
  { email: "r.taylor@meridian-energy.com",    name: "Robert Taylor",      role: "management" as const, title: "CFO",                         avatarColor: "#0071e3" },
  { email: "p.sharma@meridian-energy.com",    name: "Priya Sharma",       role: "management" as const, title: "General Counsel",             avatarColor: "#5856d6" },
  { email: "l.wei@meridian-energy.com",       name: "Li Wei",             role: "management" as const, title: "VP Strategy",                 avatarColor: "#34c759" },
  { email: "o.mansour@meridian-energy.com",   name: "Omar Mansour",       role: "management" as const, title: "VP Operations",               avatarColor: "#ff9500" },
  { email: "e.rossi@meridian-energy.com",     name: "Elena Rossi",        role: "management" as const, title: "Head of Compliance",          avatarColor: "#ff2d55" },
  { email: "j.kim@meridian-energy.com",       name: "Jun Kim",            role: "management" as const, title: "Head of HR",                  avatarColor: "#30b0c7" },
  { email: "s.blanc@meridian-energy.com",     name: "Sophie Blanc",       role: "management" as const, title: "Head of ESG",                 avatarColor: "#af52de" },
  { email: "r.nair@meridian-energy.com",      name: "Raj Nair",           role: "management" as const, title: "CTO",                         avatarColor: "#64d2ff" },
];

const BOARDS = [
  { name: "Board of Directors",                 abbreviation: "BoD", type: "board" as const },
  { name: "Finance & Audit Committee",           abbreviation: "FAC", type: "committee" as const },
  { name: "Strategy & Investment Committee",     abbreviation: "SIC", type: "committee" as const },
  { name: "Nomination & Remuneration Committee", abbreviation: "NRC", type: "committee" as const },
  { name: "Technical & Projects Committee",      abbreviation: "TPC", type: "committee" as const },
];

export async function clearAll() {
  await db.delete(minutesSignaturesTable);
  await db.delete(minutesSuggestionsTable);
  await db.delete(minutesTable);
  await db.delete(agendaDocumentsTable);
  await db.delete(agendaItemsTable);
  await db.delete(attendanceTable);
  await db.delete(pendingActionsTable);
  await db.delete(voteRecordsTable);
  await db.delete(approvalRuleWeightsTable);
  await db.delete(approvalRuleRecusalsTable);
  await db.delete(approvalRuleRequiredVotersTable);
  await db.delete(approvalRulesTable);
  await db.delete(voteDocumentsTable);
  await db.delete(votesTable);
  await db.delete(taskEvidenceTable);
  await db.delete(tasksTable);
  await db.delete(meetingsTable);
  await db.delete(documentsTable);
  await db.delete(accessControlTable);
  await db.delete(boardMembershipsTable);
  await db.delete(boardsTable);
  await db.delete(peopleTable);
  await db.delete(organizationsTable);
}

async function grantAccess(entityType: string, entityId: string, personIds: string[]) {
  for (const personId of personIds) {
    await db.insert(accessControlTable)
      .values({ entityType, entityId, personId, hasAccess: true })
      .onConflictDoNothing();
  }
}

export async function seed() {
  const sarahChen = await db.select().from(peopleTable).where(eq(peopleTable.email, "s.chen@meridian-energy.com"));
  const hasData = sarahChen.length > 0;

  if (hasData) {
    logger.info("People already exist — skipping seed");
    await migratePeopleTitles();
    await migrateAddPasswordResetTokensTable();
    await migrateUpdatePasswords();
    await migrateAddSchemaConstraints();
    return;
  }

  await clearAll();

  if (!PASSWORD) {
    throw new Error("SEED_PASSWORD environment variable is required. Set it in Replit Secrets before running seed.");
  }

  const [org] = await db.insert(organizationsTable).values({ name: "Meridian Energy Group" }).returning();
  const hash = await bcrypt.hash(PASSWORD, 10);

  const allPeople: (typeof peopleTable.$inferSelect)[] = [];
  for (const p of PEOPLE) {
    const [person] = await db.insert(peopleTable).values({ ...p, passwordHash: hash }).returning();
    allPeople.push(person);
  }

  const allBoards: (typeof boardsTable.$inferSelect)[] = [];
  for (const b of BOARDS) {
    const [board] = await db.insert(boardsTable).values({ ...b, organizationId: org.id }).returning();
    allBoards.push(board);
  }

  const byEmail = (email: string) => allPeople.find((p) => p.email === email)!;
  const ahmed   = byEmail("a.alrashid@meridian-energy.com");
  const nadia   = byEmail("n.petrov@meridian-energy.com");
  const sarah   = byEmail("s.chen@meridian-energy.com");
  const klaus   = byEmail("k.weber@meridian-energy.com");
  const fatima  = byEmail("f.alhosani@meridian-energy.com");
  const james   = byEmail("j.obrien@meridian-energy.com");
  const yuki    = byEmail("y.tanaka@meridian-energy.com");
  const maria   = byEmail("m.santos@meridian-energy.com");
  const david   = byEmail("d.park@meridian-energy.com");
  const amira   = byEmail("a.khalil@meridian-energy.com");
  const laura   = byEmail("l.martinez@meridian-energy.com");
  const liwei   = byEmail("l.wei@meridian-energy.com");
  const omar    = byEmail("o.mansour@meridian-energy.com");
  const junkim  = byEmail("j.kim@meridian-energy.com");
  const raj     = byEmail("r.nair@meridian-energy.com");

  const [bodBoard, facBoard, sicBoard, nrcBoard, tpcBoard] = allBoards;

  for (const { person, role } of [
    { person: nadia,  role: "chairperson" },
    { person: ahmed,  role: "secretary"   },
    { person: sarah,  role: "member"      },
    { person: klaus,  role: "member"      },
    { person: fatima, role: "member"      },
    { person: james,  role: "member"      },
    { person: yuki,   role: "member"      },
    { person: maria,  role: "member"      },
    { person: david,  role: "observer"    },
    { person: amira,  role: "observer"    },
  ]) {
    await db.insert(boardMembershipsTable).values({ boardId: bodBoard.id, personId: person.id, roleInBoard: role }).onConflictDoNothing();
  }

  for (const { person, role } of [
    { person: klaus,  role: "chairperson" },
    { person: fatima, role: "member"      },
    { person: yuki,   role: "member"      },
    { person: maria,  role: "member"      },
    { person: amira,  role: "observer"    },
    { person: laura,  role: "observer"    },
  ]) {
    await db.insert(boardMembershipsTable).values({ boardId: facBoard.id, personId: person.id, roleInBoard: role }).onConflictDoNothing();
  }

  for (const { person, role } of [
    { person: sarah, role: "chairperson" },
    { person: nadia, role: "member"      },
    { person: james, role: "member"      },
    { person: yuki,  role: "member"      },
    { person: liwei, role: "member"      },
    { person: david, role: "observer"    },
  ]) {
    await db.insert(boardMembershipsTable).values({ boardId: sicBoard.id, personId: person.id, roleInBoard: role }).onConflictDoNothing();
  }

  for (const { person, role } of [
    { person: fatima, role: "chairperson" },
    { person: klaus,  role: "member"      },
    { person: nadia,  role: "member"      },
    { person: junkim, role: "observer"    },
  ]) {
    await db.insert(boardMembershipsTable).values({ boardId: nrcBoard.id, personId: person.id, roleInBoard: role }).onConflictDoNothing();
  }

  for (const { person, role } of [
    { person: james,  role: "chairperson" },
    { person: fatima, role: "member"      },
    { person: omar,   role: "member"      },
    { person: raj,    role: "observer"    },
  ]) {
    await db.insert(boardMembershipsTable).values({ boardId: tpcBoard.id, personId: person.id, roleInBoard: role }).onConflictDoNothing();
  }

  for (const board of allBoards) {
    await grantAccess("board", board.id, [ahmed.id]);
  }

  await migratePeopleTitles();
  await migrateAddPasswordResetTokensTable();
  await migrateAddSchemaConstraints();
  logger.info({ peopleCount: allPeople.length, boardsCount: allBoards.length }, "Seeding complete — organisation, people, and boards ready");
}

/**
 * Idempotent migration: create password_reset_tokens table if it doesn't exist.
 * Runs on every startup via CREATE TABLE IF NOT EXISTS.
 */
async function migrateAddPasswordResetTokensTable() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);
    logger.info("migrateAddPasswordResetTokensTable — OK");
  } catch (err) {
    logger.warn({ err }, "migrateAddPasswordResetTokensTable — non-fatal");
  }
}

/**
 * Idempotent migration: if SEED_PASSWORD is set, update all people's password hashes to match.
 * Runs on every startup — allows password resets across environments without manual DB access.
 */
async function migrateUpdatePasswords() {
  if (process.env.NODE_ENV === "production") return;
  const pass = process.env.SEED_PASSWORD;
  if (!pass) return;
  try {
    const hash = await bcrypt.hash(pass, 10);
    const result = await db.execute(sql`UPDATE people SET password_hash = ${hash}`);
    logger.info({ rowCount: (result as any).rowCount ?? "?" }, "migrateUpdatePasswords — passwords synced to SEED_PASSWORD");
  } catch (err) {
    logger.warn({ err }, "migrateUpdatePasswords — non-fatal");
  }
}

/**
 * Idempotent migration: create task_seq sequence (for race-condition-free task number generation)
 * and add unique index on votes.resolution_number.
 */
async function migrateAddSchemaConstraints() {
  try {
    await db.execute(sql`CREATE SEQUENCE IF NOT EXISTS task_seq START 1`);
    logger.info("migrateAddSchemaConstraints — task_seq OK");
  } catch (err) {
    logger.warn({ err }, "migrateAddSchemaConstraints — task_seq non-fatal");
  }
  try {
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS votes_resolution_number_unique
      ON votes(resolution_number)
      WHERE resolution_number IS NOT NULL
    `);
    logger.info("migrateAddSchemaConstraints — votes_resolution_number_unique OK");
  } catch (err) {
    logger.warn({ err }, "migrateAddSchemaConstraints — votes_resolution_number_unique non-fatal");
  }
  try {
    await db.execute(sql`ALTER TABLE votes ADD COLUMN IF NOT EXISTS secret boolean DEFAULT false`);
    logger.info("migrateAddSchemaConstraints — votes.secret OK");
  } catch (err) {
    logger.warn({ err }, "migrateAddSchemaConstraints — votes.secret non-fatal");
  }
}

/**
 * One-time migration: correct people titles that were wrong in earlier seeds.
 * Safe to run repeatedly — only updates rows where the title still has the old value.
 */
async function migratePeopleTitles() {
  const TITLE_FIXES: Array<{ email: string; oldTitles: string[]; newTitle: string }> = [
    { email: "s.chen@meridian-energy.com",     oldTitles: ["Board Director"],        newTitle: "Independent Director"    },
    { email: "f.alhosani@meridian-energy.com", oldTitles: ["Executive Director"],    newTitle: "Non-Executive Director"  },
    { email: "y.tanaka@meridian-energy.com",   oldTitles: ["Board Director"],        newTitle: "Independent Director"    },
    { email: "m.santos@meridian-energy.com",   oldTitles: ["Board Director"],        newTitle: "Non-Executive Director"  },
    { email: "e.rossi@meridian-energy.com",    oldTitles: ["Head of Finance"],       newTitle: "Head of Compliance"      },
    { email: "s.blanc@meridian-energy.com",    oldTitles: ["Chief Risk Officer"],    newTitle: "Head of ESG"             },
  ];

  for (const fix of TITLE_FIXES) {
    const [person] = await db.select().from(peopleTable).where(eq(peopleTable.email, fix.email));
    if (person && fix.oldTitles.includes(person.title || "")) {
      await db.update(peopleTable).set({ title: fix.newTitle }).where(eq(peopleTable.email, fix.email));
      logger.info({ email: fix.email, newTitle: fix.newTitle }, "Migrated person title");
    }
  }
}
