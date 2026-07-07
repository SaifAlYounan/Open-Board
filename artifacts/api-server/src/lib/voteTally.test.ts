import { describe, it, expect } from "vitest";
import { evaluateByRule, meetsQuorum, computeCertificateHash } from "./voteTally";

describe("meetsQuorum", () => {
  it("is always met when no rule or no quorum is set", () => {
    expect(meetsQuorum(null, 0)).toBe(true);
    expect(meetsQuorum({ type: "majority", minApprovals: null, quorum: null }, 0)).toBe(true);
  });

  it("requires at least `quorum` valid votes cast", () => {
    const rule = { type: "majority", minApprovals: null, quorum: 3 };
    expect(meetsQuorum(rule, 2)).toBe(false);
    expect(meetsQuorum(rule, 3)).toBe(true);
    expect(meetsQuorum(rule, 4)).toBe(true);
  });
});

describe("evaluateByRule — quorum gate", () => {
  it("rejects a resolution that passes on votes but misses quorum", () => {
    // 2 of 2 cast votes approve, but the rule requires a quorum of 3.
    const rule = { type: "majority", minApprovals: null, quorum: 3 };
    expect(evaluateByRule(rule, 2, 2, 2)).toBe("rejected");
  });

  it("applies the normal rule once quorum is met", () => {
    const rule = { type: "majority", minApprovals: null, quorum: 3 };
    // 3 cast, 2 approve, 5 eligible → majority of eligible not reached
    expect(evaluateByRule(rule, 2, 5, 3)).toBe("rejected");
    // 3 cast, 3 approve, 5 eligible → 3 > 2.5 → approved
    expect(evaluateByRule(rule, 3, 5, 3)).toBe("approved");
  });
});

describe("evaluateByRule — rule types", () => {
  it("simple majority needs more than half of eligible", () => {
    expect(evaluateByRule(null, 3, 5, 5)).toBe("approved");
    expect(evaluateByRule(null, 2, 5, 5)).toBe("rejected");
    expect(evaluateByRule(null, 2, 4, 4)).toBe("rejected"); // exactly half is not a majority
  });

  it("unanimous needs every eligible voter to approve", () => {
    const rule = { type: "unanimous", minApprovals: null, quorum: null };
    expect(evaluateByRule(rule, 4, 4, 4)).toBe("approved");
    expect(evaluateByRule(rule, 3, 4, 4)).toBe("rejected");
  });

  it("two_thirds needs at least ceil(2/3)", () => {
    const rule = { type: "two_thirds", minApprovals: null, quorum: null };
    expect(evaluateByRule(rule, 4, 6, 6)).toBe("approved"); // ceil(4)=4
    expect(evaluateByRule(rule, 3, 6, 6)).toBe("rejected");
  });

  it("custom uses minApprovals when set", () => {
    const rule = { type: "custom", minApprovals: 2, quorum: null };
    expect(evaluateByRule(rule, 2, 10, 2)).toBe("approved");
    expect(evaluateByRule(rule, 1, 10, 1)).toBe("rejected");
  });
});

describe("computeCertificateHash", () => {
  const closedAt = new Date("2026-04-09T12:00:00.000Z");
  const records = [
    { personId: "b", decision: "approved" },
    { personId: "a", decision: "not_approved" },
  ];

  it("is reproducible for the same inputs (order-independent)", () => {
    const h1 = computeCertificateHash("vote-1", "approved", closedAt, records);
    const h2 = computeCertificateHash("vote-1", "approved", closedAt, [...records].reverse());
    expect(h1).toBe(h2);
  });

  it("recomputes identically from the same persisted closedAt", () => {
    const h1 = computeCertificateHash("vote-1", "approved", closedAt, records);
    const persisted = new Date(closedAt.toISOString());
    const h2 = computeCertificateHash("vote-1", "approved", persisted, records);
    expect(h2).toBe(h1);
  });

  it("changes if any vote record is tampered with", () => {
    const h1 = computeCertificateHash("vote-1", "approved", closedAt, records);
    const tampered = [{ personId: "b", decision: "approved" }, { personId: "a", decision: "approved" }];
    expect(computeCertificateHash("vote-1", "approved", closedAt, tampered)).not.toBe(h1);
  });

  it("changes if the status is tampered with", () => {
    const h1 = computeCertificateHash("vote-1", "approved", closedAt, records);
    expect(computeCertificateHash("vote-1", "rejected", closedAt, records)).not.toBe(h1);
  });
});
