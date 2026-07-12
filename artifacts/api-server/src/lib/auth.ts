import jwt from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";
import { db, peopleTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required — set it before starting the server.");
}
const JWT_SECRET: string = process.env.SESSION_SECRET;

export interface AuthPayload {
  userId: string;
  email: string;
  role: string;
  // Compared against people.token_version on every request; a mismatch means the
  // token was issued before a password reset or deactivation and is no longer valid.
  tokenVersion?: number;
  // P0.2 — when the second factor was proven for THIS session (epoch seconds).
  // Absent on a password-only session. Sensitive routes require it to be both
  // present and recent (see requireFreshMfa).
  mfaAt?: number;
}

/**
 * P0.2 — the short-lived token issued after a correct password when the account
 * holds a confirmed second factor. It is NOT a session: it carries no `token`
 * cookie and authorizes exactly one thing — exchanging a valid TOTP/recovery
 * code for a real session at POST /auth/mfa/verify.
 */
export interface MfaChallengePayload {
  mfaChallenge: true;
  userId: string;
}

const MFA_CHALLENGE_TTL = "5m";

export function signMfaChallenge(userId: string): string {
  return jwt.sign({ mfaChallenge: true, userId } satisfies MfaChallengePayload, JWT_SECRET, {
    expiresIn: MFA_CHALLENGE_TTL,
  });
}

export function verifyMfaChallenge(token: string): MfaChallengePayload {
  const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as unknown as MfaChallengePayload;
  if (!payload?.mfaChallenge || !payload.userId) throw new Error("Not an MFA challenge token");
  return payload;
}

declare global {
  namespace Express {
    interface Request {
      user?: typeof peopleTable.$inferSelect;
      /** P0.2 — when this session proved its second factor (epoch seconds), if it did. */
      mfaAt?: number;
    }
  }
}

export function signToken(payload: AuthPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });
}

export function verifyToken(token: string): AuthPayload {
  const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] }) as unknown as
    AuthPayload & { mfaChallenge?: unknown };
  // A session token and an MFA CHALLENGE token are signed with the same secret,
  // so this is the one place that keeps them apart: a challenge is exchangeable
  // ONLY at /auth/mfa/verify, never usable as a session. Without this guard a
  // password-only attacker could send the challenge as a Bearer token and pass
  // requireAuth (the challenge carries no tokenVersion, which defaults to 0 and
  // matches a fresh account's) — defeating login-time MFA. Reject it here.
  if (payload && payload.mfaChallenge) {
    throw new Error("MFA challenge token is not a session token");
  }
  return payload;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const cookieToken = (req as any).cookies?.token as string | undefined;
  const headerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = cookieToken || headerToken;

  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const payload = verifyToken(token);
    const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, payload.userId));
    if (!person) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    if (person.active === false) {
      res.status(401).json({ error: "Account is deactivated" });
      return;
    }
    if ((payload.tokenVersion ?? 0) !== person.tokenVersion) {
      res.status(401).json({ error: "Session expired — please log in again" });
      return;
    }
    const { passwordHash: _, ...safeUser } = person;
    req.user = safeUser as typeof peopleTable.$inferSelect;
    req.mfaAt = payload.mfaAt;
    next();
  } catch (err) {
    logger.warn({ err }, "Auth token invalid");
    res.status(401).json({ error: "Invalid token" });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

/**
 * P0.2 — gate for the actions that BIND the organization: signing minutes,
 * approving/rejecting an AI-proposed action, and exporting the whole record.
 *
 * A valid password alone can never reach these: the session must have proven a
 * second factor, and proven it RECENTLY (MFA_FRESHNESS_SECONDS). Enrolment is
 * mandatory for admins and board members, so "I have no second factor" is not
 * an escape hatch — it is a 403 telling them to enroll.
 */
export async function requireFreshMfa(req: Request, res: Response, next: NextFunction): Promise<void> {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { hasConfirmedMfa, MFA_FRESHNESS_SECONDS } = await import("./mfa");

  if (!(await hasConfirmedMfa(user.id))) {
    res.status(403).json({
      error: "This action requires two-factor authentication. Enroll a second factor in your account settings first.",
      code: "mfa_enrollment_required",
    });
    return;
  }

  const provenAt = req.mfaAt;
  if (provenAt == null) {
    res.status(403).json({
      error: "This action requires two-factor authentication. Sign in again with your authenticator.",
      code: "mfa_required",
    });
    return;
  }

  const ageSeconds = Math.floor(Date.now() / 1000) - provenAt;
  if (ageSeconds > MFA_FRESHNESS_SECONDS) {
    res.status(403).json({
      error: "Your two-factor verification has expired for this action. Re-verify to continue.",
      code: "mfa_reverification_required",
    });
    return;
  }

  next();
}
