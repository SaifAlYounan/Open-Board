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

  const d = (m: number, day: number, h = 10) => new Date(2026, m - 1, day, h, 0, 0);

  // ── MEETINGS (20) ──
  const MEETINGS_DEF: { board: typeof bod; title: string; date: Date; status: "concluded" | "scheduled"; agendaItems: string[] }[] = [
    // PROJECT 1: ZEPHYR (Kazakhstan 1GW Wind Farm) — Meetings 1–7
    { board: sic, title: "SIC — Project Zephyr Devex Approval", date: d(1, 10), status: "concluded",
      agendaItems: ["Project Zephyr Overview and Strategic Rationale", "Feasibility Study Key Findings", "Land Acquisition and Permitting Status", "Devex Budget Approval — $18M"] },
    { board: sic, title: "SIC — Project Zephyr EPC Shortlist", date: d(1, 28), status: "concluded",
      agendaItems: ["EPC Contractor Evaluation Matrix", "Local Content Requirements Review", "Schedule and Penalty Clause Framework", "EPC Shortlist Approval"] },
    { board: sic, title: "SIC — Project Zephyr FID", date: d(2, 20), status: "concluded",
      agendaItems: ["Final Investment Decision Package — $1.2B", "PPA Terms with Samruk-Kazyna", "Sovereign Guarantee and Risk Allocation", "25-Year Concession Framework"] },
    { board: bod, title: "BoD — Project Zephyr FID Ratification", date: d(2, 25), status: "concluded",
      agendaItems: ["SIC Recommendation on Project Zephyr", "Financing Structure — 40% Equity, 60% Project Finance", "Risk Assessment Summary", "Board Ratification of FID"] },
    { board: fac, title: "FAC — Project Zephyr Cost Overrun Review", date: d(3, 18), status: "concluded",
      agendaItems: ["Steel Price Escalation Analysis", "Revised EPC Pricing — $200M Overrun", "Procurement Process Review", "Cost Control Recommendations"] },
    { board: bod, title: "BoD Extraordinary — Revised FID at $1.4B", date: d(3, 25), status: "concluded",
      agendaItems: ["Management Briefing on Cost Overrun", "Revised FID Proposal — $1.4B", "Quarterly Cost Cap Reporting Framework", "Management Accountability Measures"] },
    { board: fac, title: "FAC — Project Zephyr Procurement Investigation", date: d(4, 10), status: "concluded",
      agendaItems: ["Single-Source Steel Supplier Analysis", "Related Party Concerns — JV Partner Links", "Forensic Review Scope and Terms of Reference", "Investigation Timeline and Reporting"] },

    // PROJECT 2: AURORA (SolarTech Acquisition) — Meetings 8–12
    { board: sic, title: "SIC — Project Aurora Market Scan", date: d(1, 15), status: "concluded",
      agendaItems: ["Target Identification and Strategic Rationale", "Indicative Valuation Range — $300-400M", "Market Position and Technology Assessment", "Recommended Next Steps"] },
    { board: bod, title: "BoD — Project Aurora LOI Authorization", date: d(2, 3), status: "concluded",
      agendaItems: ["Non-Binding LOI Terms Review", "Exclusivity Period and DD Budget", "Conflict of Interest Declarations", "Financing Structure Review"] },
    { board: sic, title: "SIC — Project Aurora DD Findings", date: d(3, 12), status: "concluded",
      agendaItems: ["Technical DD Results — IP Portfolio", "German Patent Dispute Analysis", "Customer Concentration Risk Assessment", "Earn-Out Structure Proposal"] },
    { board: fac, title: "FAC — Project Aurora Financial DD", date: d(3, 18), status: "concluded",
      agendaItems: ["Revenue Quality Assessment", "Working Capital Normalization", "Tax Structuring and Contingent Liabilities", "Valuation Adjustment Recommendations"] },
    { board: bod, title: "BoD — Project Aurora Binding Offer", date: d(4, 5), status: "concluded",
      agendaItems: ["Revised Valuation — $280M", "Earn-Out Structure — $40M Over 3 Years", "IP Indemnity Terms", "Closing Conditions and Timeline"] },

    // PROJECT 3: LIGHTHOUSE (ESG & Compliance) — Meetings 13–17
    { board: tpc, title: "TPC — ESG Data Governance Review", date: d(2, 10), status: "concluded",
      agendaItems: ["D. Park Concerns on Emissions Methodology", "Kenya Site Data Collection Gaps", "Data Governance Framework Assessment", "Remediation Recommendations"] },
    { board: fac, title: "FAC — ESG Reporting Accuracy Assessment", date: d(2, 28), status: "concluded",
      agendaItems: ["Emissions Data Discrepancy Analysis", "Carbon Credit Overstatement Risk", "Financial Restatement Assessment", "Interim Reporting Recommendations"] },
    { board: bod, title: "BoD — ESG Compliance Escalation", date: d(3, 10), status: "concluded",
      agendaItems: ["Management Response to ESG Findings", "Independent ESG Audit Authorization", "Interim Reporting Suspension", "Investor Communication Strategy"] },
    { board: nrc, title: "NRC — ESG Impact on Executive Compensation", date: d(3, 20), status: "concluded",
      agendaItems: ["CEO 2025 Bonus Determination", "ESG Target Achievement Review", "Clawback Provisions Discussion", "Revised 2026 KPI Framework"] },
    { board: bod, title: "BoD — Independent ESG Audit Results", date: d(4, 8), status: "concluded",
      agendaItems: ["McKinsey Audit Findings — Methodology Flawed, Not Fraudulent", "Three Corrective Actions", "Revised Carbon Credit Calculation", "Investor Disclosure Requirements"] },

    // CROSS-PROJECT GOVERNANCE — Meetings 18–20
    { board: bod, title: "BoD Q1 2026 Review", date: d(3, 20), status: "concluded",
      agendaItems: ["Q1 Financial Performance Summary", "Project Zephyr Cost Update", "Project Aurora DD Status", "ESG Investigation Update", "Dividend Deferral Discussion"] },
    { board: bod, title: "BoD Strategy Day", date: d(4, 5), status: "concluded",
      agendaItems: ["5-Year Capital Allocation Framework", "Project Aurora Integration Planning", "ESG Remediation Cost Impact", "Market Entry Priorities — Greece, Spain, Morocco"] },
    { board: fac, title: "FAC Q1 Financial Consolidation", date: d(4, 12), status: "scheduled",
      agendaItems: ["Project Zephyr Capex Variance Analysis", "Project Aurora Acquisition Accounting", "ESG-Related Contingent Liabilities", "FY2026 Revised Forecast"] },
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

  // ── DOCUMENTS (28) ──
  const DOCS_DEF: { title: string; filename: string; board: typeof bod; classification: string }[] = [
    // Zephyr documents (0–9)
    { title: "Zephyr Devex Proposal — $18M", filename: "Zephyr-Devex-Proposal-18M.pdf", board: sic, classification: "general" },
    { title: "Zephyr Feasibility Study — Final", filename: "Zephyr-Feasibility-Study-Final.pdf", board: sic, classification: "general" },
    { title: "Zephyr EPC Evaluation Matrix", filename: "Zephyr-EPC-Evaluation-Matrix.pdf", board: sic, classification: "general" },
    { title: "Zephyr FID Board Pack", filename: "Zephyr-FID-Board-Pack.pdf", board: sic, classification: "general" },
    { title: "Zephyr PPA — Samruk Term Sheet", filename: "Zephyr-PPA-Samruk-Term-Sheet.pdf", board: sic, classification: "legal_opinion" },
    { title: "Zephyr Sovereign Guarantee Summary", filename: "Zephyr-Sovereign-Guarantee-Summary.pdf", board: sic, classification: "legal_opinion" },
    { title: "Zephyr Cost Overrun Analysis", filename: "Zephyr-Cost-Overrun-Analysis.pdf", board: fac, classification: "financial_report" },
    { title: "Zephyr Revised EPC Pricing", filename: "Zephyr-Revised-EPC-Pricing.pdf", board: fac, classification: "financial_report" },
    { title: "Zephyr Steel Procurement Red Flags", filename: "Zephyr-Steel-Procurement-Red-Flags.pdf", board: fac, classification: "general" },
    { title: "Zephyr Forensic Review — Terms of Reference", filename: "Zephyr-Forensic-Review-ToR.pdf", board: fac, classification: "general" },

    // Aurora documents (10–16)
    { title: "Aurora Strategic Rationale", filename: "Aurora-Strategic-Rationale.pdf", board: sic, classification: "general" },
    { title: "Aurora LOI — Draft v3", filename: "Aurora-LOI-Draft-v3.pdf", board: bod, classification: "resolution" },
    { title: "Aurora Technical DD Report", filename: "Aurora-Technical-DD-Report.pdf", board: sic, classification: "general" },
    { title: "Aurora IP Portfolio Valuation", filename: "Aurora-IP-Portfolio-Valuation.pdf", board: sic, classification: "general" },
    { title: "Aurora German Patent Dispute Memo", filename: "Aurora-German-Patent-Dispute-Memo.pdf", board: sic, classification: "legal_opinion" },
    { title: "Aurora Financial DD Report", filename: "Aurora-Financial-DD-Report.pdf", board: fac, classification: "financial_report" },
    { title: "Aurora Binding Offer — Term Sheet", filename: "Aurora-Binding-Offer-Term-Sheet.pdf", board: bod, classification: "resolution" },

    // Lighthouse documents (17–23)
    { title: "Park ESG Concerns Memo", filename: "Park-ESG-Concerns-Memo.pdf", board: tpc, classification: "general" },
    { title: "Kenya Emissions Data Discrepancy", filename: "Kenya-Emissions-Data-Discrepancy.pdf", board: fac, classification: "financial_report" },
    { title: "Independent ESG Audit — Terms of Reference", filename: "Independent-ESG-Audit-ToR.pdf", board: bod, classification: "general" },
    { title: "ESG Audit Final Report — McKinsey", filename: "ESG-Audit-Final-Report-McKinsey.pdf", board: bod, classification: "general" },
    { title: "CEO Compensation ESG Impact Analysis", filename: "CEO-Compensation-ESG-Impact-Analysis.pdf", board: nrc, classification: "general" },
    { title: "Revised ESG Methodology Framework", filename: "Revised-ESG-Methodology-Framework.pdf", board: tpc, classification: "general" },
    { title: "Enhanced Whistleblower Policy — Draft", filename: "Enhanced-Whistleblower-Policy-Draft.pdf", board: bod, classification: "resolution" },

    // Cross-project documents (24–27)
    { title: "Q1 2026 Consolidated Financial Report", filename: "Q1-2026-Consolidated-Financial-Report.pdf", board: bod, classification: "financial_report" },
    { title: "FY2026 Revised Budget — Three Projects", filename: "FY2026-Revised-Budget-Three-Projects.pdf", board: fac, classification: "financial_report" },
    { title: "Dividend Deferral Impact Analysis", filename: "Dividend-Deferral-Impact-Analysis.pdf", board: bod, classification: "financial_report" },
    { title: "Capital Reallocation Proposal", filename: "Capital-Reallocation-Proposal.pdf", board: bod, classification: "general" },
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
  logger.info("Seeding demo data... all 28 documents created");

  // ── Link documents to meetings via agenda_documents ──
  const docMeetingLinks: [number, number[]][] = [
    [0,  [0]],           // Zephyr-Devex-Proposal → Meeting 1
    [1,  [0]],           // Zephyr-Feasibility → Meeting 1
    [2,  [1]],           // Zephyr-EPC-Evaluation → Meeting 2
    [3,  [2, 3]],        // Zephyr-FID-Board-Pack → Meeting 3, 4
    [4,  [2]],           // Zephyr-PPA-Term-Sheet → Meeting 3
    [5,  [2]],           // Zephyr-Sovereign-Guarantee → Meeting 3
    [6,  [4, 5]],        // Zephyr-Cost-Overrun → Meeting 5, 6
    [7,  [4]],           // Zephyr-Revised-EPC-Pricing → Meeting 5
    [8,  [6]],           // Zephyr-Steel-Red-Flags → Meeting 7
    [9,  [6]],           // Zephyr-Forensic-Review-ToR → Meeting 7
    [10, [7]],           // Aurora-Strategic-Rationale → Meeting 8
    [11, [8]],           // Aurora-LOI-Draft → Meeting 9
    [12, [9]],           // Aurora-Technical-DD → Meeting 10
    [13, [9]],           // Aurora-IP-Portfolio → Meeting 10
    [14, [9]],           // Aurora-German-Patent → Meeting 10
    [15, [10]],          // Aurora-Financial-DD → Meeting 11
    [16, [11]],          // Aurora-Binding-Offer → Meeting 12
    [17, [12]],          // Park-ESG-Concerns → Meeting 13
    [18, [13]],          // Kenya-Emissions → Meeting 14
    [19, [14]],          // ESG-Audit-ToR → Meeting 15
    [20, [16]],          // ESG-Audit-Final → Meeting 17
    [21, [15]],          // CEO-Comp-ESG-Impact → Meeting 16
    [22, [12, 16]],      // Revised-ESG-Methodology → Meeting 13, 17
    [23, [16]],          // Whistleblower-Policy → Meeting 17
    [24, [17, 19]],      // Q1-Consolidated → Meeting 18, 20
    [25, [18, 19]],      // FY2026-Revised-Budget → Meeting 19, 20
    [26, [17]],          // Dividend-Deferral → Meeting 18
    [27, [18]],          // Capital-Reallocation → Meeting 19
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
    // ── ZEPHYR VOTES (0–5) ──
    { board: sic, meetingIdx: 0, title: "Project Zephyr — Devex Approval ($18M)", resNum: "RES-SIC-2026-001", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: sarah, decision: "approved" }, { person: nadia, decision: "approved" },
        { person: james, decision: "approved" }, { person: yuki, decision: "approved" },
      ], docIdxs: [0] },

    { board: sic, meetingIdx: 1, title: "Project Zephyr — EPC Shortlist Approval", resNum: "RES-SIC-2026-002", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: sarah, decision: "approved" }, { person: nadia, decision: "approved" },
        { person: james, decision: "approved" },
        { person: yuki, decision: "approved_with_comments", comment: "Include penalty clause for schedule delay" },
      ], docIdxs: [2] },

    { board: sic, meetingIdx: 2, title: "Project Zephyr — Final Investment Decision ($1.2B)", resNum: "RES-SIC-2026-003", type: "meeting", ruleType: "two_thirds", status: "approved", secret: false,
      voters: [
        { person: sarah, decision: "approved" }, { person: nadia, decision: "approved" },
        { person: james, decision: "approved" }, { person: yuki, decision: "approved" },
      ], docIdxs: [3] },

    { board: bod, meetingIdx: 3, title: "Project Zephyr — FID Ratification by the Board", resNum: "RES-BOD-2026-001", type: "meeting", ruleType: "unanimous", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved" }, { person: fatima, decision: "approved" },
      ], docIdxs: [3] },

    { board: bod, meetingIdx: 5, title: "Project Zephyr — Revised FID ($1.4B) with Quarterly Cost Cap", resNum: "RES-BOD-2026-002", type: "meeting", ruleType: "two_thirds", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved" },
        { person: fatima, decision: "approved_with_comments", comment: "Management must present remediation plan within 30 days" },
      ], docIdxs: [6, 7] },

    { board: fac, meetingIdx: 6, title: "Project Zephyr — Authorize Forensic Review of Steel Procurement", resNum: "RES-FAC-2026-001", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: klaus, decision: "approved" }, { person: fatima, decision: "approved" },
        { person: yuki, decision: "approved" }, { person: maria, decision: "approved" },
      ], docIdxs: [8, 9] },

    // ── AURORA VOTES (6–9) ──
    { board: bod, meetingIdx: null, title: "Project Aurora — LOI Authorization ($340M Indicative)", resNum: "RES-BOD-2026-003", type: "circulation", ruleType: "unanimous", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved" }, { person: fatima, decision: "approved" },
      ], docIdxs: [10, 11] },

    { board: sic, meetingIdx: 7, title: "Project Aurora — DD Budget Approval ($1.5M)", resNum: "RES-SIC-2026-004", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: sarah, decision: "approved" }, { person: nadia, decision: "approved" },
        { person: james, decision: "approved" }, { person: yuki, decision: "approved" },
      ], docIdxs: [] },

    { board: bod, meetingIdx: 11, title: "Project Aurora — Binding Offer at $280M + $40M Earn-Out", resNum: "RES-BOD-2026-004", type: "meeting", ruleType: "unanimous", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved_with_comments", comment: "Insist on IP indemnity cap at $50M, not $30M" },
        { person: fatima, decision: "approved" },
      ], docIdxs: [15, 16] },

    { board: sic, meetingIdx: null, title: "Project Aurora — Engage Freshfields for German IP Dispute", resNum: "RES-SIC-2026-005", type: "circulation", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: sarah, decision: "approved" }, { person: nadia, decision: "approved" },
        { person: james, decision: "approved" }, { person: yuki, decision: "approved" },
      ], docIdxs: [14] },

    // ── LIGHTHOUSE VOTES (10–14) ──
    { board: bod, meetingIdx: 14, title: "Authorize Independent ESG Audit (McKinsey Sustainability)", resNum: "RES-BOD-2026-005", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved" }, { person: fatima, decision: "approved" },
      ], docIdxs: [17, 19] },

    { board: bod, meetingIdx: null, title: "Suspend ESG-Linked Carbon Credit Claims Pending Audit", resNum: "RES-BOD-2026-006", type: "circulation", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved_with_comments", comment: "Notify investors proactively, do not wait for Q2 report" },
        { person: fatima, decision: "approved" },
      ], docIdxs: [18] },

    { board: nrc, meetingIdx: 15, title: "CEO 2025 Bonus — Reduced to 85% of Target (ESG Miss)", resNum: "RES-NRC-2026-001", type: "meeting", ruleType: "majority", status: "approved", secret: true,
      voters: [
        { person: fatima, decision: "approved" }, { person: klaus, decision: "approved" },
        { person: nadia, decision: "approved" },
        { person: sarah, decision: "not_approved_with_comments", comment: "70% more appropriate given restatement severity" },
      ], docIdxs: [21] },

    { board: tpc, meetingIdx: 12, title: "Approve Revised ESG Reporting Methodology", resNum: "RES-TPC-2026-001", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: james, decision: "approved" }, { person: fatima, decision: "approved" },
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
      ], docIdxs: [20, 22] },

    { board: bod, meetingIdx: null, title: "Adopt Enhanced Whistleblower Policy for ESG Concerns", resNum: "RES-BOD-2026-007", type: "circulation", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved" }, { person: fatima, decision: "approved" },
      ], docIdxs: [23] },

    // ── CROSS-PROJECT VOTES (15–17) ──
    { board: bod, meetingIdx: 17, title: "Defer Q1 2026 Dividend to Preserve Liquidity (Zephyr + Aurora)", resNum: "RES-BOD-2026-008", type: "meeting", ruleType: "majority", status: "approved", secret: false,
      voters: [
        { person: nadia, decision: "approved" }, { person: sarah, decision: "approved" },
        { person: klaus, decision: "approved" },
        { person: fatima, decision: "not_approved", comment: "Dividend cut signals weakness to market" },
      ], docIdxs: [26] },

    { board: bod, meetingIdx: null, title: "Revised 2026 Capital Allocation — Redirect $50M from Africa to Zephyr", resNum: "RES-BOD-2026-009", type: "circulation", ruleType: "two_thirds", status: "open", secret: false,
      voters: [
        { person: nadia, decision: "approved" },
      ], docIdxs: [27] },

    { board: fac, meetingIdx: 19, title: "Approve FY2026 Revised Budget (Incorporating All 3 Project Impacts)", resNum: "RES-FAC-2026-002", type: "meeting", ruleType: "majority", status: "open", secret: false,
      voters: [], docIdxs: [25] },
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

  // ── MINUTES (14) ──
  const minutesDef: { meetingIdx: number; status: "signed" | "review" | "draft" }[] = [
    { meetingIdx: 0,  status: "signed" },   // Meeting 1
    { meetingIdx: 1,  status: "signed" },   // Meeting 2
    { meetingIdx: 2,  status: "signed" },   // Meeting 3
    { meetingIdx: 3,  status: "signed" },   // Meeting 4
    { meetingIdx: 7,  status: "signed" },   // Meeting 8
    { meetingIdx: 8,  status: "signed" },   // Meeting 9
    { meetingIdx: 12, status: "signed" },   // Meeting 13
    { meetingIdx: 13, status: "signed" },   // Meeting 14
    { meetingIdx: 4,  status: "review" },   // Meeting 5
    { meetingIdx: 9,  status: "review" },   // Meeting 10
    { meetingIdx: 14, status: "review" },   // Meeting 15
    { meetingIdx: 15, status: "review" },   // Meeting 16
    { meetingIdx: 5,  status: "draft" },    // Meeting 6
    { meetingIdx: 6,  status: "draft" },    // Meeting 7
  ];

  for (const md of minutesDef) {
    const meeting = meetings[md.meetingIdx];
    const content = `<h2>Minutes — ${meeting.title}</h2><p>Meeting held on ${meeting.date?.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} at Meridian Tower, Abu Dhabi.</p><p>The chairperson called the meeting to order and confirmed quorum was present. The agenda was adopted without amendments.</p><p>Key discussion points were reviewed and resolutions were put to vote as documented in the agenda.</p><p>There being no further business, the meeting was adjourned.</p>`;
    const [min] = await db.insert(minutesTable).values({
      meetingId: meeting.id,
      content,
      status: md.status,
    }).returning();

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
  logger.info("Seeding demo data... all 14 minutes created");

  // ── TASKS (25) ──
  const TASKS_DEF: { title: string; assignee: typeof ahmed; dueDate: Date; status: string; meetingIdx: number }[] = [
    // Zephyr tasks (0–9)
    { title: "Complete land acquisition due diligence", assignee: nadia, dueDate: d(1, 25), status: "done", meetingIdx: 0 },
    { title: "Negotiate local content requirements with Kazakh authorities", assignee: nadia, dueDate: d(2, 10), status: "done", meetingIdx: 0 },
    { title: "Finalize EPC evaluation report", assignee: robert, dueDate: d(2, 15), status: "done", meetingIdx: 1 },
    { title: "Obtain EPC penalty clause markup from legal", assignee: ahmed, dueDate: d(2, 18), status: "done", meetingIdx: 1 },
    { title: "Execute PPA with Samruk-Kazyna", assignee: nadia, dueDate: d(3, 5), status: "done", meetingIdx: 2 },
    { title: "Arrange project finance syndication", assignee: robert, dueDate: d(3, 15), status: "done", meetingIdx: 3 },
    { title: "Prepare cost overrun root cause analysis", assignee: robert, dueDate: d(3, 15), status: "done", meetingIdx: 4 },
    { title: "Implement quarterly cost reporting to FAC", assignee: robert, dueDate: d(3, 30), status: "todo", meetingIdx: 5 },
    { title: "Present management remediation plan", assignee: robert, dueDate: d(4, 25), status: "todo", meetingIdx: 5 },
    { title: "Engage Deloitte for forensic procurement review", assignee: ahmed, dueDate: d(4, 15), status: "todo", meetingIdx: 6 },

    // Aurora tasks (10–17)
    { title: "Prepare SolarTech NDA with Clifford Chance", assignee: ahmed, dueDate: d(1, 20), status: "done", meetingIdx: 7 },
    { title: "Complete conflict of interest declarations", assignee: ahmed, dueDate: d(2, 5), status: "done", meetingIdx: 8 },
    { title: "Circulate DD scope to committee chairs", assignee: nadia, dueDate: d(2, 10), status: "done", meetingIdx: 8 },
    { title: "Complete management interviews at SolarTech", assignee: nadia, dueDate: d(3, 20), status: "done", meetingIdx: 9 },
    { title: "Obtain Freshfields opinion on German IP dispute", assignee: ahmed, dueDate: d(3, 25), status: "done", meetingIdx: 9 },
    { title: "Prepare working capital bridge analysis", assignee: robert, dueDate: d(3, 20), status: "done", meetingIdx: 10 },
    { title: "Finalize earn-out performance metrics", assignee: robert, dueDate: d(4, 10), status: "todo", meetingIdx: 11 },
    { title: "Prepare SolarTech integration PMO charter", assignee: robert, dueDate: d(4, 25), status: "todo", meetingIdx: 11 },

    // Lighthouse tasks (18–24)
    { title: "Document Kenya emissions data collection methodology", assignee: robert, dueDate: d(2, 20), status: "done", meetingIdx: 12 },
    { title: "Quantify carbon credit overstatement exposure", assignee: robert, dueDate: d(3, 5), status: "done", meetingIdx: 13 },
    { title: "Engage McKinsey Sustainability for ESG audit", assignee: ahmed, dueDate: d(3, 15), status: "done", meetingIdx: 14 },
    { title: "Prepare investor disclosure on ESG restatement", assignee: robert, dueDate: d(4, 1), status: "done", meetingIdx: 14 },
    { title: "Implement corrective action plan from ESG audit", assignee: robert, dueDate: d(4, 30), status: "todo", meetingIdx: 16 },
    { title: "Train site teams on revised emissions methodology", assignee: robert, dueDate: d(5, 15), status: "todo", meetingIdx: 16 },
    { title: "Roll out enhanced whistleblower portal", assignee: ahmed, dueDate: d(5, 1), status: "todo", meetingIdx: 16 },
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
  // Vote 13 (idx 12): CEO 2025 Bonus — Remove D. Park (observer excluded from personnel matters)
  await revokeAccess("vote", voteRecords[12].id, david.id);
  // Document 22 (idx 21): CEO Compensation ESG Impact — Remove D. Park
  await revokeAccess("document", docs[21].id, david.id);

  logger.info("Seeding demo data... access control recusals applied");
  logger.info("Seeding demo data... COMPLETE — 20 meetings, 18 votes, 28 documents, 14 minutes, 25 tasks");
}
