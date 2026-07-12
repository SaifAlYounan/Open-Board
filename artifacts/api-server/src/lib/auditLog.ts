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
};

// Hash EVERY attributable field, not just id/action/createdAt — otherwise an
// attacker with DB write access could rewrite who did what (personId), to which
// object (entityType/entityId), or the details/ipAddress without breaking the chain.
function hashRow(row: AuditRow): string {
  return crypto
    .createHash("sha256")
    .update(
      [
        row.id,
        row.personId ?? "",
        row.action,
        row.entityType ?? "",
        row.entityId ?? "",
        stableStringify(row.details ?? null),
        row.ipAddress ?? "",
        row.createdAt?.toISOString() ?? "",
        row.prevHash ?? "",
      ].join("|"),
    )
    .digest("hex");
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
 * Each row stores prev_hash = SHA-256 over the previous row, forming a hash
 * chain (verify with `verifyAuditChain`). This detects a naive row edit; it is
 * NOT resistant to an actor with DB write access, who can re-seal the chain —
 * that needs the external anchor described in SECURITY.md.
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

    await tx.insert(auditTrailTable).values({
      personId,
      action,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
      details: details ?? null,
      ipAddress: ip,
      prevHash: prev ? hashRow(prev) : null,
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
  /** 1-based position of the first row whose stored prev_hash does not match the
   *  recomputed hash of its predecessor. Undefined when ok. */
  brokenAtIndex?: number;
  brokenRowId?: string;
}

/**
 * Replay the audit chain and check every link (P0.6). Rows are ordered exactly
 * as the writers chained them (by the monotonic `seq`). Each row's stored
 * `prev_hash` must equal the recomputed hash of the row before it; the first
 * row must have a null `prev_hash`.
 *
 * IMPORTANT (F2): this detects a naive edit — a row changed without recomputing
 * the forward hashes. It does NOT, on its own, detect a full re-seal by an actor
 * with database write access, because every hash input lives in the row and the
 * algorithm is public. Detecting a re-seal requires the external anchor (a signed
 * chain head held off the database host); see SECURITY.md.
 */
/**
 * Pure chain check over already-ordered rows (deterministic, DB-free — the unit
 * of the verifier). Rows MUST be in chain order (ascending seq).
 */
export function verifyChainRows(rows: AuditRow[]): AuditVerifyResult {
  let prev: AuditRow | null = null;
  for (let i = 0; i < rows.length; i++) {
    const expectedPrevHash = prev ? hashRow(prev) : null;
    if ((rows[i].prevHash ?? null) !== expectedPrevHash) {
      return { ok: false, count: rows.length, brokenAtIndex: i + 1, brokenRowId: rows[i].id };
    }
    prev = rows[i];
  }
  return { ok: true, count: rows.length };
}

/** Fetch the whole chain in order and verify it. See F2 caveat above. */
export async function verifyAuditChain(dbc: DbClient = db): Promise<AuditVerifyResult> {
  const rows = (await dbc
    .select({ ...AUDIT_ROW_COLUMNS })
    .from(auditTrailTable)
    .orderBy(asc(auditTrailTable.seq))) as AuditRow[];
  return verifyChainRows(rows);
}

/** Exposed for the standalone/offline verifier and tests. */
export { hashRow };
