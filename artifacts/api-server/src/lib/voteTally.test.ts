import { describe, it, expect } from "vitest";
import crypto from "crypto";
import {
  evaluateByRule,
  meetsQuorum,
  computeTally,
  computeCertificateHash,
  computeLegacyCertificateHash,
} from "./voteTally";

describe("meetsQuorum", () => {
  it("is always met when no rule or no quorum is set", () => {
    expect(meetsQuorum(null, 0)).toBe(true);
    expect(meetsQuorum({ type: "majority", minApprovals: null, quorum: null }, 0)).toBe(true);
  });

  it("requires at least `quorum` weight cast", () => {
    const rule = { type: "majority", minApprovals: null, quorum: 3 };
    expect(meetsQuorum(rule, 2)).toBe(false);
    expect(meetsQuorum(rule, 3)).toBe(true);
    expect(meetsQuorum(rule, 4)).toBe(true);
  });

  it("a single heavy ballot can satisfy a quorum a head count would miss", () => {
    // Quorum 3 in weight units: one member of weight 3 casting meets it alone.
    const rule = { type: "majority", minApprovals: null, quorum: 3 };
    expect(meetsQuorum(rule, 3)).toBe(true); // one ballot, weight 3
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

  it("weighted quorum: heavy abstention-free ballots meet quorum a head count would miss", () => {
    // 5 total weight, quorum 4. One member of weight 4 approves (castWeight 4).
    const rule = { type: "majority", minApprovals: null, quorum: 4 };
    expect(evaluateByRule(rule, 4, 5, 4)).toBe("approved");
    // Two weight-1 members cast (castWeight 2) → quorum missed → rejected.
    expect(evaluateByRule(rule, 2, 5, 2)).toBe("rejected");
  });
});

describe("evaluateByRule — rule types (weight units)", () => {
  it("simple majority needs more than half of eligible weight", () => {
    expect(evaluateByRule(null, 3, 5, 5)).toBe("approved");
    expect(evaluateByRule(null, 2, 5, 5)).toBe("rejected");
    expect(evaluateByRule(null, 2, 4, 4)).toBe("rejected"); // exactly half is not a majority
  });

  it("unanimous needs every eligible weight to approve", () => {
    const rule = { type: "unanimous", minApprovals: null, quorum: null };
    expect(evaluateByRule(rule, 4, 4, 4)).toBe("approved");
    expect(evaluateByRule(rule, 3, 4, 4)).toBe("rejected");
  });

  it("two_thirds needs at least ceil(2/3) of eligible weight", () => {
    const rule = { type: "two_thirds", minApprovals: null, quorum: null };
    expect(evaluateByRule(rule, 4, 6, 6)).toBe("approved"); // ceil(4)=4
    expect(evaluateByRule(rule, 3, 6, 6)).toBe("rejected");
  });

  it("custom uses minApprovals (in weight units) when set", () => {
    const rule = { type: "custom", minApprovals: 2, quorum: null };
    expect(evaluateByRule(rule, 2, 10, 2)).toBe("approved");
    expect(evaluateByRule(rule, 1, 10, 1)).toBe("rejected");
  });

  it("a heavy minority can outvote a light majority (the point of weights)", () => {
    // 3 members: weights 1, 1, 3 (total 5). The two weight-1 members approve,
    // the weight-3 member rejects → approvalsWeight 2 of 5 → rejected, even
    // though 2 of 3 heads approved.
    expect(evaluateByRule(null, 2, 5, 5)).toBe("rejected");
    // And the reverse: only the weight-3 member approves → 3 > 2.5 → approved.
    expect(evaluateByRule(null, 3, 5, 5)).toBe("approved");
  });
});

describe("computeTally", () => {
  const members = [
    { personId: "a", weight: 1 },
    { personId: "b", weight: 2 },
    { personId: "c", weight: 3 },
  ];

  it("aggregates counts and weights over cast ballots", () => {
    const t = computeTally(members, [
      { personId: "a", decision: "approved", weight: 1 },
      { personId: "c", decision: "not_approved", weight: 3 },
    ]);
    expect(t).toEqual({
      totalVoters: 3,
      totalWeight: 6,
      votesCast: 2,
      castWeight: 4,
      approvalsCount: 1,
      approvalsWeight: 1,
    });
  });

  it("counts approved_with_comments as approval weight", () => {
    const t = computeTally(members, [{ personId: "b", decision: "approved_with_comments", weight: 2 }]);
    expect(t.approvalsCount).toBe(1);
    expect(t.approvalsWeight).toBe(2);
  });

  it("excludes recused members and their ballots entirely", () => {
    const t = computeTally(
      members,
      [
        { personId: "a", decision: "approved", weight: 1 },
        { personId: "c", decision: "approved", weight: 3 },
      ],
      new Set(["c"]),
    );
    expect(t).toEqual({
      totalVoters: 2,
      totalWeight: 3,
      votesCast: 1,
      castWeight: 1,
      approvalsCount: 1,
      approvalsWeight: 1,
    });
  });

  it("a ballot's snapshotted weight wins over the live membership weight", () => {
    // Member b's weight was 5 when they cast; the membership row now says 2.
    // The persisted snapshot is authoritative for the ballot AND the total.
    const t = computeTally(members, [{ personId: "b", decision: "approved", weight: 5 }]);
    expect(t.approvalsWeight).toBe(5);
    expect(t.castWeight).toBe(5);
    expect(t.totalWeight).toBe(1 + 5 + 3);
  });

  it("missing weights default to 1 (unweighted data reproduces head counts)", () => {
    const t = computeTally(
      [{ personId: "a" }, { personId: "b", weight: null }],
      [{ personId: "a", decision: "approved" }, { personId: "b", decision: "not_approved", weight: null }],
    );
    expect(t).toEqual({
      totalVoters: 2,
      totalWeight: 2,
      votesCast: 2,
      castWeight: 2,
      approvalsCount: 1,
      approvalsWeight: 1,
    });
  });

  it("counts a lingering ballot from a removed member in cast totals but not eligible totals", () => {
    // Mirrors the pre-weights behavior: validRecords counted every non-recused
    // record even if its caster was no longer a member.
    const t = computeTally([{ personId: "a", weight: 1 }], [
      { personId: "a", decision: "approved", weight: 1 },
      { personId: "ghost", decision: "not_approved", weight: 2 },
    ]);
    expect(t.totalVoters).toBe(1);
    expect(t.totalWeight).toBe(1);
    expect(t.votesCast).toBe(2);
    expect(t.castWeight).toBe(3);
  });
});

describe("computeTally — proxy ballots", () => {
  // A proxy-cast ballot is stored against the PRINCIPAL (personId = principal,
  // castBy = holder) with the principal's weight snapshot — so the tally needs
  // no proxy-special-casing: the ballot counts once, as the principal, at the
  // principal's weight, for quorum and outcome alike.
  const members = [
    { personId: "holder", weight: 1 },
    { personId: "principal", weight: 3 },
  ];

  it("a proxy-cast ballot counts as the principal at the principal's weight", () => {
    const records = [
      { personId: "holder", decision: "approved", weight: 1, castBy: null },
      { personId: "principal", decision: "not_approved", weight: 3, castBy: "holder" },
    ];
    const t = computeTally(members, records);
    expect(t.votesCast).toBe(2); // both ballots present for quorum/close
    expect(t.castWeight).toBe(4);
    expect(t.approvalsWeight).toBe(1); // holder's own approval only
    // Holder approving both their own and the proxy ballot never double-counts
    // the holder's weight.
    const bothApprove = computeTally(members, [
      { personId: "holder", decision: "approved", weight: 1, castBy: null },
      { personId: "principal", decision: "approved", weight: 3, castBy: "holder" },
    ]);
    expect(bothApprove.approvalsWeight).toBe(4);
    expect(bothApprove.approvalsCount).toBe(2);
  });

  it("a superseded ballot (principal re-cast in person) still counts exactly once", () => {
    // Supersession updates the SAME record in place (castBy → null), so the
    // tally shape is identical to an in-person cast.
    const t = computeTally(members, [
      { personId: "principal", decision: "approved", weight: 3, castBy: null },
    ]);
    expect(t.votesCast).toBe(1);
    expect(t.castWeight).toBe(3);
    expect(t.approvalsWeight).toBe(3);
  });

  it("a recused principal's proxy-cast ballot is excluded like any recused ballot", () => {
    const t = computeTally(members, [
      { personId: "principal", decision: "approved", weight: 3, castBy: "holder" },
    ], new Set(["principal"]));
    expect(t.totalVoters).toBe(1);
    expect(t.votesCast).toBe(0);
    expect(t.approvalsWeight).toBe(0);
  });
});

describe("weight=1 regression equivalence (weighted tally is a strict generalization)", () => {
  // Sweep every small scenario: with all weights at 1, feeding the weighted
  // tally into evaluateByRule must reproduce the old head-count outcome for
  // every rule type and quorum, exactly.
  const ruleVariants = (n: number) => {
    const rules: ({ type: string; minApprovals: number | null; quorum: number | null } | null)[] = [null];
    for (const type of ["majority", "unanimous", "two_thirds", "three_quarters"]) {
      for (const quorum of [null, 1, Math.max(1, n - 1), n, n + 1]) {
        rules.push({ type, minApprovals: null, quorum });
      }
    }
    for (const minApprovals of [null, 1, n]) rules.push({ type: "custom", minApprovals, quorum: null });
    return rules;
  };

  it("reproduces head-count outcomes for every rule/quorum/split up to 6 members", () => {
    let checked = 0;
    for (let n = 1; n <= 6; n++) {
      const members = Array.from({ length: n }, (_, i) => ({ personId: `p${i}`, weight: 1 }));
      for (let cast = 0; cast <= n; cast++) {
        for (let approvals = 0; approvals <= cast; approvals++) {
          const records = Array.from({ length: cast }, (_, i) => ({
            personId: `p${i}`,
            decision: i < approvals ? "approved" : "not_approved",
            weight: 1,
          }));
          const t = computeTally(members, records);
          // With unit weights the weight sums ARE the head counts…
          expect(t.totalWeight).toBe(n);
          expect(t.castWeight).toBe(cast);
          expect(t.approvalsWeight).toBe(approvals);
          for (const rule of ruleVariants(n)) {
            // …so the weighted evaluation is literally the old evaluation.
            expect(evaluateByRule(rule, t.approvalsWeight, t.totalWeight, t.castWeight)).toBe(
              evaluateByRule(rule, approvals, n, cast),
            );
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe("computeCertificateHash (v2)", () => {
  const closedAt = new Date("2026-04-09T12:00:00.000Z");
  const records = [
    { personId: "b", decision: "approved", weight: 1, castBy: null },
    { personId: "a", decision: "not_approved", weight: 1, castBy: null },
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
    const tampered = [
      { personId: "b", decision: "approved", weight: 1, castBy: null },
      { personId: "a", decision: "approved", weight: 1, castBy: null },
    ];
    expect(computeCertificateHash("vote-1", "approved", closedAt, tampered)).not.toBe(h1);
  });

  it("changes if the status is tampered with", () => {
    const h1 = computeCertificateHash("vote-1", "approved", closedAt, records);
    expect(computeCertificateHash("vote-1", "rejected", closedAt, records)).not.toBe(h1);
  });

  it("changes if a ballot's weight is tampered with", () => {
    const h1 = computeCertificateHash("vote-1", "approved", closedAt, records);
    const heavier = [
      { personId: "b", decision: "approved", weight: 2, castBy: null },
      { personId: "a", decision: "not_approved", weight: 1, castBy: null },
    ];
    expect(computeCertificateHash("vote-1", "approved", closedAt, heavier)).not.toBe(h1);
  });

  it("changes if a ballot's proxy attribution (castBy) is tampered with", () => {
    const h1 = computeCertificateHash("vote-1", "approved", closedAt, records);
    const proxied = [
      { personId: "b", decision: "approved", weight: 1, castBy: "a" },
      { personId: "a", decision: "not_approved", weight: 1, castBy: null },
    ];
    expect(computeCertificateHash("vote-1", "approved", closedAt, proxied)).not.toBe(h1);
  });

  it("treats missing weight/castBy as 1/null (records without the columns hash stably)", () => {
    const bare = [
      { personId: "b", decision: "approved" },
      { personId: "a", decision: "not_approved" },
    ];
    expect(computeCertificateHash("vote-1", "approved", closedAt, bare)).toBe(
      computeCertificateHash("vote-1", "approved", closedAt, records),
    );
  });
});

describe("computeLegacyCertificateHash (v1 back-compat)", () => {
  const closedAt = new Date("2026-04-09T12:00:00.000Z");
  const records = [
    { personId: "b", decision: "approved" },
    { personId: "a", decision: "not_approved" },
  ];

  // Independent re-implementation of the pre-weights hash, copied from the old
  // voteTally.ts, so the legacy export is proven byte-identical to what closed
  // votes actually stored.
  function referenceV1(id: string, status: string, closedAt: Date, recs: { personId: string | null; decision: string }[]) {
    const sorted = [...recs]
      .sort((a, b) => (a.personId ?? "").localeCompare(b.personId ?? ""))
      .map((r) => ({ personId: r.personId, decision: r.decision }));
    const approvals = sorted.filter((r) => r.decision.startsWith("approved")).length;
    return crypto
      .createHash("sha256")
      .update(JSON.stringify({ id, status, approvals, total: sorted.length, closedAt: closedAt.toISOString(), records: sorted }))
      .digest("hex");
  }

  it("reproduces the pre-weights hash exactly", () => {
    expect(computeLegacyCertificateHash("vote-1", "approved", closedAt, records)).toBe(
      referenceV1("vote-1", "approved", closedAt, records),
    );
  });

  it("ignores weight/castBy fields (they did not exist in v1)", () => {
    const withExtras = [
      { personId: "b", decision: "approved", weight: 7, castBy: "a" },
      { personId: "a", decision: "not_approved", weight: 2, castBy: null },
    ];
    expect(computeLegacyCertificateHash("vote-1", "approved", closedAt, withExtras)).toBe(
      referenceV1("vote-1", "approved", closedAt, records),
    );
  });

  it("v2 and v1 never collide for the same vote (format is versioned)", () => {
    expect(computeCertificateHash("vote-1", "approved", closedAt, records)).not.toBe(
      computeLegacyCertificateHash("vote-1", "approved", closedAt, records),
    );
  });
});
