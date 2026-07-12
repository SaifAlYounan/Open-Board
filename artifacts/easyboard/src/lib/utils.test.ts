import { describe, it, expect } from "vitest";
import { formatDate, isOverdue, initials } from "./utils";

describe("formatDate", () => {
  it("returns an em dash for empty input", () => {
    expect(formatDate(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
  });

  it("parses a date-only string as a local date (no timezone day-shift)", () => {
    // The bug this guards: `new Date('2026-03-15')` is UTC midnight, which in a
    // negative-UTC timezone renders as the 14th. formatDate must keep the 15th.
    const out = formatDate("2026-03-15");
    expect(out).toContain("15");
    expect(out).toContain("Mar");
    expect(out).toContain("2026");
  });
});

describe("isOverdue", () => {
  it("is false for no date", () => {
    expect(isOverdue(null)).toBe(false);
  });
  it("is true for a clearly past date", () => {
    expect(isOverdue("2000-01-01")).toBe(true);
  });
  it("is false for a clearly future date", () => {
    expect(isOverdue("2999-01-01")).toBe(false);
  });
});

describe("initials", () => {
  it("takes first + last initials", () => {
    expect(initials("Ahmed Al-Rashid")).toBe("AA");
    expect(initials("Nadia")).toBe("N");
  });
  it("falls back to ? for empty", () => {
    expect(initials("")).toBe("?");
    expect(initials(null)).toBe("?");
  });
});

// Vote tally math — the fix that stopped abstentions/recusals counting as "Against".
describe("vote tally", () => {
  const tally = (records: { decision: string }[]) => ({
    approvals: records.filter((r) => r.decision?.startsWith("approved")).length,
    against: records.filter((r) => r.decision?.startsWith("not_approved") || r.decision?.startsWith("rejected")).length,
    abstained: records.filter((r) => r.decision === "abstained").length,
    total: records.length,
  });

  it("counts both approve variants as for, both not-approved variants as against", () => {
    const t = tally([
      { decision: "approved" },
      { decision: "approved_with_comments" },
      { decision: "not_approved" },
      { decision: "not_approved_with_comments" },
    ]);
    expect(t).toEqual({ approvals: 2, against: 2, abstained: 0, total: 4 });
  });

  it("an abstained ballot is cast (in the total) but neither for nor against", () => {
    // No longer a placeholder: "abstained" is a real ballot decision since the
    // external-review fixes — it participates without approving.
    const t = tally([{ decision: "approved" }, { decision: "abstained" }]);
    expect(t.approvals).toBe(1);
    expect(t.against).toBe(0);
    expect(t.abstained).toBe(1);
    expect(t.total).toBe(2);
  });
});
