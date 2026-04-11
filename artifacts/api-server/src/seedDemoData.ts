import crypto from "crypto";
import {
  db,
  boardsTable,
  peopleTable,
  meetingsTable,
  votesTable,
  voteRecordsTable,
  voteDocumentsTable,
  minutesTable,
  minutesSignaturesTable,
  documentsTable,
  agendaItemsTable,
  agendaDocumentsTable,
  tasksTable,
  accessControlTable,
  approvalRulesTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./lib/logger";

async function grantAccess(entityType: string, entityId: string, personIds: string[]) {
  for (const personId of personIds) {
    await db.insert(accessControlTable)
      .values({ entityType, entityId, personId, hasAccess: true })
      .onConflictDoNothing();
  }
}

async function revokeAccess(entityType: string, entityId: string, personId: string) {
  await db.insert(accessControlTable)
    .values({ entityType, entityId, personId, hasAccess: false })
    .onConflictDoNothing();
}

export async function seedDemoData() {
  const [{ count: voteCount }] = await db.select({ count: sql<number>`count(*)` }).from(votesTable);
  if (Number(voteCount) > 0) {
    logger.info("Demo data already exists — skipping seedDemoData");
    return;
  }

  logger.info("Seeding rich demo data...");

  const people = await db.select().from(peopleTable);
  const boards = await db.select().from(boardsTable);

  const byEmail = (email: string) => people.find((p) => p.email === email)!;
  const byAbbr = (abbr: string) => boards.find((b) => b.abbreviation === abbr)!;

  const ahmed  = byEmail("a.alrashid@meridian-energy.com");
  const nadia  = byEmail("n.petrov@meridian-energy.com");
  const sarah  = byEmail("s.chen@meridian-energy.com");
  const klaus  = byEmail("k.weber@meridian-energy.com");
  const fatima = byEmail("f.alhosani@meridian-energy.com");
  const james  = byEmail("j.obrien@meridian-energy.com");
  const yuki   = byEmail("y.tanaka@meridian-energy.com");
  const maria  = byEmail("m.santos@meridian-energy.com");
  const david  = byEmail("d.park@meridian-energy.com");
  const robert = byEmail("r.taylor@meridian-energy.com");

  const bod = byAbbr("BoD");
  const fac = byAbbr("FAC");
  const sic = byAbbr("SIC");
  const nrc = byAbbr("NRC");
  const tpc = byAbbr("TPC");

  const allPeopleIds = people.map((p) => p.id);
  const bodMembers = [nadia, sarah, klaus, fatima, james, yuki, maria];
  const facMembers = [klaus, fatima, yuki, maria];
  const sicMembers = [sarah, nadia, james, yuki];
  const nrcMembers = [fatima, klaus, nadia];
  const tpcMembers = [james, fatima];

  const d = (m: number, day: number, h = 10) => new Date(2026, m - 1, day, h, 0, 0);

  // ── MEETINGS (20) ──
  const MEETINGS_DEF = [
    { board: bod, title: "BoD Q4 2025 Review", date: d(1, 15), status: "concluded" as const, agendaItems: ["FY2025 Annual Results Presentation", "2026 Strategic Plan Approval", "CEO Performance Review", "Dividend Policy Discussion"] },
    { board: bod, title: "BoD Extraordinary — SolarTech Acquisition", date: d(2, 3), status: "concluded" as const, agendaItems: ["SolarTech LOI Presentation", "Due Diligence Scope Approval", "Conflict of Interest Declarations", "Financing Structure Review"] },
    { board: bod, title: "BoD Q1 2026 Review", date: d(3, 20), status: "concluded" as const, agendaItems: ["Q1 Financial Performance", "Kazakhstan Wind Project Milestone Update", "Africa Pipeline Review", "Regulatory Compliance Report"] },
    { board: bod, title: "BoD Extraordinary — Related Party Transaction", date: d(3, 28), status: "concluded" as const, agendaItems: ["Al-Rashid Family Entity Disclosure", "Independent Review Report", "Board Recusal Procedures", "Voting on Related Party Contract"] },
    { board: bod, title: "BoD Strategy Day", date: d(4, 5), status: "scheduled" as const, agendaItems: ["5-Year Capital Allocation Framework", "Market Entry Priorities — Greece, Spain, Morocco", "Competitive Landscape Analysis", "Technology Roadmap 2026–2030"] },
    { board: bod, title: "BoD Q2 2026 Review", date: d(4, 15), status: "scheduled" as const, agendaItems: ["Q2 Outlook and Guidance", "SolarTech Integration Plan", "ESG Rating Update", "Board Effectiveness Self-Assessment"] },
    { board: fac, title: "FAC Annual Audit Planning", date: d(1, 22), status: "concluded" as const, agendaItems: ["2025 Audit Completion Summary", "2026 Audit Plan Approval", "Risk Register Review", "Internal Controls Assessment"] },
    { board: fac, title: "FAC Q1 Financial Review", date: d(2, 18), status: "concluded" as const, agendaItems: ["Q1 Interim Results", "Impairment Testing — Africa Assets", "Forex Exposure Analysis", "Debt Covenant Compliance"] },
    { board: fac, title: "FAC External Auditor Assessment", date: d(3, 10), status: "concluded" as const, agendaItems: ["PwC Performance Review", "Auditor Independence Confirmation", "Fee Benchmarking Analysis", "Rotation Policy Discussion"] },
    { board: fac, title: "FAC Budget Variance Deep Dive", date: d(4, 8), status: "scheduled" as const, agendaItems: ["H1 Budget vs Actual", "Capex Overruns Analysis", "Procurement Savings Report", "Revised Forecast Approval"] },
    { board: sic, title: "SIC Kazakhstan Wind FID", date: d(1, 28), status: "concluded" as const, agendaItems: ["Final Investment Decision Package", "EPC Contract Review", "PPA Terms and Conditions", "Sovereign Guarantee and Local Content"] },
    { board: sic, title: "SIC Africa Expansion Review", date: d(2, 25), status: "concluded" as const, agendaItems: ["Kenya 500MW Solar Feasibility", "Ethiopia Grid Connection Study", "DFI Co-Financing Options", "Political Risk Assessment"] },
    { board: sic, title: "SIC SolarTech Due Diligence", date: d(3, 15), status: "scheduled" as const, agendaItems: ["Technical DD Findings", "IP Portfolio Valuation", "Customer Concentration Risk", "Earn-out Structure Proposal"] },
    { board: sic, title: "SIC European Portfolio Optimization", date: d(4, 2), status: "scheduled" as const, agendaItems: ["Greece Wind Portfolio Performance", "Spain PV Repowering Plan", "Green Bond Eligibility", "Carbon Credit Monetization"] },
    { board: nrc, title: "NRC Annual Board Evaluation", date: d(1, 30), status: "concluded" as const, agendaItems: ["Board Skills Matrix Review", "Independence Assessment", "Diversity Metrics Report", "Succession Planning Update"] },
    { board: nrc, title: "NRC CEO Compensation Review", date: d(2, 28), status: "concluded" as const, agendaItems: ["2025 Bonus Determination", "2026 KPI Framework", "Peer Group Benchmarking", "Long-Term Incentive Plan Proposal"] },
    { board: nrc, title: "NRC Board Renewal Planning", date: d(3, 25), status: "scheduled" as const, agendaItems: ["Director Term Expiry Tracker", "Candidate Pipeline Review", "Committee Rotation Plan", "Observer Role Assessment"] },
    { board: tpc, title: "TPC Digital Transformation Kickoff", date: d(2, 10), status: "concluded" as const, agendaItems: ["AI Integration Roadmap Presentation", "EasyBoard Pilot Results", "Cybersecurity Maturity Assessment", "Data Governance Framework"] },
    { board: tpc, title: "TPC Project Delivery Review", date: d(3, 5), status: "scheduled" as const, agendaItems: ["Kazakhstan EPC Milestone Tracker", "Africa Site Acquisition Status", "SolarTech IT Integration Plan", "SCADA System Upgrades"] },
    { board: tpc, title: "TPC Innovation Lab Proposals", date: d(4, 12), status: "scheduled" as const, agendaItems: ["Predictive Maintenance AI", "Digital Twin Pilot Proposal", "Drone Inspection Program", "Blockchain for Carbon Credits"] },
  ];

  const meetings: (typeof meetingsTable.$inferSelect)[] = [];
  for (let i = 0; i < MEETINGS_DEF.length; i++) {
    const m = MEETINGS_DEF[i];
    const [meeting] = await db.insert(meetingsTable).values({
      boardId: m.board.id,
      title: m.title,
      date: m.date,
      location: "Meridian Tower, Abu Dhabi",
      status: m.status,
    }).returning();
    meetings.push(meeting);

    for (let j = 0; j < m.agendaItems.length; j++) {
      await db.insert(agendaItemsTable).values({
        meetingId: meeting.id,
        position: j + 1,
        title: m.agendaItems[j],
        type: j === m.agendaItems.length - 1 ? "decision" : j === 0 ? "information" : "discussion",
      });
    }

    await grantAccess("meeting", meeting.id, allPeopleIds);
    if ((i + 1) % 5 === 0) logger.info(`Seeding demo data... meetings ${i + 1}/20 complete`);
  }
  logger.info("Seeding demo data... all 20 meetings created");

  // ── DOCUMENTS (20) ──
  const DOCS_DEF = [
    { title: "FY2025 Audited Financial Statements", filename: "FY2025-Audited-Financial-Statements.pdf", board: bod, classification: "financial_report" },
    { title: "2026 Annual Budget — Board Pack", filename: "2026-Annual-Budget-Board-Pack.pdf", board: bod, classification: "financial_report" },
    { title: "SolarTech LOI — Draft v3", filename: "SolarTech-LOI-Draft-v3.pdf", board: bod, classification: "resolution" },
    { title: "SolarTech Technical DD Report", filename: "SolarTech-Technical-DD-Report.pdf", board: sic, classification: "general" },
    { title: "SolarTech IP Valuation Summary", filename: "SolarTech-IP-Valuation-Summary.pdf", board: sic, classification: "general" },
    { title: "CEO Performance Scorecard 2025", filename: "CEO-Performance-Scorecard-2025.pdf", board: bod, classification: "general" },
    { title: "Kazakhstan Wind FID Package", filename: "Kazakhstan-Wind-FID-Package.pdf", board: sic, classification: "general" },
    { title: "Kazakhstan EPC Contract Summary", filename: "Kazakhstan-EPC-Contract-Summary.pdf", board: sic, classification: "legal_opinion" },
    { title: "Kazakhstan PPA Term Sheet", filename: "Kazakhstan-PPA-Term-Sheet.pdf", board: sic, classification: "general" },
    { title: "Kenya 500MW Feasibility Study", filename: "Kenya-500MW-Feasibility-Study.pdf", board: sic, classification: "general" },
    { title: "Africa Political Risk Assessment", filename: "Africa-Political-Risk-Assessment.pdf", board: sic, classification: "general" },
    { title: "PwC Engagement Proposal 2026", filename: "PwC-Engagement-Proposal-2026.pdf", board: fac, classification: "general" },
    { title: "Risk Appetite Statement 2026", filename: "Risk-Appetite-Statement-2026.pdf", board: fac, classification: "resolution" },
    { title: "Board Skills Matrix 2026", filename: "Board-Skills-Matrix-2026.pdf", board: nrc, classification: "general" },
    { title: "Director Independence Assessment", filename: "Director-Independence-Assessment.pdf", board: nrc, classification: "general" },
    { title: "Remuneration Policy Markup", filename: "Remuneration-Policy-Markup.pdf", board: nrc, classification: "resolution" },
    { title: "AI Integration Roadmap v2", filename: "AI-Integration-Roadmap-v2.pdf", board: tpc, classification: "general" },
    { title: "Cybersecurity Maturity Report", filename: "Cybersecurity-Maturity-Report.pdf", board: tpc, classification: "general" },
    { title: "Related Party Transaction Disclosure", filename: "Related-Party-Transaction-Disclosure.pdf", board: bod, classification: "legal_opinion" },
    { title: "Q1 2026 Interim Financial Report", filename: "Q1-2026-Interim-Financial-Report.pdf", board: bod, classification: "financial_report" },
  ];

  const docs: (typeof documentsTable.$inferSelect)[] = [];
  for (const dd of DOCS_DEF) {
    const [doc] = await db.insert(documentsTable).values({
      boardId: dd.board.id,
      title: dd.title,
      filename: dd.filename,
      filePath: `uploads/${dd.filename}`,
      fileSize: 1024 * (50 + Math.floor(Math.random() * 200)),
      mimeType: "application/pdf",
      aiClassification: { type: dd.classification },
      uploadedBy: ahmed.id,
    }).returning();
    docs.push(doc);
    await grantAccess("document", doc.id, allPeopleIds);
  }
  logger.info("Seeding demo data... all 20 documents created");

  // ── Link documents to meetings via agenda_documents ──
  const docMeetingLinks: [number, number[]][] = [
    [0,  [0]],         // Doc 1 → Meeting 1
    [1,  [0]],         // Doc 2 → Meeting 1
    [2,  [1, 12]],     // Doc 3 → Meeting 2, 13
    [3,  [12]],        // Doc 4 → Meeting 13
    [4,  [12]],        // Doc 5 → Meeting 13
    [5,  [0, 15]],     // Doc 6 → Meeting 1, 16
    [6,  [10]],        // Doc 7 → Meeting 11
    [7,  [10]],        // Doc 8 → Meeting 11
    [8,  [10]],        // Doc 9 → Meeting 11
    [9,  [11]],        // Doc 10 → Meeting 12
    [10, [11]],        // Doc 11 → Meeting 12
    [11, [8]],         // Doc 12 → Meeting 9
    [12, [6]],         // Doc 13 → Meeting 7
    [13, [14]],        // Doc 14 → Meeting 15
    [14, [14]],        // Doc 15 → Meeting 15
    [15, [15]],        // Doc 16 → Meeting 16
    [16, [17]],        // Doc 17 → Meeting 18
    [17, [17]],        // Doc 18 → Meeting 18
    [18, [3]],         // Doc 19 → Meeting 4
    [19, [2, 7]],      // Doc 20 → Meeting 3, 8
  ];

  for (const [docIdx, meetingIdxs] of docMeetingLinks) {
    for (const mIdx of meetingIdxs) {
      const agendaItems = await db.select().from(agendaItemsTable)
        .where(eq(agendaItemsTable.meetingId, meetings[mIdx].id));
      if (agendaItems.length > 0) {
        const target = agendaItems[Math.min(docIdx % agendaItems.length, agendaItems.length - 1)];
        await db.insert(agendaDocumentsTable).values({
          agendaItemId: target.id,
          documentId: docs[docIdx].id,
        }).onConflictDoNothing();
      }
    }
  }
  logger.info("Seeding demo data... document-meeting links created");

  // ── VOTES (18) ──
  function certHash(voteId: string, records: { personId: string; decision: string }[]) {
    const sorted = [...records].sort((a, b) => a.personId.localeCompare(b.personId));
    const payload = JSON.stringify({ voteId, records: sorted });
    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  const VOTES_DEF: {
    board: typeof bod;
    meetingIdx: number | null;
    title: string;
    resNum: string;
    type: string;
    ruleType: string;
    status: string;
    secret: boolean;
    voters: { person: typeof ahmed; decision: string; comment?: string }[];
    docIdxs: number[];
  }[] = [
    { board: bod, meetingIdx: 0, title: "Approval of FY2025 Audited Financial Statements", resNum: "RES-BOD-2026-001", type: "meeting", ruleType: "unanimous", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved" }, { person: fatima, decision: "approved" },
      ], docIdxs: [0] },
    { board: bod, meetingIdx: 0, title: "2026 Annual Budget and Capital Allocation Plan", resNum: "RES-BOD-2026-002", type: "meeting", ruleType: "two_thirds", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved_with_comments", comment: "Recommend 10% contingency on Kazakhstan capex" },
        { person: fatima, decision: "approved" },
      ], docIdxs: [1] },
    { board: bod, meetingIdx: 1, title: "SolarTech Ltd — Authorization to Execute Non-Binding LOI", resNum: "RES-BOD-2026-003", type: "circulation", ruleType: "unanimous", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved" }, { person: fatima, decision: "approved" },
      ], docIdxs: [2] },
    { board: bod, meetingIdx: 0, title: "CEO Performance Rating — FY2025", resNum: "RES-BOD-2026-004", type: "meeting", ruleType: "majority", status: "approved", secret: true,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved" }, { person: fatima, decision: "not_approved" },
      ], docIdxs: [5] },
    { board: bod, meetingIdx: 0, title: "Dividend Distribution — Q4 2025 ($0.35/share)", resNum: "RES-BOD-2026-005", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved" }, { person: fatima, decision: "approved" },
      ], docIdxs: [] },
    { board: bod, meetingIdx: 3, title: "Related Party Transaction — Al-Rashid Industrial Services Contract", resNum: "RES-BOD-2026-006", type: "meeting", ruleType: "unanimous", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved" },
      ], docIdxs: [18] },
    { board: bod, meetingIdx: null, title: "Board Committee Restructuring — Merge TPC into SIC", resNum: "RES-BOD-2026-007", type: "circulation", ruleType: "two_thirds", status: "open", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
      ], docIdxs: [] },
    { board: fac, meetingIdx: 8, title: "Appointment of PwC as External Auditor — 3 Year Term", resNum: "RES-FAC-2026-001", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: klaus, decision: "approved" }, { person: fatima, decision: "approved" },
        { person: yuki, decision: "approved_with_comments", comment: "Include mid-term performance review clause" },
        { person: maria, decision: "approved" },
      ], docIdxs: [11] },
    { board: fac, meetingIdx: null, title: "Write-off of Receivables > $500K (Africa Operations)", resNum: "RES-FAC-2026-002", type: "circulation", ruleType: "unanimous", status: "rejected", secret: false,
      voters: [
        { person: klaus, decision: "approved" }, { person: fatima, decision: "approved" },
        { person: yuki, decision: "not_approved" }, { person: maria, decision: "not_approved_with_comments", comment: "Insufficient documentation for Kenya receivables" },
      ], docIdxs: [] },
    { board: fac, meetingIdx: 6, title: "Revised Risk Appetite Statement — 2026", resNum: "RES-FAC-2026-003", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: klaus, decision: "approved" }, { person: fatima, decision: "approved" },
        { person: yuki, decision: "approved" }, { person: maria, decision: "approved" },
      ], docIdxs: [12] },
    { board: sic, meetingIdx: 10, title: "Kazakhstan 1GW Wind — Final Investment Decision ($1.2B)", resNum: "RES-SIC-2026-001", type: "meeting", ruleType: "two_thirds", status: "approved", secret: false,
      voters: [
        { person: sarah, decision: "approved" }, { person: nadia, decision: "approved" },
        { person: james, decision: "approved" }, { person: yuki, decision: "approved" },
      ], docIdxs: [6] },
    { board: sic, meetingIdx: 11, title: "Kenya 500MW Solar — Proceed to Detailed Feasibility", resNum: "RES-SIC-2026-002", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: sarah, decision: "approved" }, { person: nadia, decision: "approved" },
        { person: james, decision: "approved_with_comments", comment: "Require independent political risk assessment before final commitment" },
        { person: yuki, decision: "approved" },
      ], docIdxs: [9] },
    { board: sic, meetingIdx: null, title: "SolarTech Acquisition — Binding Offer at $340M Enterprise Value", resNum: "RES-SIC-2026-003", type: "circulation", ruleType: "unanimous", status: "open", secret: false,
      voters: [
        { person: sarah, decision: "approved" },
      ], docIdxs: [3] },
    { board: sic, meetingIdx: 13, title: "Greece Wind Portfolio — Green Bond Refinancing", resNum: "RES-SIC-2026-004", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: sarah, decision: "approved" }, { person: nadia, decision: "approved" },
        { person: james, decision: "approved" }, { person: yuki, decision: "approved" },
      ], docIdxs: [] },
    { board: nrc, meetingIdx: 15, title: "CEO 2025 Bonus — 140% of Target", resNum: "RES-NRC-2026-001", type: "meeting", ruleType: "majority", status: "approved", secret: true,
      voters: [
        { person: fatima, decision: "approved" }, { person: klaus, decision: "approved" },
        { person: nadia, decision: "approved" },
      ], docIdxs: [] },
    { board: nrc, meetingIdx: 15, title: "Updated Board Remuneration Policy — Effective 2026", resNum: "RES-NRC-2026-002", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: fatima, decision: "approved" }, { person: klaus, decision: "approved" },
        { person: nadia, decision: "not_approved_with_comments", comment: "Variable compensation cap at 150% of base" },
      ], docIdxs: [15] },
    { board: tpc, meetingIdx: 17, title: "AI Integration Roadmap — Phase 1 Budget ($2.5M)", resNum: "RES-TPC-2026-001", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: james, decision: "approved" }, { person: fatima, decision: "approved" },
      ], docIdxs: [16] },
    { board: tpc, meetingIdx: null, title: "Cybersecurity Maturity — Engage CrowdStrike for Assessment", resNum: "RES-TPC-2026-002", type: "circulation", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: james, decision: "approved" }, { person: fatima, decision: "approved" },
      ], docIdxs: [17] },
  ];

  const voteRecords: (typeof votesTable.$inferSelect)[] = [];

  for (let i = 0; i < VOTES_DEF.length; i++) {
    const v = VOTES_DEF[i];
    const closedAt = (v.status === "approved" || v.status === "rejected") ? d(4, 1) : null;
    const records = v.voters.map((vr) => ({ personId: vr.person.id, decision: vr.decision }));
    const hash = closedAt ? certHash(crypto.randomUUID(), records) : null;

    const [vote] = await db.insert(votesTable).values({
      boardId: v.board.id,
      meetingId: v.meetingIdx !== null ? meetings[v.meetingIdx].id : null,
      title: v.title,
      resolutionNumber: v.resNum,
      resolutionText: `Resolution: ${v.title}`,
      type: v.type as any,
      status: v.status as any,
      secret: v.secret,
      deadline: d(4, 30),
      certificateHash: hash,
      closedAt,
    }).returning();
    voteRecords.push(vote);

    await db.insert(approvalRulesTable).values({
      voteId: vote.id,
      type: v.ruleType as any,
    }).onConflictDoNothing();

    for (const vr of v.voters) {
      await db.insert(voteRecordsTable).values({
        voteId: vote.id,
        personId: vr.person.id,
        decision: vr.decision as any,
        comment: vr.comment || null,
      }).onConflictDoNothing();
    }

    for (const docIdx of v.docIdxs) {
      await db.insert(voteDocumentsTable).values({
        voteId: vote.id,
        title: docs[docIdx].title,
        filename: docs[docIdx].filename,
        filePath: docs[docIdx].filePath,
        uploadedBy: ahmed.id,
      });
    }

    await grantAccess("vote", vote.id, allPeopleIds);

    if ((i + 1) % 6 === 0) logger.info(`Seeding demo data... votes ${i + 1}/18 complete`);
  }
  logger.info("Seeding demo data... all 18 votes created");

  // ── MINUTES (12) ──
  const minutesDef: { meetingIdx: number; status: "signed" | "review" | "draft" }[] = [
    { meetingIdx: 0,  status: "signed" },
    { meetingIdx: 1,  status: "signed" },
    { meetingIdx: 2,  status: "review" },
    { meetingIdx: 3,  status: "draft" },
    { meetingIdx: 6,  status: "signed" },
    { meetingIdx: 7,  status: "signed" },
    { meetingIdx: 8,  status: "review" },
    { meetingIdx: 9,  status: "draft" },
    { meetingIdx: 10, status: "signed" },
    { meetingIdx: 11, status: "review" },
    { meetingIdx: 14, status: "signed" },
    { meetingIdx: 15, status: "review" },
  ];

  const minutesRecords: (typeof minutesTable.$inferSelect)[] = [];
  for (const md of minutesDef) {
    const meeting = meetings[md.meetingIdx];
    const content = `<h2>Minutes — ${meeting.title}</h2><p>Meeting held on ${meeting.date?.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} at Meridian Tower, Abu Dhabi.</p><p>The chairperson called the meeting to order and confirmed quorum was present. The agenda was adopted without amendments.</p><p>Key discussion points were reviewed and resolutions were put to vote as documented in the agenda.</p><p>There being no further business, the meeting was adjourned.</p>`;
    const [min] = await db.insert(minutesTable).values({
      meetingId: meeting.id,
      content,
      status: md.status,
    }).returning();
    minutesRecords.push(min);

    if (md.status === "signed") {
      for (const signer of [ahmed, nadia]) {
        const sigHash = crypto.createHash("sha256")
          .update(content + signer.name + new Date().toISOString())
          .digest("hex");
        await db.insert(minutesSignaturesTable).values({
          minutesId: min.id,
          personId: signer.id,
          signatureHash: sigHash,
        }).onConflictDoNothing();
      }
    }

    await grantAccess("minutes", min.id, allPeopleIds);
  }
  logger.info("Seeding demo data... all 12 minutes created");

  // ── TASKS (25) ──
  const TASKS_DEF: { title: string; assignee: typeof ahmed; dueDate: Date; status: string; meetingIdx: number }[] = [
    { title: "Prepare CEO compensation benchmarking report", assignee: robert, dueDate: d(2, 15), status: "done", meetingIdx: 0 },
    { title: "Submit revised 2026 capex forecast", assignee: robert, dueDate: d(2, 1), status: "done", meetingIdx: 0 },
    { title: "Finalize SolarTech NDA with Clifford Chance", assignee: ahmed, dueDate: d(2, 10), status: "done", meetingIdx: 1 },
    { title: "Obtain conflict of interest declarations for SolarTech", assignee: ahmed, dueDate: d(2, 7), status: "done", meetingIdx: 1 },
    { title: "Circulate SolarTech DD scope to committee chairs", assignee: nadia, dueDate: d(2, 15), status: "done", meetingIdx: 1 },
    { title: "Prepare Q1 board presentation pack", assignee: robert, dueDate: d(3, 15), status: "done", meetingIdx: 2 },
    { title: "Obtain independent valuation for related party transaction", assignee: ahmed, dueDate: d(3, 25), status: "done", meetingIdx: 3 },
    { title: "Draft board resolution on committee restructuring", assignee: ahmed, dueDate: d(4, 20), status: "todo", meetingIdx: 4 },
    { title: "Prepare SolarTech integration PMO charter", assignee: robert, dueDate: d(4, 25), status: "todo", meetingIdx: 5 },
    { title: "Update board effectiveness questionnaire", assignee: ahmed, dueDate: d(4, 30), status: "todo", meetingIdx: 5 },
    { title: "Coordinate PwC 2026 audit kickoff", assignee: robert, dueDate: d(2, 5), status: "done", meetingIdx: 6 },
    { title: "Remediate 3 internal control findings", assignee: robert, dueDate: d(3, 31), status: "todo", meetingIdx: 6 },
    { title: "Prepare impairment testing memo for Africa assets", assignee: robert, dueDate: d(3, 1), status: "done", meetingIdx: 7 },
    { title: "Benchmark PwC fees against Big 4 peers", assignee: nadia, dueDate: d(3, 20), status: "done", meetingIdx: 8 },
    { title: "Draft H2 revised budget forecast", assignee: robert, dueDate: d(4, 20), status: "todo", meetingIdx: 9 },
    { title: "Negotiate EPC milestone payment schedule", assignee: nadia, dueDate: d(2, 15), status: "done", meetingIdx: 10 },
    { title: "Obtain sovereign guarantee term sheet from Samruk", assignee: nadia, dueDate: d(2, 28), status: "done", meetingIdx: 10 },
    { title: "Engage IFC for Kenya co-financing", assignee: robert, dueDate: d(3, 15), status: "done", meetingIdx: 11 },
    { title: "Commission political risk insurance quote", assignee: robert, dueDate: d(3, 30), status: "todo", meetingIdx: 11 },
    { title: "Complete SolarTech management interviews", assignee: nadia, dueDate: d(4, 1), status: "done", meetingIdx: 12 },
    { title: "Update board skills matrix with new competency areas", assignee: ahmed, dueDate: d(2, 28), status: "done", meetingIdx: 14 },
    { title: "Prepare succession planning memo for chair", assignee: ahmed, dueDate: d(3, 31), status: "todo", meetingIdx: 14 },
    { title: "Finalize 2026 CEO KPIs with compensation consultant", assignee: robert, dueDate: d(3, 15), status: "done", meetingIdx: 15 },
    { title: "Shortlist AI vendors for Phase 1", assignee: robert, dueDate: d(3, 1), status: "done", meetingIdx: 17 },
    { title: "Issue CrowdStrike engagement letter", assignee: ahmed, dueDate: d(3, 15), status: "done", meetingIdx: 17 },
  ];

  for (let i = 0; i < TASKS_DEF.length; i++) {
    const t = TASKS_DEF[i];
    const taskNum = `TASK-2026-${String(i + 1).padStart(3, "0")}`;
    const [task] = await db.insert(tasksTable).values({
      boardId: meetings[t.meetingIdx].boardId,
      title: t.title,
      assigneeId: t.assignee.id,
      sourceMeetingId: meetings[t.meetingIdx].id,
      taskNumber: taskNum,
      status: t.status as any,
      dueDate: t.dueDate.toISOString().split("T")[0],
      aiExtracted: false,
    }).returning();
    await grantAccess("task", task.id, allPeopleIds);
  }
  logger.info("Seeding demo data... all 25 tasks created");

  // ── ACCESS CONTROL — Recusals ──
  // Vote 6 (idx 5): Remove access for Ahmed (conflict of interest)
  await revokeAccess("vote", voteRecords[5].id, ahmed.id);
  // Vote 4 (idx 3): Remove access for David Park (observer, personnel matter)
  await revokeAccess("vote", voteRecords[3].id, david.id);
  // Doc 19 (idx 18): Remove access for Ahmed
  await revokeAccess("document", docs[18].id, ahmed.id);

  logger.info("Seeding demo data... access control recusals applied");
  logger.info("Seeding demo data... COMPLETE — 20 meetings, 18 votes, 20 documents, 12 minutes, 25 tasks");
}
