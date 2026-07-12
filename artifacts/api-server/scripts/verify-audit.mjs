#!/usr/bin/env node
/**
 * P0.6 + external-review item 1 — standalone, offline audit-chain verifier.
 *
 * Reimplements the hash INDEPENDENTLY of the server code and connects straight to
 * Postgres, so a third party can run it without trusting the running application.
 * It replays the chain in insert (`seq`) order and checks that each row's stored
 * prev_hash equals the recomputed hash of its predecessor — HMAC-SHA-256 under
 * the audit key for rows whose key_id is set, plain SHA-256 for legacy rows.
 *
 *   DATABASE_URL=postgres://… SERVER_SIGNING_SECRET=… \
 *     node artifacts/api-server/scripts/verify-audit.mjs
 *
 * SERVER_SIGNING_SECRET is the deployment's signing secret (the audit key is
 * derived from it with HKDF; the secret itself never touches the database).
 * Without it, only a fully unkeyed chain can be verified.
 *
 * Exit 0 = chain intact, exit 1 = a link is broken (prints the first break).
 *
 * WHAT THIS PROVES / ITS LIMIT. A keyed link cannot be re-sealed by an actor
 * with database write access — the key is not there to steal — and one keyed
 * row pins the entire unkeyed history behind it. An actor who ALSO holds the
 * server's secret (app-server compromise) can re-seal everything; detecting
 * that needs the external anchor (a signed chain head held off the host); see
 * SECURITY.md.
 */
import crypto from "node:crypto";
import pg from "pg";

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

function hashRow(row, key) {
  const material = [
    row.id,
    row.person_id ?? "",
    row.action,
    row.entity_type ?? "",
    row.entity_id ?? "",
    stableStringify(row.details ?? null),
    row.ip_address ?? "",
    row.created_at ? new Date(row.created_at).toISOString() : "",
    row.prev_hash ?? "",
  ].join("|");
  return (key ? crypto.createHmac("sha256", key) : crypto.createHash("sha256")).update(material).digest("hex");
}

function deriveAuditKey(secret) {
  if (!secret || secret.trim().length === 0) return null;
  const key = Buffer.from(crypto.hkdfSync("sha256", secret, Buffer.alloc(0), "openboard-audit-chain-v1", 32));
  return { key, id: crypto.createHash("sha256").update(key).digest("hex").slice(0, 16) };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required.");
    process.exit(2);
  }
  const auditKey = deriveAuditKey(process.env.SERVER_SIGNING_SECRET);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select id, person_id, action, entity_type, entity_id, details, ip_address, created_at, prev_hash, key_id from audit_trail order by seq asc",
    );
    let prev = null;
    let keyed = 0;
    let seenKeyed = false;
    const broken = (i, why) => {
      console.error(`AUDIT CHAIN BROKEN at row ${i + 1}/${rows.length} (id=${rows[i].id}): ${why}`);
      process.exit(1);
    };
    for (let i = 0; i < rows.length; i++) {
      const rowKeyId = rows[i].key_id ?? null;
      if (rowKeyId) {
        keyed += 1;
        seenKeyed = true;
        if (!auditKey) broken(i, "row is HMAC-keyed — set SERVER_SIGNING_SECRET to verify it");
        if (auditKey.id !== rowKeyId) broken(i, `key mismatch (row sealed under ${rowKeyId}, derived key is ${auditKey.id})`);
      } else if (seenKeyed) {
        broken(i, "keyed row followed by an unkeyed one — the writer never downgrades; history was rewritten");
      }
      const expected = prev ? hashRow(prev, rowKeyId ? auditKey.key : null) : null;
      if ((rows[i].prev_hash ?? null) !== expected) {
        broken(i, "a link does not match — the chain has been edited without a valid re-seal");
      }
      prev = rows[i];
    }
    console.log(`Audit chain intact: ${rows.length} rows verified (${keyed} HMAC-keyed, ${rows.length - keyed} legacy sha256).`);
    if (keyed === 0) {
      console.log("(No keyed rows: sha256 only detects naive edits. Configure SERVER_SIGNING_SECRET on the server to key the chain.)");
    } else {
      console.log("(Keyed links cannot be re-sealed from the database alone. An app-server compromise — env + DB — still can; see SECURITY.md.)");
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("verifier failed:", err);
  process.exit(2);
});
