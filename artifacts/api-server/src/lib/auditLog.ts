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

function hashRow(row: { id: string; action: string; createdAt: Date | null; prevHash: string | null }): string {
  return crypto
    .createHash("sha256")
    .update(`${row.id}|${row.action}|${row.createdAt?.toISOString() ?? ""}|${row.prevHash ?? ""}`)
    .digest("hex");
}

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
        .select({
          id: auditTrailTable.id,
          action: auditTrailTable.action,
          createdAt: auditTrailTable.createdAt,
          prevHash: auditTrailTable.prevHash,
        })
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
