import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, mfaCredentialsTable, mfaRecoveryCodesTable, peopleTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, signToken } from "../lib/auth";
import { audit, auditInTx } from "../lib/auditLog";
import { writeLimiter } from "../lib/rateLimiters";
import {
  confirmedTotpCredential,
  consumeRecoveryCode,
  generateTotpSecret,
  issueRecoveryCodes,
  mfaRequiredFor,
  totpUri,
  unusedRecoveryCodeCount,
  verifyTotpAndConsume,
} from "../lib/mfa";

/**
 * P0.2 — second-factor enrollment and re-verification (F7).
 *
 * Enrollment is two-step by design: `begin` creates an UNCONFIRMED credential
 * and returns the secret once; `confirm` requires a valid code from it, proving
 * the user actually holds the factor before it becomes their gate. An
 * unconfirmed credential is never accepted at login.
 */
const router = Router();

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

/** Where this account stands: enrolled? required to be? how many recovery codes left? */
router.get("/mfa/status", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  const cred = await confirmedTotpCredential(user.id);
  res.json({
    enrolled: cred != null,
    required: await mfaRequiredFor(user.id, user.role),
    type: cred?.type ?? null,
    enrolledAt: cred?.confirmedAt ?? null,
    remainingRecoveryCodes: cred ? await unusedRecoveryCodeCount(user.id) : 0,
    // Proven in THIS session? (drives the UI's re-verify prompt)
    verifiedThisSession: req.mfaAt != null,
  });
});

/**
 * Begin enrollment: mint a fresh TOTP secret. Returned ONCE, in this response —
 * the client renders the otpauth URI as a QR code. Any prior unconfirmed
 * credential is replaced (restarting enrollment is always safe).
 */
router.post("/mfa/enroll/begin", requireAuth, writeLimiter, async (req, res): Promise<void> => {
  const user = req.user!;

  if (await confirmedTotpCredential(user.id)) {
    res.status(409).json({ error: "A second factor is already enrolled. Remove it first to enroll a new one." });
    return;
  }

  const secret = generateTotpSecret();
  await db.transaction(async (tx) => {
    // Drop any half-finished attempt, then stage the new one (unconfirmed).
    await tx.delete(mfaCredentialsTable).where(eq(mfaCredentialsTable.personId, user.id));
    await tx.insert(mfaCredentialsTable).values({ personId: user.id, type: "totp", secret });
    await auditInTx(tx, req, "mfa_enrollment_started", "person", user.id, {});
  });

  res.json({ secret, otpauthUri: totpUri(user.email, secret) });
});

/**
 * Confirm enrollment with a code from the authenticator. Only now does the
 * factor become real — and only now are recovery codes issued (shown once).
 */
router.post("/mfa/enroll/confirm", requireAuth, writeLimiter, async (req, res): Promise<void> => {
  const user = req.user!;
  const { code } = req.body ?? {};
  if (typeof code !== "string" || !code.trim()) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  const [pending] = await db
    .select()
    .from(mfaCredentialsTable)
    .where(and(eq(mfaCredentialsTable.personId, user.id), eq(mfaCredentialsTable.type, "totp")));

  if (!pending) {
    res.status(400).json({ error: "Start enrollment first." });
    return;
  }
  if (pending.confirmedAt) {
    res.status(409).json({ error: "A second factor is already enrolled." });
    return;
  }

  const ok = await verifyTotpAndConsume(pending.id, pending.secret, code.trim(), pending.lastUsedStep);
  if (!ok) {
    res.status(400).json({ error: "That code is not valid. Check your authenticator and try again." });
    return;
  }

  const recoveryCodes = await db.transaction(async (tx) => {
    await tx
      .update(mfaCredentialsTable)
      .set({ confirmedAt: new Date() })
      .where(eq(mfaCredentialsTable.id, pending.id));
    const codes = await issueRecoveryCodes(user.id, tx);
    await auditInTx(tx, req, "mfa_enrolled", "person", user.id, { type: "totp" });
    return codes;
  });

  // The session that just proved the factor becomes an MFA session immediately —
  // no re-login needed to reach a gated route.
  setSessionCookie(
    res,
    signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
      mfaAt: Math.floor(Date.now() / 1000),
    }),
  );

  // Recovery codes are shown exactly once — only their hashes are stored.
  res.json({ enrolled: true, recoveryCodes });
});

/**
 * Re-verify the second factor inside an existing session, refreshing its
 * freshness stamp. This is what the UI calls when a sign/approve/export route
 * answers `mfa_reverification_required`.
 */
router.post("/mfa/verify", requireAuth, writeLimiter, async (req, res): Promise<void> => {
  const user = req.user!;
  const { code } = req.body ?? {};
  if (typeof code !== "string" || !code.trim()) {
    res.status(400).json({ error: "code is required" });
    return;
  }

  const cred = await confirmedTotpCredential(user.id);
  if (!cred) {
    res.status(400).json({ error: "No second factor is enrolled for this account." });
    return;
  }

  const cleaned = code.trim();
  let ok = await verifyTotpAndConsume(cred.id, cred.secret, cleaned, cred.lastUsedStep);
  if (!ok) ok = await consumeRecoveryCode(user.id, cleaned);

  if (!ok) {
    await audit(req, "mfa_failed", "person", user.id, { context: "reverify" });
    res.status(401).json({ error: "That code is not valid." });
    return;
  }

  await audit(req, "mfa_reverified", "person", user.id, {});
  setSessionCookie(
    res,
    signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
      mfaAt: Math.floor(Date.now() / 1000),
    }),
  );
  res.json({ verified: true });
});

/** Re-issue recovery codes (invalidates the old set). Requires the password. */
router.post("/mfa/recovery-codes", requireAuth, writeLimiter, async (req, res): Promise<void> => {
  const user = req.user!;
  const { password } = req.body ?? {};
  if (typeof password !== "string") {
    res.status(400).json({ error: "Your password is required." });
    return;
  }

  const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, user.id));
  if (!person || !(await bcrypt.compare(password, person.passwordHash))) {
    res.status(401).json({ error: "Password is incorrect." });
    return;
  }
  if (!(await confirmedTotpCredential(user.id))) {
    res.status(400).json({ error: "No second factor is enrolled for this account." });
    return;
  }

  const codes = await db.transaction(async (tx) => {
    const issued = await issueRecoveryCodes(user.id, tx);
    await auditInTx(tx, req, "mfa_recovery_codes_reissued", "person", user.id, {});
    return issued;
  });

  res.json({ recoveryCodes: codes });
});

/**
 * Remove the second factor. Requires the password AND a current code (you must
 * still hold the factor to drop it). Refused outright for anyone whose role
 * REQUIRES MFA — an admin or board member cannot disarm their own gate; the
 * way to change device is enroll-new, not remove-and-linger.
 */
router.delete("/mfa", requireAuth, writeLimiter, async (req, res): Promise<void> => {
  const user = req.user!;
  const { password, code } = req.body ?? {};

  if (await mfaRequiredFor(user.id, user.role)) {
    res.status(403).json({
      error:
        "Two-factor authentication is mandatory for administrators and board members and cannot be removed. To change device, remove this account's board seats or ask another administrator.",
    });
    return;
  }

  if (typeof password !== "string" || typeof code !== "string") {
    res.status(400).json({ error: "Your password and a current code are required." });
    return;
  }

  const [person] = await db.select().from(peopleTable).where(eq(peopleTable.id, user.id));
  if (!person || !(await bcrypt.compare(password, person.passwordHash))) {
    res.status(401).json({ error: "Password is incorrect." });
    return;
  }

  const cred = await confirmedTotpCredential(user.id);
  if (!cred) {
    res.status(400).json({ error: "No second factor is enrolled for this account." });
    return;
  }

  const ok = await verifyTotpAndConsume(cred.id, cred.secret, code.trim(), cred.lastUsedStep);
  if (!ok) {
    res.status(401).json({ error: "That code is not valid." });
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(mfaRecoveryCodesTable).where(eq(mfaRecoveryCodesTable.personId, user.id));
    await tx.delete(mfaCredentialsTable).where(eq(mfaCredentialsTable.personId, user.id));
    await auditInTx(tx, req, "mfa_removed", "person", user.id, {});
  });

  res.json({ removed: true });
});

export default router;
