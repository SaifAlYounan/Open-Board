import crypto from "crypto";
import { db, auditTrailTable } from "@workspace/db";
import { asc, desc, sql } from "drizzle-orm";
import type { Request } from "express";
import type { DbClient } from "./numbering";
import { logger } from "./logger";

export function getClientIp(req: Request): string {
  // req.ip is resolved by Express under `trust proxy` and cannot be spoofed by
  // a client prepending X-Forwarded-For entries.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Serializes chain writes ACROSS processes: every writer takes this advisory
// lock (released automatically at commit/rollback) before reading the chain
// tail, so concurrent transactions — including multiple containers on one
// database — can never pick the same predecessor and fork the chain. This
// replaces the old in-process promise queue, which only serialized one process.
const AUDIT_CHAIN_LOCK_KEY = 0x0b6ad17;

// Deterministic JSON so a jsonb `details` column hashes identically no matter
// how Postgres reorders its keys on retrieval.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(",")}}`;
}

type AuditRow = {
  id: string;
  personId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: unknown;
  ipAddress: string | null;
  createdAt: Date | null;
  prevHash: string | null;
  /** Identifier of the HMAC key that sealed THIS row's prev_hash link; null = unkeyed sha256. */
  keyId?: string | null;
};

export type AuditKey = { key: Buffer; id: string };

// --- Chain keying (external-review item 1) -----------------------------------
// The audit HMAC key is derived (HKDF) from SERVER_SIGNING_SECRET — the same
// secret that wraps the server's certificate-signing key, one secret with two
// derived uses. The key id is a digest OF THE KEY (never the secret), stored on
// each row so a verifier knows which regime sealed each link.
let cachedAuditKey: AuditKey | null | undefined;

export function getAuditKey(env: NodeJS.ProcessEnv = process.env): AuditKey | null {
  if (cachedAuditKey !== undefined) return cachedAuditKey;
  const secret = env.SERVER_SIGNING_SECRET;
  if (!secret || secret.trim().length === 0) {
    cachedAuditKey = null;
    return null;
  }
  const key = Buffer.from(crypto.hkdfSync("sha256", secret, Buffer.alloc(0), "openboard-audit-chain-v1", 32));
  cachedAuditKey = { key, id: crypto.createHash("sha256").update(key).digest("hex").slice(0, 16) };
  return cachedAuditKey;
}

/** Test hook: force re-derivation after changing SERVER_SIGNING_SECRET. */
export function resetAuditKeyCache(): void {
  cachedAuditKey = undefined;
}

// Hash EVERY attributable field, not just id/action/createdAt — otherwise an
// attacker with DB write access could rewrite who did what (personId), to which
// object (entityType/entityId), or the details/ipAddress without breaking the chain.
//
// With a key this is HMAC-SHA-256; without, plain SHA-256 (the legacy regime).
// Each link is computed under the CURRENT row's regime, so the first keyed row
// seals the whole unkeyed history behind it: recomputing any earlier link then
// requires the key, which is not in the database.
function hashRow(row: AuditRow, key: Buffer | null = null): string {
  const material = [
    row.id,
    row.personId ?? "",
    row.action,
    row.entityType ?? "",
    row.entityId ?? "",
    stableStringify(row.details ?? null),
    row.ipAddress ?? "",
    row.createdAt?.toISOString() ?? "",
    row.prevHash ?? "",
  ].join("|");
  return (key ? crypto.createHmac("sha256", key) : crypto.createHash("sha256")).update(material).digest("hex");
}

const AUDIT_ROW_COLUMNS = {
  id: auditTrailTable.id,
  personId: auditTrailTable.personId,
  action: auditTrailTable.action,
  entityType: auditTrailTable.entityType,
  entityId: auditTrailTable.entityId,
  details: auditTrailTable.details,
  ipAddress: auditTrailTable.ipAddress,
  createdAt: auditTrailTable.createdAt,
  prevHash: auditTrailTable.prevHash,
  keyId: auditTrailTable.keyId,
} as const;

/**
 * Write an audit entry inside the caller's transaction (P0.6 — fail-closed).
 * THROWS on failure, rolling the enclosing transaction — and therefore the
 * mutation being audited — back. Wrap every audited mutation as:
 *
 *   await db.transaction(async (tx) => {
 *     ...the mutation, on tx...
 *     await auditInTx(tx, req, "action", ...);
 *   });
 *
 * The advisory xact lock serializes chain writes across all processes; it is
 * released automatically when the transaction commits or rolls back. Take it
 * LAST in the transaction (audit after the mutation) so audited transactions
 * hold it as briefly as possible and always acquire locks in the same order.
 *
 * Each row stores prev_hash over the previous row, forming a hash chain
 * (verify with `verifyAuditChain`). With SERVER_SIGNING_SECRET configured the
 * link is HMAC-SHA-256 under a derived key that is not in the database, so the
 * chain is tamper-evident against an actor with DATABASE write access — they
 * cannot re-seal without the key. It is NOT resistant to an actor who also
 * compromises the app server (env + database); that needs the external anchor
 * described in SECURITY.md. Without the secret the link is plain sha256 and
 * detects naive edits only.
 */
export async function auditInTx(
  tx: DbClient,
  req: Request,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: object
): Promise<void> {
  const personId = req.user?.id ?? null;
  const ip = getClientIp(req);

  try {
    await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK_KEY})`);
    // READ COMMITTED gives each statement a fresh snapshot, so this read —
    // made after the lock is acquired — sees the previous holder's committed row.
    const [prev] = await tx
      .select(AUDIT_ROW_COLUMNS)
      .from(auditTrailTable)
      .orderBy(desc(auditTrailTable.seq))
      .limit(1);

    const auditKey = getAuditKey();
    await tx.insert(auditTrailTable).values({
      personId,
      action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      details: details ?? null,
      ipAddress: ip,
      // The link to the predecessor is sealed under THIS row's regime: HMAC
      // when the server key is configured, sha256 otherwise. keyId records
      // which, so the verifier replays each link the way it was written.
      prevHash: prev ? hashRow(prev, auditKey?.key ?? null) : null,
      keyId: auditKey?.id ?? null,
    });
  } catch (err) {
    logger.error({ err, action, entityType, entityId }, "AUDIT WRITE FAILED — rolling the mutation back (fail-closed)");
    throw err;
  }
}

/**
 * Write a standalone audit entry in its own transaction (P0.6 — fail-closed).
 * For audited events with no enclosing mutation — logins, views, downloads,
 * exports. THROWS on failure: call it BEFORE serving the audited content, so
 * an action that cannot be audited is denied rather than silently unrecorded.
 */
export async function audit(
  req: Request,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: object
): Promise<void> {
  await db.transaction(async (tx) => {
    await auditInTx(tx, req, action, entityType, entityId, details);
  });
}

export interface AuditVerifyResult {
  ok: boolean;
  count: number;
  /** How many rows carry a keyed (HMAC) link. */
  keyedCount?: number;
  /** 1-based position of the first row whose stored prev_hash does not match the
   *  recomputed hash of its predecessor. Undefined when ok. */
  brokenAtIndex?: number;
  brokenRowId?: string;
  /** Why the chain failed, beyond a plain link mismatch. */
  reason?: "link_mismatch" | "key_required" | "key_mismatch" | "keying_regressed";
}

/**
 * Replay the audit chain and check every link (P0.6 + external-review item 1).
 * Rows are ordered exactly as the writers chained them (by the monotonic
 * `seq`). Each row's stored `prev_hash` must equal the recomputed hash of the
 * row before it — HMAC under the audit key for rows whose keyId is set, plain
 * sha256 for legacy rows — and the first row must have a null `prev_hash`.
 * Keying must be monotonic: once a row is keyed, an unkeyed successor is a
 * tamper signal ("keying_regressed"), because the writer never downgrades.
 *
 * WHAT THIS PROVES. Any edit BEFORE the first keyed row now requires the HMAC
 * key to re-seal (the keyed link pins the whole unkeyed history), and any edit
 * after it requires the key outright. The key is derived from
 * SERVER_SIGNING_SECRET, which is not in the database — so this is
 * tamper-evidence against an actor with DATABASE write access.
 *
 * THE HONEST LIMIT. An actor who compromises the APP SERVER (env + database)
 * holds the secret and can re-seal everything — including stripping every
 * keyId to make the chain look pre-keying. Detecting THAT needs the external
 * anchor (a signed chain head held off the host); see SECURITY.md.
 */
export function verifyChainRows(rows: AuditRow[], key: AuditKey | null = null): AuditVerifyResult {
  let prev: AuditRow | null = null;
  let keyedCount = 0;
  let seenKeyed = false;
  for (let i = 0; i < rows.length; i++) {
    const rowKeyId = rows[i].keyId ?? null;
    const fail = (reason: AuditVerifyResult["reason"]): AuditVerifyResult =>
      ({ ok: false, count: rows.length, keyedCount, brokenAtIndex: i + 1, brokenRowId: rows[i].id, reason });

    if (rowKeyId) {
      keyedCount += 1;
      seenKeyed = true;
      if (!key) return fail("key_required");
      if (key.id !== rowKeyId) return fail("key_mismatch");
    } else if (seenKeyed) {
      // The writer keys every row once the secret is configured; a keyed row
      // followed by an unkeyed one means someone rewrote history.
      return fail("keying_regressed");
    }

    const expectedPrevHash = prev ? hashRow(prev, rowKeyId ? key!.key : null) : null;
    if ((rows[i].prevHash ?? null) !== expectedPrevHash) return fail("link_mismatch");
    prev = rows[i];
  }
  return { ok: true, count: rows.length, keyedCount };
}

/** Fetch the whole chain in order and verify it under the configured key. See limits above. */
export async function verifyAuditChain(dbc: DbClient = db): Promise<AuditVerifyResult> {
  const rows = (await dbc
    .select({ ...AUDIT_ROW_COLUMNS })
    .from(auditTrailTable)
    .orderBy(asc(auditTrailTable.seq))) as AuditRow[];
  return verifyChainRows(rows, getAuditKey());
}

/** Exposed for the standalone/offline verifier and tests. */
export { hashRow };
