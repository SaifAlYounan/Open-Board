/**
 * P0.6 — audit-chain verifier logic (fixes part of F2). Pure, DB-free, and
 * deterministic: builds a chain with the same hashRow the writer uses, then
 * proves an intact chain verifies and a single edited row breaks it. Runs
 * everywhere (no DATABASE_URL needed) — the global audit table is shared across
 * parallel workers, so verification correctness is asserted here, not against it.
 */
import { describe, it, expect } from "vitest";
import { verifyChainRows, hashRow, getAuditKey, resetAuditKeyCache } from "./auditLog";

type Row = Parameters<typeof hashRow>[0];

function baseRow(i: number): Omit<Row, "prevHash"> {
  return {
    id: `00000000-0000-0000-0000-00000000000${i}`,
    personId: `person-${i}`,
    action: `action_${i}`,
    entityType: "document",
    entityId: `doc-${i}`,
    details: { i, note: "x" },
    ipAddress: "10.0.0.1",
    createdAt: new Date(1_700_000_000_000 + i * 1000),
  };
}

/** Build a correctly-chained sequence of `n` rows. */
function buildChain(n: number): Row[] {
  const rows: Row[] = [];
  let prev: Row | null = null;
  for (let i = 1; i <= n; i++) {
    const row: Row = { ...baseRow(i), prevHash: prev ? hashRow(prev) : null };
    rows.push(row);
    prev = row;
  }
  return rows;
}

describe("verifyChainRows (P0.6)", () => {
  it("an empty chain is ok", () => {
    expect(verifyChainRows([])).toEqual({ ok: true, count: 0, keyedCount: 0 });
  });

  it("a single genesis row (null prev_hash) is ok", () => {
    const rows = buildChain(1);
    expect(verifyChainRows(rows).ok).toBe(true);
  });

  it("an intact multi-row chain verifies", () => {
    const r = verifyChainRows(buildChain(5));
    expect(r).toEqual({ ok: true, count: 5, keyedCount: 0 });
  });

  it("editing an attributable field of a row breaks the NEXT link", () => {
    const rows = buildChain(5);
    // Naive tamper: change row 2's action without recomputing row 3's prev_hash.
    rows[1] = { ...rows[1], action: "action_2_TAMPERED" };
    const r = verifyChainRows(rows);
    expect(r.ok).toBe(false);
    expect(r.brokenAtIndex).toBe(3); // row 3's prev_hash no longer matches edited row 2
    expect(r.brokenRowId).toBe(rows[2].id);
  });

  it("a genesis row with a non-null prev_hash is rejected", () => {
    const rows = buildChain(3);
    rows[0] = { ...rows[0], prevHash: "deadbeef" };
    expect(verifyChainRows(rows).ok).toBe(false);
    expect(verifyChainRows(rows).brokenAtIndex).toBe(1);
  });

  it("changing the `details` jsonb is caught (stable stringify covers it)", () => {
    const rows = buildChain(4);
    rows[2] = { ...rows[2], details: { i: 3, note: "TAMPERED" } };
    expect(verifyChainRows(rows).ok).toBe(false);
    expect(verifyChainRows(rows).brokenAtIndex).toBe(4);
  });

  it("A2: only insert-sequence order verifies; (created_at, id) order false-positives", () => {
    // All three rows share a created_at (the collision the old verifier mis-ordered on).
    const t = new Date(1_700_000_000_000);
    // Insert order is r1 -> r2 -> r3, and the chain is built in THAT order.
    // Ids are chosen so sorting by (created_at, id) yields r2, r1, r3 — a
    // different order — exactly the divergence bug A2 fixes with `seq`.
    const mk = (idTail: string, prev: Row | null): Row => ({
      id: `00000000-0000-0000-0000-0000000000${idTail}`,
      personId: "p",
      action: "a",
      entityType: "document",
      entityId: "e",
      details: null,
      ipAddress: "10.0.0.1",
      createdAt: t,
      prevHash: prev ? hashRow(prev) : null,
    });
    const r1 = mk("02", null);
    const r2 = mk("01", r1);
    const r3 = mk("03", r2);

    // Insert/seq order → intact.
    expect(verifyChainRows([r1, r2, r3]).ok).toBe(true);

    // The OLD ordering (created_at, then id asc) = r2, r1, r3 → false "broken".
    const byCreatedAtThenId = [r1, r2, r3].slice().sort((a, b) => a.id.localeCompare(b.id));
    expect(byCreatedAtThenId.map((r) => r.id.slice(-2))).toEqual(["01", "02", "03"]);
    expect(verifyChainRows(byCreatedAtThenId).ok).toBe(false);
  });
});

describe("keyed audit chain (external-review item 1)", () => {
  const KEY = { key: Buffer.from("k".repeat(32)), id: "test-key-id-0001" };
  const OTHER_KEY = { key: Buffer.from("x".repeat(32)), id: "test-key-id-0002" };

  /** Build a chain whose first `unkeyed` rows are legacy sha256, the rest HMAC-keyed. */
  function buildMixedChain(n: number, unkeyed: number): Row[] {
    const rows: Row[] = [];
    let prev: Row | null = null;
    for (let i = 1; i <= n; i++) {
      const keyed = i > unkeyed;
      const row: Row = {
        ...baseRow(i),
        prevHash: prev ? hashRow(prev, keyed ? KEY.key : null) : null,
        keyId: keyed ? KEY.id : null,
      };
      rows.push(row);
      prev = row;
    }
    return rows;
  }

  it("a fully keyed chain verifies with the key", () => {
    expect(verifyChainRows(buildMixedChain(5, 0), KEY)).toEqual({ ok: true, count: 5, keyedCount: 5 });
  });

  it("a keyed chain cannot be verified without the key", () => {
    const r = verifyChainRows(buildMixedChain(5, 0));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("key_required");
  });

  it("the wrong key is reported as a key mismatch, not a broken chain", () => {
    const r = verifyChainRows(buildMixedChain(5, 0), OTHER_KEY);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("key_mismatch");
  });

  it("a mixed chain (unkeyed history, then keyed) verifies with the key", () => {
    expect(verifyChainRows(buildMixedChain(6, 3), KEY)).toEqual({ ok: true, count: 6, keyedCount: 3 });
  });

  it("editing a keyed row breaks the next keyed link", () => {
    const rows = buildMixedChain(5, 0);
    rows[2] = { ...rows[2], action: "TAMPERED" };
    const r = verifyChainRows(rows, KEY);
    expect(r.ok).toBe(false);
    expect(r.brokenAtIndex).toBe(4);
    expect(r.reason).toBe("link_mismatch");
  });

  it("THE POINT: re-sealing the unkeyed history without the key breaks at the first keyed row", () => {
    // The pre-keying attack from the external review: edit a row, then
    // recompute every sha256 link forward. With a keyed row in the chain the
    // re-seal needs the HMAC key, which the database does not hold.
    const rows = buildMixedChain(6, 3);
    rows[0] = { ...rows[0], action: "REWRITTEN_HISTORY" };
    // The attacker CAN recompute the unkeyed links — public sha256…
    rows[1] = { ...rows[1], prevHash: hashRow(rows[0], null) };
    rows[2] = { ...rows[2], prevHash: hashRow(rows[1], null) };
    // …but row 4's stored prevHash is HMAC over the (now changed) row 3, and
    // recomputing THAT needs the key. Verification breaks exactly there.
    const r = verifyChainRows(rows, KEY);
    expect(r.ok).toBe(false);
    expect(r.brokenAtIndex).toBe(4);
    expect(r.reason).toBe("link_mismatch");
  });

  it("a keyed row followed by an unkeyed row is a tamper signal (keying never regresses)", () => {
    const rows = buildMixedChain(4, 0);
    // Attacker strips the key marker from the last row and re-seals it unkeyed.
    rows[3] = { ...rows[3], keyId: null, prevHash: hashRow(rows[2], null) };
    const r = verifyChainRows(rows, KEY);
    expect(r.ok).toBe(false);
    expect(r.brokenAtIndex).toBe(4);
    expect(r.reason).toBe("keying_regressed");
  });

  it("getAuditKey derives a stable key from SERVER_SIGNING_SECRET and none without it", () => {
    resetAuditKeyCache();
    expect(getAuditKey({} as NodeJS.ProcessEnv)).toBeNull();
    resetAuditKeyCache();
    const a = getAuditKey({ SERVER_SIGNING_SECRET: "s".repeat(32) } as unknown as NodeJS.ProcessEnv);
    resetAuditKeyCache();
    const b = getAuditKey({ SERVER_SIGNING_SECRET: "s".repeat(32) } as unknown as NodeJS.ProcessEnv);
    resetAuditKeyCache();
    expect(a).not.toBeNull();
    expect(a!.id).toBe(b!.id);
    expect(a!.key.equals(b!.key)).toBe(true);
    // The key id is a digest of the DERIVED key — 16 hex chars, never the secret.
    expect(a!.id).toMatch(/^[0-9a-f]{16}$/);
  });
});
