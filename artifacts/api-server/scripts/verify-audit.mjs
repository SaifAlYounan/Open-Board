#!/usr/bin/env node
/**
 * P0.6 — standalone, offline audit-chain verifier.
 *
 * Reimplements the hash INDEPENDENTLY of the server code and connects straight to
 * Postgres, so a third party can run it without trusting the running application.
 * It replays the chain in (created_at, id) order and checks that each row's stored
 * prev_hash equals the recomputed hash of its predecessor.
 *
 *   DATABASE_URL=postgres://… node artifacts/api-server/scripts/verify-audit.mjs
 *
 * Exit 0 = chain intact, exit 1 = a link is broken (prints the first break).
 *
 * NOTE (F2): this proves no NAIVE edit has occurred. It cannot, by itself, detect
 * a full re-seal by an actor with database write access — every hash input is in
 * the row and this algorithm is public. Detecting a re-seal needs the external
 * anchor (a signed chain head held off the database host); see SECURITY.md.
 */
import crypto from "node:crypto";
import pg from "pg";

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function hashRow(row) {
  return crypto
    .createHash("sha256")
    .update(
      [
        row.id,
        row.person_id ?? "",
        row.action,
        row.entity_type ?? "",
        row.entity_id ?? "",
        stableStringify(row.details ?? null),
        row.ip_address ?? "",
        row.created_at ? new Date(row.created_at).toISOString() : "",
        row.prev_hash ?? "",
      ].join("|"),
    )
    .digest("hex");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select id, person_id, action, entity_type, entity_id, details, ip_address, created_at, prev_hash from audit_trail order by seq asc",
    );
    let prev = null;
    for (let i = 0; i < rows.length; i++) {
      const expected = prev ? hashRow(prev) : null;
      if ((rows[i].prev_hash ?? null) !== expected) {
        console.error(`AUDIT CHAIN BROKEN at row ${i + 1}/${rows.length} (id=${rows[i].id}).`);
        console.error("A link does not match — the chain has been edited without a full re-seal.");
        process.exit(1);
      }
      prev = rows[i];
    }
    console.log(`Audit chain intact: ${rows.length} rows verified.`);
    console.log("(Naive tamper only — a full re-seal is undetectable without the external anchor; see SECURITY.md.)");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("verifier failed:", err);
  process.exit(2);
});
