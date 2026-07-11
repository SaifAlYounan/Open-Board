import crypto from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db, peopleTable, passwordResetTokensTable } from "@workspace/db";
import { eq, sql, and, isNull, gt } from "drizzle-orm";
import { signToken, verifyToken, requireAuth, signMfaChallenge, verifyMfaChallenge } from "../lib/auth";
import { loginLockout } from "../lib/loginLockout";
import { audit, auditInTx } from "../lib/auditLog";
import { logger } from "../lib/logger";
import { mailerConfigured, sendPasswordResetEmail } from "../lib/mailer";
import {
  confirmedTotpCredential,
  consumeRecoveryCode,
  hasConfirmedMfa,
  mfaRequiredFor,
  personById,
  unusedRecoveryCodeCount,
  verifyTotpAndConsume,
} from "../lib/mfa";
import { PASSWORD_HASH_COST, rehashIfWeak } from "../lib/password";

const router = Router();

// Constant-time dummy hash used when email is not found — prevents timing-based email enumeration.
const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

function setSessionCookie(res: import("express").Response, token: string): void {
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 15 minutes before trying again." },
});

const loginLimiterByEmail = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `email:${(req.body.email as string)?.toLowerCase() ?? "unknown"}`,
  validate: { xForwardedForHeader: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts for this account. Try again later." },
});

// Per-email throttle for password-reset requests (#3 email bombing): caps how
// many reset emails a single address can trigger, independent of source IP.
// Keyed on the submitted email, so probing many distinct addresses does not
// reveal which exist (each gets its own bucket).
const forgotLimiterByEmail = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `forgot:${(req.body.email as string)?.toLowerCase() ?? "unknown"}`,
  validate: { xForwardedForHeader: false },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many password reset requests. Please wait before trying again." },
});

// Account lockout (30 failures → 24 h) lives in Postgres — see lib/loginLockout.ts.
// It survives restarts and is shared across processes; the two express-rate-limit
// windows above remain the short-window per-IP / per-email throttle in front of it.

router.post("/auth/login", loginLimiter, loginLimiterByEmail, async (req, res): Promise<void> => {
  const { email, password } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !password || !emailRegex.test(email)) {
    res.status(400).json({ error: "Valid email and password required" });
    return;
  }

  const [person] = await db.select().from(peopleTable).where(eq(peopleTable.email, email));
  if (!person) {
    await bcrypt.compare(password, DUMMY_HASH);
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (await loginLockout.isLocked(email)) {
    res.status(403).json({ error: "Account temporarily locked. Try again later." });
    return;
  }

  const valid = await bcrypt.compare(password, person.passwordHash);
  if (!valid) {
    await loginLockout.recordFailure(email);
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  if (person.active === false) {
    res.status(403).json({ error: "Account is deactivated. Contact your Board Secretary." });
    return;
  }

  await loginLockout.clear(email);

  // Opportunistic rehash: accounts hashed at the old cost are upgraded on the
  // next successful sign-in, with no reset required (P0.2).
  await rehashIfWeak(person.id, person.passwordHash, password);

  // P0.2 — a correct password alone does NOT grant a session when the account
  // holds a confirmed second factor. Issue a short-lived CHALLENGE instead; the
  // session is only minted at /auth/mfa/verify once the factor is proven.
  if (await hasConfirmedMfa(person.id)) {
    await audit(req, "login_password_ok_mfa_required", "person", person.id, { email: person.email });
    res.json({ mfaRequired: true, mfaToken: signMfaChallenge(person.id) });
    return;
  }

  // Fail-closed (P0.6): a login that cannot be audited is not granted — audit
  // BEFORE issuing the session. Throws → 500, no cookie.
  await audit(req, "login", "person", person.id, { email: person.email, role: person.role });

  const token = signToken({ userId: person.id, email: person.email, role: person.role, tokenVersion: person.tokenVersion });
  const { passwordHash: _, ...safeUser } = person;

  setSessionCookie(res, token);

  // An admin or board member with no second factor gets a session, but every
  // sign/approve/export route will 403 with mfa_enrollment_required until they
  // enroll — so the flag tells the UI to send them to enrollment now.
  const mfaEnrollmentRequired = await mfaRequiredFor(person.id, person.role);
  res.json({ user: { ...safeUser, avatarColor: person.avatarColor }, mfaEnrollmentRequired });
});

/**
 * P0.2 — exchange the MFA challenge + a TOTP (or recovery) code for a session.
 * This is the ONLY route that mints a session for an MFA-enrolled account.
 */
router.post("/auth/mfa/verify", loginLimiter, async (req, res): Promise<void> => {
  const { mfaToken, code } = req.body ?? {};
  if (typeof mfaToken !== "string" || typeof code !== "string" || !code.trim()) {
    res.status(400).json({ error: "mfaToken and code are required" });
    return;
  }

  let userId: string;
  try {
    ({ userId } = verifyMfaChallenge(mfaToken));
  } catch {
    res.status(401).json({ error: "This sign-in attempt has expired. Start again." });
    return;
  }

  const person = await personById(userId);
  if (!person || person.active === false) {
    res.status(401).json({ error: "Invalid email or password" });
    return;
  }

  const cred = await confirmedTotpCredential(userId);
  if (!cred) {
    res.status(400).json({ error: "No second factor is enrolled for this account." });
    return;
  }

  // A TOTP code, or one of the single-use recovery codes.
  const cleaned = code.trim();
  let ok = await verifyTotpAndConsume(cred.id, cred.secret, cleaned, cred.lastUsedStep);
  let usedRecoveryCode = false;
  if (!ok) {
    ok = await consumeRecoveryCode(userId, cleaned);
    usedRecoveryCode = ok;
  }

  if (!ok) {
    // A wrong second factor counts as a failed login attempt — it feeds the same
    // durable lockout as a wrong password, so the factor can't be brute-forced.
    await loginLockout.recordFailure(person.email);
    await audit(req, "mfa_failed", "person", userId, { email: person.email });
    res.status(401).json({ error: "That code is not valid." });
    return;
  }

  await loginLockout.clear(person.email);
  await audit(req, "login", "person", person.id, {
    email: person.email,
    role: person.role,
    mfa: usedRecoveryCode ? "recovery_code" : "totp",
  });

  const token = signToken({
    userId: person.id,
    email: person.email,
    role: person.role,
    tokenVersion: person.tokenVersion,
    mfaAt: Math.floor(Date.now() / 1000),
  });
  setSessionCookie(res, token);

  const { passwordHash: _, ...safeUser } = person;
  const remainingRecoveryCodes = await unusedRecoveryCodeCount(userId);
  res.json({
    user: { ...safeUser, avatarColor: person.avatarColor },
    usedRecoveryCode,
    remainingRecoveryCodes,
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const person = req.user!;
  const { passwordHash: _, ...safeUser } = person;
  res.json({ ...safeUser, avatarColor: person.avatarColor });
});

router.get("/auth/refresh", requireAuth, async (req, res): Promise<void> => {
  const person = req.user!;
  const token = signToken({ userId: person.id, email: person.email, role: person.role, tokenVersion: person.tokenVersion });

  const isProd = process.env.NODE_ENV === "production";
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });

  res.json({ ok: true });
});

const FORGOT_RESPONSE = { message: "If that email is registered, a reset link has been sent." };

router.post("/auth/forgot-password", loginLimiter, forgotLimiterByEmail, async (req, res): Promise<void> => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email required" });
    return;
  }

  const [person] = await db.select().from(peopleTable).where(eq(peopleTable.email, email));

  // Unknown OR deactivated accounts are treated identically to a valid one from
  // the caller's perspective: same generic response, no token issued (#4 active
  // check). Do a throwaway hash + a DB round-trip so the two branches keep the
  // same rough shape and don't hand out an easy enumeration oracle (#1 — this is
  // best-effort, not cryptographically constant-time, since no bcrypt runs here).
  if (!person || person.active === false) {
    crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
    await db
      .select({ id: passwordResetTokensTable.id })
      .from(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.tokenHash, "__no_such_token__"))
      .limit(1);
    res.json(FORGOT_RESPONSE);
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  // Invalidate any prior unused tokens for this user before issuing a new one
  // (#3/#5): only the newest link works, and a per-user flood can't accumulate
  // live tokens. Fail-closed (P0.6): no token is issued unaudited.
  await db.transaction(async (tx) => {
    await tx
      .update(passwordResetTokensTable)
      .set({ usedAt: new Date() })
      .where(and(eq(passwordResetTokensTable.personId, person.id), isNull(passwordResetTokensTable.usedAt)));

    await tx.insert(passwordResetTokensTable).values({ personId: person.id, tokenHash, expiresAt });
    await auditInTx(tx, req, "password_reset_requested", "person", person.id, { email });
  });

  if (mailerConfigured()) {
    // Fire-and-forget: the response must not wait on SMTP (identical timing for
    // known and unknown emails) and a send failure must never 500 this request.
    void sendPasswordResetEmail(person.email, person.name, token);
    logger.info({ email }, "Password reset token generated — email delivery queued");
  } else {
    // No email service — log only; admin can retrieve token from DB if needed
    logger.info({ email }, "Password reset token generated — relay to user via secure channel");
  }

  res.json(FORGOT_RESPONSE);
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    res.status(400).json({ error: "token and newPassword required" });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 12) {
    res.status(400).json({ error: "Password must be at least 12 characters" });
    return;
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  // Atomically consume the token (#5): a single UPDATE flips used_at only if the
  // token is currently unused and unexpired, so two concurrent requests with the
  // same token can never both succeed (no select-then-update TOCTOU window).
  const [consumed] = await db
    .update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.usedAt),
        gt(passwordResetTokensTable.expiresAt, new Date()),
      ),
    )
    .returning({ personId: passwordResetTokensTable.personId });

  if (!consumed) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }

  // #4 active check: a deactivated account may not reset its password. The token
  // is already consumed above (single-use), which is fine — the account is off.
  const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, consumed.personId));
  if (!person || person.active === false) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  // Bumping tokenVersion invalidates every JWT issued before this reset.
  // Fail-closed (P0.6): the password change rolls back if it cannot be audited
  // (the reset token stays consumed — the user requests a fresh link).
  await db.transaction(async (tx) => {
    await tx
      .update(peopleTable)
      .set({ passwordHash, mustResetPassword: false, tokenVersion: sql`${peopleTable.tokenVersion} + 1` })
      .where(eq(peopleTable.id, consumed.personId));
    await auditInTx(tx, req, "password_reset_completed", "person", consumed.personId, {});
  });

  res.json({ message: "Password reset successfully. You can now log in." });
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "currentPassword and newPassword required" });
    return;
  }
  if (typeof newPassword !== "string" || newPassword.length < 12) {
    res.status(400).json({ error: "Password must be at least 12 characters" });
    return;
  }

  const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, req.user!.id));
  if (!person) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const valid = await bcrypt.compare(currentPassword, person.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  // Fail-closed (P0.6): password change and its audit entry commit together.
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(peopleTable)
      .set({ passwordHash, mustResetPassword: false, tokenVersion: sql`${peopleTable.tokenVersion} + 1` })
      .where(eq(peopleTable.id, person.id))
      .returning();
    await auditInTx(tx, req, "password_changed", "person", person.id, { email: person.email });
    return rows;
  });

  // Old tokens are now invalid — issue a fresh one so this session continues.
  const token = signToken({ userId: updated.id, email: updated.email, role: updated.role, tokenVersion: updated.tokenVersion });
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });

  res.json({ message: "Password changed successfully" });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  // Revoke server-side, don't just clear the cookie: bump tokenVersion so every
  // JWT issued before this logout fails requireAuth's version check. The version
  // is per-user, not per-session, so an explicit logout ends ALL of the user's
  // sessions — standard behavior for a revocation-by-version scheme.
  // Best-effort on purpose: a missing/expired/garbage token still gets a 200 and
  // a cleared cookie, so the client can always complete its logout.
  const cookieToken = (req as any).cookies?.token as string | undefined;
  const headerToken = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const token = cookieToken || headerToken;
  if (token) {
    let payload: ReturnType<typeof verifyToken> | null = null;
    try {
      payload = verifyToken(token);
    } catch {
      // Invalid or expired token — nothing to revoke.
    }
    if (payload) {
      // Fail-closed (P0.6): revocation and its audit entry commit together —
      // an audit failure propagates as a 500 rather than silently revoking
      // (or silently not recording) the logout.
      const userId = payload.userId;
      await db.transaction(async (tx) => {
        await tx
          .update(peopleTable)
          .set({ tokenVersion: sql`${peopleTable.tokenVersion} + 1` })
          .where(eq(peopleTable.id, userId));
        await auditInTx(tx, req, "logout", "person", userId, {});
      });
    }
  }

  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("token", {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    path: "/",
  });
  res.json({ ok: true });
});

export default router;
