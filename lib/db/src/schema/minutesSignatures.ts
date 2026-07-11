import { pgTable, uuid, text, timestamp, unique, index } from "drizzle-orm/pg-core";
import { minutesTable } from "./minutes";
import { peopleTable } from "./people";
import { signingKeysTable } from "./signingKeys";

/**
 * P0.1 — a real electronic signature over the minutes (F6).
 *
 * The former `signature_hash` was an unkeyed sha256 over the content, the
 * signer's name, and a timestamp that was never stored — so it could not be
 * recomputed even by an honest server, and anyone with database write access
 * could mint one. It is kept, nullable, only so pre-existing rows still list;
 * they are reported as `legacy_unverifiable`, never as verified.
 *
 * Every column below is a verification input, and every one is persisted: the
 * detached Ed25519 `signature`, the `content_sha256` it commits to, the
 * `signer_name` attested at the time, the exact `signed_at` instant that was
 * signed, and a COPY of the signer's `public_key` so a signature verifies with
 * no other row and no database at all (see scripts/verify-minutes.mjs).
 */
export const minutesSignaturesTable = pgTable("minutes_signatures", {
  id: uuid("id").primaryKey().defaultRandom(),
  minutesId: uuid("minutes_id").references(() => minutesTable.id),
  personId: uuid("person_id").references(() => peopleTable.id),

  /** Legacy, pre-P0.1. Nullable now; never treated as evidence of anything. */
  signatureHash: text("signature_hash"),

  /** Detached signature over the canonical payload, base64. */
  signature: text("signature"),
  algorithm: text("algorithm"),
  /** The key used, and a copy of its public half (SPKI DER, base64). */
  signingKeyId: uuid("signing_key_id").references(() => signingKeysTable.id),
  publicKey: text("public_key"),
  /** sha256 (hex) of the minutes content AT SIGNING — a later edit no longer verifies. */
  contentSha256: text("content_sha256"),
  /** The signer's name as attested in the signed payload. */
  signerName: text("signer_name"),
  /** Version of the canonical serialization the signature commits to. */
  payloadVersion: text("payload_version"),

  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uniq: unique().on(t.minutesId, t.personId),
  minutesIdx: index("minutes_signatures_minutes_id_idx").on(t.minutesId),
}));

export type MinutesSignature = typeof minutesSignaturesTable.$inferSelect;
