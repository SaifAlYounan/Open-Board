import crypto from "crypto";
import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { db, peopleTable, passwordResetTokensTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { signToken, verifyToken, requireAuth } from "../lib/auth";
import { loginLockout } from "../lib/loginLockout";
import { audit } from "../lib/auditLog";
import { logger } from "../lib/logger";
import { mailerConfigured, sendPasswordResetEmail } from "../lib/mailer";

const router = Router();

// Constant-time dummy hash used when email is not found — prevents timing-based email enumeration.
const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

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

  const token = signToken({ userId: person.id, email: person.email, role: person.role, tokenVersion: person.tokenVersion });
  const { passwordHash: _, ...safeUser } = person;

  const isProd = process.env.NODE_ENV === "production";
  res.cookie("token", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  });

  res.json({ user: { ...safeUser, avatarColor: person.avatarColor } });
  audit(req, "login", "person", person.id, { email: person.email, role: person.role });
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

router.post("/auth/forgot-password", loginLimiter, async (req, res): Promise<void> => {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ error: "Email required" });
    return;
  }

  const [person] = await db.select().from(peopleTable).where(eq(peopleTable.email, email));
  if (!person) {
    res.json(FORGOT_RESPONSE);
    return;
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await db.insert(passwordResetTokensTable).values({ personId: person.id, tokenHash, expiresAt });

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
  audit(req, "password_reset_requested", "person", person.id, { email });
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
  const [row] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(eq(passwordResetTokensTable.tokenHash, tokenHash));

  if (!row || row.usedAt || row.expiresAt < new Date()) {
    res.status(400).json({ error: "Invalid or expired reset token" });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  // Bumping tokenVersion invalidates every JWT issued before this reset.
  await db
    .update(peopleTable)
    .set({ passwordHash, mustResetPassword: false, tokenVersion: sql`${peopleTable.tokenVersion} + 1` })
    .where(eq(peopleTable.id, row.personId));
  await db
    .update(passwordResetTokensTable)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokensTable.id, row.id));

  audit(req, "password_reset_completed", "person", row.personId, {});
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
  const [updated] = await db
    .update(peopleTable)
    .set({ passwordHash, mustResetPassword: false, tokenVersion: sql`${peopleTable.tokenVersion} + 1` })
    .where(eq(peopleTable.id, person.id))
    .returning();

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

  await audit(req, "password_changed", "person", person.id, { email: person.email });
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
    try {
      const payload = verifyToken(token);
      await db
        .update(peopleTable)
        .set({ tokenVersion: sql`${peopleTable.tokenVersion} + 1` })
        .where(eq(peopleTable.id, payload.userId));
      audit(req, "logout", "person", payload.userId, {});
    } catch {
      // Invalid or expired token — nothing to revoke.
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
