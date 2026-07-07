import crypto from "crypto";
import { db, auditTrailTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import type { Request } from "express";
import { logger } from "./logger";

export function getClientIp(req: Request): string {
  // req.ip is resolved by Express under `trust proxy` and cannot be spoofed by
  // a client prepending X-Forwarded-For entries.
  return req.ip || req.socket?.remoteAddress || "unknown";
}

// Serialize writes so the hash chain never forks under concurrent requests.
let chainTail: Promise<unknown> = Promise.resolve();

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
 * Write an audit entry. Returns a promise that never rejects — await it on
 * security-relevant mutations so the entry is durably written before the
 * response is sent; failures are logged loudly, never swallowed silently.
 *
 * Each row stores prev_hash = SHA-256 over the previous row, forming a
 * tamper-evident chain (verifiable by replaying the table in created_at order).
 */
export function audit(
  req: Request,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: object
): Promise<void> {
  const personId = req.user?.id ?? null;
  const ip = getClientIp(req);

  const write = chainTail.then(async () => {
    try {
      const [prev] = await db
        .select(AUDIT_ROW_COLUMNS)
        .from(auditTrailTable)
        .orderBy(desc(auditTrailTable.createdAt))
        .limit(1);

      await db.insert(auditTrailTable).values({
        personId,
        action,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        details: details ?? null,
        ipAddress: ip,
        prevHash: prev ? hashRow(prev) : null,
      });
    } catch (err) {
      logger.error({ err, action, entityType, entityId }, "AUDIT WRITE FAILED — mutation completed without audit entry");
    }
  });

  chainTail = write;
  return write;
}
