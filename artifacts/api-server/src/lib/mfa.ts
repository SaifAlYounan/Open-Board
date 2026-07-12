import crypto from "crypto";
import { generateSecret, generateURI, verifySync } from "otplib";
import { db, mfaCredentialsTable, mfaRecoveryCodesTable, boardMembershipsTable, peopleTable } from "@workspace/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { DbClient } from "./numbering";

/**
 * P0.2 — TOTP second factor (F7), designed passkey-ready.
 *
 * Policy: MFA is REQUIRED for anyone who can bind the organization — every
 * admin, and every member who sits on a board (i.e. can cast a vote or sign
 * minutes). Observers and unaffiliated people may enroll but are not forced.
 *
 * Freshness: a session records WHEN the second factor was proven. Signing,
 * approving, and exporting require a RECENT proof (see MFA_FRESHNESS_SECONDS),
 * not merely a session that once passed MFA — so a walked-away-from browser
 * cannot sign minutes hours later.
 */

export const TOTP_STEP_SECONDS = 30;

/** ±1 step of clock skew tolerance (30 s either side). */
const EPOCH_TOLERANCE = 1;

/** How recently the second factor must have been proven for a sensitive action. */
export const MFA_FRESHNESS_SECONDS = Number(process.env.MFA_FRESHNESS_SECONDS || 15 * 60);

export const RECOVERY_CODE_COUNT = 10;

export function generateTotpSecret(): string {
  return generateSecret();
}

/** The otpauth:// URI a client renders as a QR code. The secret never leaves this response. */
export function totpUri(email: string, secret: string): string {
  const issuer = process.env.ORG_NAME || "LQGovernance";
  return generateURI({ strategy: "totp", issuer, label: email, secret });
}

/** The TOTP time-step a timestamp falls in — the replay key. */
export function currentStep(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS);
}

/** Recovery codes are high-entropy random strings; sha256 is the right hash here. */
export function hashRecoveryCode(code: string): string {
  return crypto.createHash("sha256").update(code.trim().toLowerCase()).digest("hex");
}

export function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: n }, () => {
    const raw = crypto.randomBytes(5).toString("hex"); // 10 hex chars, 40 bits
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

/** The person's confirmed TOTP credential, or null if they have not enrolled. */
export async function confirmedTotpCredential(personId: string, dbc: DbClient = db) {
  const [cred] = await dbc
    .select()
    .from(mfaCredentialsTable)
    .where(
      and(
        eq(mfaCredentialsTable.personId, personId),
        eq(mfaCredentialsTable.type, "totp"),
        isNotNull(mfaCredentialsTable.confirmedAt),
      ),
    );
  return cred ?? null;
}

export async function hasConfirmedMfa(personId: string, dbc: DbClient = db): Promise<boolean> {
  return (await confirmedTotpCredential(personId, dbc)) != null;
}

/**
 * Is this person REQUIRED to hold a second factor? Admins always; members who
 * sit on a board (vote/sign-capable) always. Everyone else may opt in.
 */
export async function mfaRequiredFor(personId: string, role: string, dbc: DbClient = db): Promise<boolean> {
  if (role === "admin") return true;
  const memberships = await dbc
    .select({ id: boardMembershipsTable.id, roleInBoard: boardMembershipsTable.roleInBoard })
    .from(boardMembershipsTable)
    .where(eq(boardMembershipsTable.personId, personId));
  // An observer seat carries no voting or signing power.
  return memberships.some((m) => m.roleInBoard !== "observer");
}

/**
 * Verify a TOTP code and consume its time-step (replay defense): the code's own
 * step must be strictly greater than the last step accepted for this credential,
 * so a code observed on the wire cannot be replayed inside its validity window.
 *
 * Two mechanisms, deliberately belt-and-braces:
 *  - otplib's `afterTimeStep` refuses to even match a code at or below the
 *    consumed step (including one accepted via skew tolerance);
 *  - the step consumption is a CONDITIONAL update on the previous value, so two
 *    concurrent requests carrying the same code cannot both win.
 */
export async function verifyTotpAndConsume(
  credentialId: string,
  secret: string,
  code: string,
  lastUsedStep: number | null,
  dbc: DbClient = db,
): Promise<boolean> {
  const cleaned = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;

  const result = verifySync({
    strategy: "totp",
    secret,
    token: cleaned,
    epochTolerance: EPOCH_TOLERANCE,
    ...(lastUsedStep != null ? { afterTimeStep: lastUsedStep } : {}),
  });
  if (!result.valid) return false;

  // The step the code actually belongs to: current step, shifted by the drift
  // otplib matched at (negative = client clock behind, positive = ahead).
  const step = currentStep() + (result.delta ?? 0);
  if (lastUsedStep != null && step <= lastUsedStep) return false;

  // Only succeed if nobody else consumed this (or a later) step first.
  const updated = await dbc
    .update(mfaCredentialsTable)
    .set({ lastUsedStep: step })
    .where(
      and(
        eq(mfaCredentialsTable.id, credentialId),
        lastUsedStep == null
          ? isNull(mfaCredentialsTable.lastUsedStep)
          : eq(mfaCredentialsTable.lastUsedStep, lastUsedStep),
      ),
    )
    .returning({ id: mfaCredentialsTable.id });

  return updated.length > 0;
}

/**
 * Consume a single-use recovery code. Atomic: the UPDATE only flips an UNUSED
 * row, so a code cannot be redeemed twice even under a race.
 */
export async function consumeRecoveryCode(personId: string, code: string, dbc: DbClient = db): Promise<boolean> {
  const hash = hashRecoveryCode(code);
  const consumed = await dbc
    .update(mfaRecoveryCodesTable)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(mfaRecoveryCodesTable.personId, personId),
        eq(mfaRecoveryCodesTable.codeHash, hash),
        isNull(mfaRecoveryCodesTable.usedAt),
      ),
    )
    .returning({ id: mfaRecoveryCodesTable.id });
  return consumed.length > 0;
}

/** Replace this person's recovery codes wholesale. Returns the PLAINTEXT codes — shown once. */
export async function issueRecoveryCodes(personId: string, dbc: DbClient = db): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await dbc.delete(mfaRecoveryCodesTable).where(eq(mfaRecoveryCodesTable.personId, personId));
  await dbc.insert(mfaRecoveryCodesTable).values(
    codes.map((c) => ({ personId, codeHash: hashRecoveryCode(c) })),
  );
  return codes;
}

export async function unusedRecoveryCodeCount(personId: string, dbc: DbClient = db): Promise<number> {
  const rows = await dbc
    .select({ id: mfaRecoveryCodesTable.id })
    .from(mfaRecoveryCodesTable)
    .where(and(eq(mfaRecoveryCodesTable.personId, personId), isNull(mfaRecoveryCodesTable.usedAt)));
  return rows.length;
}

/** Look up a person by id (used by the MFA challenge exchange). */
export async function personById(id: string, dbc: DbClient = db) {
  const [p] = await dbc.select().from(peopleTable).where(eq(peopleTable.id, id));
  return p ?? null;
}
