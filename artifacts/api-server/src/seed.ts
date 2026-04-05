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
  approvalRulesTable,
  approvalRuleRequiredVotersTable,
  approvalRuleRecusalsTable,
  approvalRuleWeightsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./lib/logger";

const PASSWORD = "Meridian2024!";

const PEOPLE = [
  { email: "a.alrashid@meridian-energy.com",  name: "Ahmed Al-Rashid",    role: "admin"      as const, title: "Board Secretary",            avatarColor: "#5856d6" },
  { email: "n.petrov@meridian-energy.com",    name: "Nadia Petrov",       role: "member"     as const, title: "Chairperson",                 avatarColor: "#0071e3" },
  { email: "s.chen@meridian-energy.com",      name: "Sarah Chen",         role: "member"     as const, title: "Board Director",              avatarColor: "#34c759" },
  { email: "k.weber@meridian-energy.com",     name: "Dr. Klaus Weber",    role: "member"     as const, title: "Independent Director",        avatarColor: "#ff9500" },
  { email: "f.alhosani@meridian-energy.com",  name: "Fatima Al-Hosani",   role: "member"     as const, title: "Executive Director",          avatarColor: "#ff3b30" },
  { email: "j.obrien@meridian-energy.com",    name: "James O'Brien",      role: "member"     as const, title: "Independent Director",        avatarColor: "#af52de" },
  { email: "y.tanaka@meridian-energy.com",    name: "Yuki Tanaka",        role: "member"     as const, title: "Board Director",              avatarColor: "#ff2d55" },
  { email: "m.santos@meridian-energy.com",    name: "Maria Santos",       role: "member"     as const, title: "Board Director",              avatarColor: "#30b0c7" },
  { email: "d.park@meridian-energy.com",      name: "David Park",         role: "observer"   as const, title: "External Legal Counsel",      avatarColor: "#64d2ff" },
  { email: "a.khalil@meridian-energy.com",    name: "Amira Khalil",       role: "observer"   as const, title: "External Auditor",            avatarColor: "#5ac8fa" },
  { email: "t.henderson@meridian-energy.com", name: "Thomas Henderson",   role: "observer"   as const, title: "Regulatory Advisor",          avatarColor: "#0071e3" },
  { email: "l.martinez@meridian-energy.com",  name: "Laura Martinez",     role: "observer"   as const, title: "External Tax Counsel",        avatarColor: "#34c759" },
  { email: "r.taylor@meridian-energy.com",    name: "Robert Taylor",      role: "management" as const, title: "CFO",                         avatarColor: "#0071e3" },
  { email: "p.sharma@meridian-energy.com",    name: "Priya Sharma",       role: "management" as const, title: "General Counsel",             avatarColor: "#5856d6" },
  { email: "l.wei@meridian-energy.com",       name: "Li Wei",             role: "management" as const, title: "VP Strategy",                 avatarColor: "#34c759" },
  { email: "o.mansour@meridian-energy.com",   name: "Omar Mansour",       role: "management" as const, title: "VP Operations",               avatarColor: "#ff9500" },
  { email: "e.rossi@meridian-energy.com",     name: "Elena Rossi",        role: "management" as const, title: "Head of Finance",             avatarColor: "#ff2d55" },
  { email: "j.kim@meridian-energy.com",       name: "Jun Kim",            role: "management" as const, title: "Head of HR",                  avatarColor: "#30b0c7" },
  { email: "s.blanc@meridian-energy.com",     name: "Sophie Blanc",       role: "management" as const, title: "Chief Risk Officer",          avatarColor: "#af52de" },
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
  await db.delete(agendaItemsTable);
  await db.delete(attendanceTable);
  await db.delete(pendingActionsTable);
  await db.delete(voteRecordsTable);
  await db.delete(approvalRuleWeightsTable);
  await db.delete(approvalRuleRecusalsTable);
  await db.delete(approvalRuleRequiredVotersTable);
  await db.delete(approvalRulesTable);
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

  let allPeople: (typeof peopleTable.$inferSelect)[] = [];
  let allBoards: (typeof boardsTable.$inferSelect)[] = [];

  if (!hasData) {
    await clearAll();

    const [org] = await db.insert(organizationsTable).values({ name: "Meridian Energy Group" }).returning();
    const hash = await bcrypt.hash(PASSWORD, 10);

    for (const p of PEOPLE) {
      const [person] = await db.insert(peopleTable).values({ ...p, passwordHash: hash }).returning();
      allPeople.push(person);
    }

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

    const bodMembers = [
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
    ];
    for (const { person, role } of bodMembers) {
      await db.insert(boardMembershipsTable).values({ boardId: bodBoard.id, personId: person.id, roleInBoard: role }).onConflictDoNothing();
    }

    const facMembers = [
      { person: klaus,  role: "chairperson" },
      { person: fatima, role: "member"      },
      { person: yuki,   role: "member"      },
      { person: maria,  role: "member"      },
      { person: amira,  role: "observer"    },
      { person: laura,  role: "observer"    },
    ];
    for (const { person, role } of facMembers) {
      await db.insert(boardMembershipsTable).values({ boardId: facBoard.id, personId: person.id, roleInBoard: role }).onConflictDoNothing();
    }

    const sicMembers = [
      { person: sarah, role: "chairperson" },
      { person: nadia, role: "member"      },
      { person: james, role: "member"      },
      { person: yuki,  role: "member"      },
      { person: liwei, role: "member"      },
      { person: david, role: "observer"    },
    ];
    for (const { person, role } of sicMembers) {
      await db.insert(boardMembershipsTable).values({ boardId: sicBoard.id, personId: person.id, roleInBoard: role }).onConflictDoNothing();
    }

    const nrcMembers = [
      { person: fatima, role: "chairperson" },
      { person: klaus,  role: "member"      },
      { person: nadia,  role: "member"      },
      { person: junkim, role: "observer"    },
    ];
    for (const { person, role } of nrcMembers) {
      await db.insert(boardMembershipsTable).values({ boardId: nrcBoard.id, personId: person.id, roleInBoard: role }).onConflictDoNothing();
    }

    const tpcMembers = [
      { person: james, role: "chairperson" },
      { person: fatima, role: "member"     },
      { person: omar,  role: "member"      },
      { person: raj,   role: "observer"    },
    ];
    for (const { person, role } of tpcMembers) {
      await db.insert(boardMembershipsTable).values({ boardId: tpcBoard.id, personId: person.id, roleInBoard: role }).onConflictDoNothing();
    }

    for (const board of allBoards) {
      await grantAccess("board", board.id, [ahmed.id]);
    }

    logger.info({ peopleCount: allPeople.length, boardsCount: allBoards.length }, "Core data seeded");
  } else {
    allPeople = await db.select().from(peopleTable);
    allBoards = await db.select().from(boardsTable);
  }

  // Always check if demo data needs to be added
  const existingMeetings = await db.select().from(meetingsTable);
  if (existingMeetings.length > 0) {
    logger.info("Database already seeded with correct data — skipping");
    return;
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
  const robert  = byEmail("r.taylor@meridian-energy.com");
  const priya   = byEmail("p.sharma@meridian-energy.com");
  const raj     = byEmail("r.nair@meridian-energy.com");

  const byAbbr = (abbr: string) => allBoards.find((b) => b.abbreviation === abbr)!;
  const bodBoard = byAbbr("BoD");
  const facBoard = byAbbr("FAC");
  const sicBoard = byAbbr("SIC");

  const bodMemberIds = [nadia.id, sarah.id, klaus.id, fatima.id, james.id, yuki.id, maria.id, david.id, amira.id, ahmed.id];
  const facMemberIds = [klaus.id, fatima.id, yuki.id, maria.id, amira.id];

  // ── MEETINGS ─────────────────────────────────────────────────────────────
  const [meeting1] = await db.insert(meetingsTable).values({
    boardId: bodBoard.id,
    title: "Board of Directors — Q1 2026 Meeting",
    date: new Date("2026-03-15T09:00:00Z"),
    location: "Meridian HQ, Boardroom A",
    status: "completed",
  }).returning();

  await db.insert(agendaItemsTable).values([
    { meetingId: meeting1.id, position: 1, title: "Opening & Quorum Confirmation", type: "information", description: "Chairperson to confirm quorum and open the meeting." },
    { meetingId: meeting1.id, position: 2, title: "Approval of Previous Minutes", type: "decision", description: "Review and approve the minutes of Q4 2025 meeting." },
    { meetingId: meeting1.id, position: 3, title: "CFO Report — Q4 2025 Financial Results", type: "information", description: "Robert Taylor to present the Q4 2025 financial results including revenue, EBITDA, and cash flow." },
    { meetingId: meeting1.id, position: 4, title: "Annual Budget 2026 Approval", type: "decision", description: "Approve the annual budget for FY2026 as presented by the CFO." },
    { meetingId: meeting1.id, position: 5, title: "Strategic Investment — Al Dhafra Solar Phase II", type: "decision", description: "Approve the capital expenditure of AED 2.4B for the Al Dhafra Solar project Phase II." },
    { meetingId: meeting1.id, position: 6, title: "Any Other Business", type: "discussion", description: "" },
  ]);

  await db.insert(attendanceTable).values(bodMemberIds.map(id => ({ meetingId: meeting1.id, personId: id, status: "attended" as const }))).onConflictDoNothing();
  await grantAccess("meeting", meeting1.id, bodMemberIds);

  const [meeting2] = await db.insert(meetingsTable).values({
    boardId: bodBoard.id,
    title: "Board of Directors — Q2 2026 Meeting",
    date: new Date("2026-06-15T09:00:00Z"),
    location: "Meridian HQ, Boardroom A",
    status: "scheduled",
  }).returning();

  await db.insert(agendaItemsTable).values([
    { meetingId: meeting2.id, position: 1, title: "Opening & Quorum Confirmation", type: "information" },
    { meetingId: meeting2.id, position: 2, title: "Q1 2026 Financial Review", type: "information", description: "CFO to present Q1 2026 financial performance." },
    { meetingId: meeting2.id, position: 3, title: "Dividend Policy Review", type: "decision", description: "Review and ratify the updated dividend distribution policy." },
    { meetingId: meeting2.id, position: 4, title: "CEO Performance Assessment", type: "discussion", description: "NRC to present the CEO's annual performance review." },
  ]);

  await db.insert(attendanceTable).values(bodMemberIds.map(id => ({ meetingId: meeting2.id, personId: id, status: "pending" as const }))).onConflictDoNothing();
  await grantAccess("meeting", meeting2.id, bodMemberIds);

  const [meeting3] = await db.insert(meetingsTable).values({
    boardId: facBoard.id,
    title: "Finance & Audit Committee — Q1 2026 Review",
    date: new Date("2026-04-10T10:00:00Z"),
    location: "Meridian HQ, Conference Room 3",
    status: "scheduled",
  }).returning();

  await db.insert(agendaItemsTable).values([
    { meetingId: meeting3.id, position: 1, title: "External Audit Update", type: "information", description: "KPMG to present progress on the 2025 annual audit." },
    { meetingId: meeting3.id, position: 2, title: "Internal Controls Assessment", type: "discussion", description: "Review the internal controls report." },
    { meetingId: meeting3.id, position: 3, title: "Appointment of External Auditor", type: "decision", description: "Approve appointment of external auditor for FY2026." },
  ]);

  await grantAccess("meeting", meeting3.id, facMemberIds);

  // ── VOTES ─────────────────────────────────────────────────────────────────
  const year = new Date().getFullYear();

  const [vote1] = await db.insert(votesTable).values({
    boardId: bodBoard.id,
    meetingId: meeting2.id,
    resolutionNumber: `RES-BOD-${year}-001`,
    title: "Approval of Annual Budget FY2026",
    resolutionText: "RESOLVED THAT the Board of Directors hereby approves the Annual Budget for the financial year 2026 as presented by the Chief Financial Officer, with total approved expenditure of AED 8.4 billion and a revenue target of AED 12.2 billion.",
    type: "circulation",
    status: "open",
    deadline: new Date("2026-06-01T23:59:59Z"),
  }).returning();

  const [rule1] = await db.insert(approvalRulesTable).values({
    voteId: vote1.id, type: "majority", deadlineBehavior: "lapse", weighted: false,
  }).returning();

  await grantAccess("vote", vote1.id, bodMemberIds);

  const [vote2] = await db.insert(votesTable).values({
    boardId: bodBoard.id,
    resolutionNumber: `RES-BOD-${year}-002`,
    title: "Approval of Al Dhafra Solar Phase II Investment",
    resolutionText: "RESOLVED THAT the Board of Directors hereby approves the capital investment of AED 2.4 billion for the Al Dhafra Solar Phase II project, as detailed in the Investment Proposal dated 1 March 2026, subject to compliance with the approved financing plan.",
    type: "meeting",
    status: "approved",
    closedAt: new Date("2026-03-15T11:30:00Z"),
  }).returning();

  await db.insert(approvalRulesTable).values({ voteId: vote2.id, type: "unanimous", deadlineBehavior: "notify", weighted: false }).returning();
  await grantAccess("vote", vote2.id, bodMemberIds);

  await db.insert(voteRecordsTable).values([
    { voteId: vote2.id, personId: nadia.id, decision: "approved", votedAt: new Date("2026-03-15T10:05:00Z") },
    { voteId: vote2.id, personId: sarah.id, decision: "approved", votedAt: new Date("2026-03-15T10:10:00Z") },
    { voteId: vote2.id, personId: klaus.id, decision: "approved", votedAt: new Date("2026-03-15T10:15:00Z") },
    { voteId: vote2.id, personId: fatima.id, decision: "approved", votedAt: new Date("2026-03-15T10:20:00Z") },
    { voteId: vote2.id, personId: james.id, decision: "approved_with_comments", comment: "Excellent project. Please ensure the environmental impact assessment is finalized before Q3.", votedAt: new Date("2026-03-15T10:25:00Z") },
    { voteId: vote2.id, personId: yuki.id, decision: "approved", votedAt: new Date("2026-03-15T10:30:00Z") },
    { voteId: vote2.id, personId: maria.id, decision: "approved", votedAt: new Date("2026-03-15T10:35:00Z") },
  ]);

  const [vote3] = await db.insert(votesTable).values({
    boardId: facBoard.id,
    meetingId: meeting3.id,
    resolutionNumber: `RES-FAC-${year}-001`,
    title: "Appointment of KPMG as External Auditor FY2026",
    resolutionText: "RESOLVED THAT the Finance & Audit Committee recommends the re-appointment of KPMG Lower Gulf as the external auditor of Meridian Energy Group for the financial year ending 31 December 2026, at the agreed fee of AED 2.8 million.",
    type: "meeting",
    status: "open",
    deadline: new Date("2026-04-20T23:59:59Z"),
  }).returning();

  await db.insert(approvalRulesTable).values({ voteId: vote3.id, type: "two_thirds", deadlineBehavior: "lapse", weighted: false });
  await grantAccess("vote", vote3.id, facMemberIds);

  // ── MINUTES ──────────────────────────────────────────────────────────────
  const minutesContent = `<h1>Minutes of the Board of Directors — Q1 2026 Meeting</h1>

<p><strong>Date:</strong> Sunday, 15 March 2026 at 9:00 AM<br/>
<strong>Location:</strong> Meridian HQ, Boardroom A, Abu Dhabi<br/>
<strong>Chairperson:</strong> Nadia Petrov</p>

<h2>1. Opening &amp; Quorum Confirmation</h2>
<p>The Chairperson, Nadia Petrov, called the meeting to order at 09:07 AM and confirmed that quorum was present with seven of seven voting members in attendance, in addition to the Board Secretary, Ahmed Al-Rashid.</p>

<h2>2. Approval of Previous Minutes</h2>
<p>The minutes of the Q4 2025 Board of Directors meeting held on 15 December 2025 were reviewed. There being no amendments, the minutes were approved unanimously.</p>

<h2>3. CFO Report — Q4 2025 Financial Results</h2>
<p>Robert Taylor, CFO, presented the Q4 2025 financial results. Revenue for the quarter was AED 3.1 billion, representing a 12% increase year-on-year. EBITDA margin was maintained at 38%. The Board noted the strong performance and requested a detailed variance analysis to be circulated within 14 days.</p>

<p><strong>ACTION:</strong> Robert Taylor to circulate Q4 2025 variance analysis to all Board members by 29 March 2026.</p>

<h2>4. Annual Budget 2026 Approval</h2>
<p>The proposed Annual Budget for FY2026 was presented, reflecting a total approved expenditure of AED 8.4 billion and a revenue target of AED 12.2 billion. After discussion, the Board resolved to approve the budget as presented.</p>

<p><em>RESOLVED THAT the Board of Directors hereby approves the Annual Budget for FY2026 as presented. — Approved unanimously.</em></p>

<h2>5. Strategic Investment — Al Dhafra Solar Phase II</h2>
<p>The Board reviewed the Investment Proposal for Al Dhafra Solar Phase II. James O'Brien noted that the environmental impact assessment should be finalized before Q3. The Board approved the investment subject to completion of the EIA.</p>

<p><strong>ACTION:</strong> Priya Sharma to confirm receipt of the executed EIA certification and report to the Board by 30 June 2026.</p>

<p><em>RESOLVED THAT the Board approves the capital investment of AED 2.4 billion for Al Dhafra Solar Phase II. — Approved (6 Approved, 1 Approved with Comments).</em></p>

<h2>6. Any Other Business</h2>
<p>The Chairperson reminded all Board members of the upcoming Strategy Day scheduled for 20 April 2026. There being no further business, the meeting was adjourned at 11:45 AM.</p>

<p><em>Signed by the Board Secretary, Ahmed Al-Rashid.</em></p>`;

  const [minutes1] = await db.insert(minutesTable).values({
    meetingId: meeting1.id,
    content: minutesContent,
    status: "review",
  }).returning();

  await grantAccess("minutes", minutes1.id, bodMemberIds);

  await db.insert(minutesSuggestionsTable).values({
    minutesId: minutes1.id,
    personId: james.id,
    type: "comment",
    originalText: "Robert Taylor to circulate Q4 2025 variance analysis",
    commentText: "Please also include the regional breakdown — this was discussed but not captured.",
    status: "pending",
    color: "#af52de",
  });

  const [minutes2] = await db.insert(minutesTable).values({
    meetingId: meeting3.id,
    content: `<h1>Minutes of the FAC — Q1 2026 Review</h1><p><strong>Date:</strong> 10 April 2026 at 10:00 AM</p><h2>1. External Audit Update</h2><p>KPMG presented progress on the 2025 annual audit. Fieldwork is 85% complete. Management letter expected by 30 April 2026.</p><h2>2. Internal Controls Assessment</h2><p>The internal controls report was reviewed. Two medium-risk findings were noted relating to procurement approval thresholds. Management to address by 30 June 2026.</p><p><strong>ACTION:</strong> Omar Mansour to submit updated procurement approval policy to FAC by 30 June 2026.</p><h2>3. Appointment of External Auditor</h2><p>The Committee recommends re-appointment of KPMG for FY2026 at the agreed fee of AED 2.8 million.</p>`,
    status: "signing",
  }).returning();

  await grantAccess("minutes", minutes2.id, facMemberIds);

  await db.insert(minutesSignaturesTable).values({
    minutesId: minutes2.id,
    personId: klaus.id,
    signatureHash: "a3f9e2b1c8d7f6a4e9b3c2d1f8a7e6b5d4c3f2a1e9b8c7d6f5a4e3b2c1d9f8a7",
    signedAt: new Date("2026-04-11T09:15:00Z"),
  });

  // ── TASKS ─────────────────────────────────────────────────────────────────
  const [task1] = await db.insert(tasksTable).values({
    taskNumber: `TASK-${year}-001`,
    title: "Prepare Q4 2025 Financial Variance Analysis",
    description: "Prepare and circulate the detailed Q4 2025 variance analysis to all Board members, including regional breakdown by business unit.",
    assigneeId: robert.id,
    sourceMeetingId: meeting1.id,
    sourceParagraph: "Robert Taylor to circulate Q4 2025 variance analysis to all Board members by 29 March 2026.",
    dueDate: "2026-03-29",
    status: "in_progress",
    aiExtracted: true,
  }).returning();

  await grantAccess("task", task1.id, [robert.id, ahmed.id]);

  const [task2] = await db.insert(tasksTable).values({
    taskNumber: `TASK-${year}-002`,
    title: "Confirm EIA Certification for Al Dhafra Solar Phase II",
    description: "Obtain and confirm receipt of the executed Environmental Impact Assessment certification for the Al Dhafra Solar Phase II project and report to the Board by 30 June 2026.",
    assigneeId: priya.id,
    sourceMeetingId: meeting1.id,
    sourceParagraph: "Priya Sharma to confirm receipt of the executed EIA certification and report to the Board by 30 June 2026.",
    dueDate: "2026-06-30",
    status: "in_progress",
    aiExtracted: true,
  }).returning();

  await grantAccess("task", task2.id, [priya.id, ahmed.id]);

  const [task3] = await db.insert(tasksTable).values({
    taskNumber: `TASK-${year}-003`,
    title: "Submit Updated Procurement Approval Policy",
    description: "Prepare and submit the updated procurement approval policy to the Finance & Audit Committee, addressing the two medium-risk findings from the internal controls review.",
    assigneeId: robert.id,
    sourceMeetingId: meeting3.id,
    dueDate: "2026-06-30",
    status: "in_progress",
    aiExtracted: true,
  }).returning();

  await grantAccess("task", task3.id, [robert.id, ahmed.id]);

  const [task4] = await db.insert(tasksTable).values({
    taskNumber: `TASK-${year}-004`,
    title: "Technology Roadmap 2026-2028",
    description: "Prepare a comprehensive technology roadmap for Meridian Energy Group covering 2026-2028, including digital transformation initiatives and cybersecurity investments.",
    assigneeId: raj.id,
    dueDate: "2026-05-15",
    status: "in_progress",
    aiExtracted: false,
  }).returning();

  await grantAccess("task", task4.id, [raj.id, ahmed.id]);

  logger.info("Demo data seeded: meetings, votes, minutes, tasks");
}
