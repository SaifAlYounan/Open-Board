import { db, auditTrailTable } from "@workspace/db";
import type { Request } from "express";

export function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

export function audit(
  req: Request,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: object
): void {
  const personId = req.user?.id ?? null;
  const ip = getClientIp(req);
  setImmediate(async () => {
    try {
      await db.insert(auditTrailTable).values({
        personId,
        action,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        details: details ?? null,
        ipAddress: ip,
      });
    } catch {
      // Audit failures must never break the main request flow
    }
  });
}
