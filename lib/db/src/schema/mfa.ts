import { pgTable, uuid, text, timestamp, integer, index, unique } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

/**
 * P0.2 — second-factor credentials.
 *
 * Passkey-ready by construction: `type` discriminates the credential kind and
 * `secret` holds the type-specific material. Today only "totp" is issued (the
 * base32 shared secret). A WebAuthn/passkey credential slots in as
 * type="webauthn" with the COSE public key + credential id in the same row,
 * without a schema change to the enrollment/verification flow.
 *
 * `confirmedAt` is the enrollment gate: a row exists from the moment enrollment
 * starts, but the factor only counts once the user has proven possession by
 * entering a valid code. An unconfirmed row is never accepted at login.
 */
export const mfaCredentialsTable = pgTable("mfa_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").notNull().references(() => peopleTable.id, { onDelete: "cascade" }),
  type: text("type", { enum: ["totp", "webauthn"] }).notNull().default("totp"),
  // TOTP: the base32 shared secret. WebAuthn (future): the public key.
  secret: text("secret").notNull(),
  label: text("label"),
  // Replay defense: the last TOTP time-step accepted for this credential. A code
  // is rejected if its step is not strictly greater — so a code observed on the
  // wire cannot be replayed inside its own validity window.
  lastUsedStep: integer("last_used_step"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  personIdx: index("mfa_credentials_person_id_idx").on(t.personId),
}));

/**
 * Single-use recovery codes, HASHED at rest (sha256 — these are high-entropy
 * random codes, not user-chosen passwords, so a fast hash is the right choice:
 * there is nothing to brute-force offline within a useful horizon).
 */
export const mfaRecoveryCodesTable = pgTable("mfa_recovery_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").notNull().references(() => peopleTable.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  personIdx: index("mfa_recovery_codes_person_id_idx").on(t.personId),
  uniqueHash: unique("mfa_recovery_codes_hash_unique").on(t.personId, t.codeHash),
}));

export type MfaCredential = typeof mfaCredentialsTable.$inferSelect;
export type MfaRecoveryCode = typeof mfaRecoveryCodesTable.$inferSelect;
