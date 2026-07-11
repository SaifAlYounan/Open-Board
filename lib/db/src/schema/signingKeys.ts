import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { peopleTable } from "./people";

/**
 * P0.1 — a signer's personal signing key (F6).
 *
 * The PRIVATE key is stored only in encrypted form: wrapped with a key derived
 * (scrypt) from a passphrase that the signer enters at signing time and that
 * the server never stores. So the server cannot sign on a director's behalf —
 * which is what makes a signature attributable to the person rather than to the
 * operator. This is the "sole control" property an eIDAS *advanced* electronic
 * signature requires.
 *
 * `fingerprint` is the short, human-checkable identity of the public key. A
 * signer should record it out of band (it is shown once at enrollment): it is
 * what lets a verifier detect an operator who swapped the recorded public key —
 * the one attack the database cannot defend against on its own. See
 * docs/SIGNING.md.
 */
export const signingKeysTable = pgTable("signing_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").notNull().references(() => peopleTable.id, { onDelete: "cascade" }),
  algorithm: text("algorithm").notNull().default("Ed25519"),
  /** SPKI DER, base64. Public — copied onto every signature so it verifies standalone. */
  publicKey: text("public_key").notNull(),
  /** sha256 of the public key, hex — the value a signer attests to out of band. */
  fingerprint: text("fingerprint").notNull(),
  /** PKCS#8 DER, AES-256-GCM encrypted under a passphrase-derived key. */
  encryptedPrivateKey: text("encrypted_private_key").notNull(),
  kdf: text("kdf").notNull().default("scrypt"),
  kdfSalt: text("kdf_salt").notNull(),
  kdfN: integer("kdf_n").notNull(),
  kdfR: integer("kdf_r").notNull(),
  kdfP: integer("kdf_p").notNull(),
  cipher: text("cipher").notNull().default("aes-256-gcm"),
  cipherIv: text("cipher_iv").notNull(),
  cipherTag: text("cipher_tag").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /** A retired key still verifies its past signatures; it just cannot make new ones. */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  personIdx: index("signing_keys_person_id_idx").on(t.personId),
}));

export type SigningKey = typeof signingKeysTable.$inferSelect;
