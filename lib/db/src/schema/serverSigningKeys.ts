import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * The SERVER's signing identity (vote certificates — external-review item 1).
 *
 * Same custody model as a signer's personal key (signing_keys), with one
 * difference: the wrapping passphrase is the SERVER_SIGNING_SECRET environment
 * variable instead of a human's passphrase, because certificates are minted at
 * vote close — a server-side moment with no human present to type anything.
 *
 * WHAT THIS BUYS. The private key is stored only wrapped (scrypt + AES-256-GCM)
 * under a secret that is NOT in the database. An actor with database write
 * access can flip ballots and recompute the old-style certificate hash, but
 * cannot re-sign: the signature no longer verifies. That breaks the circularity
 * of the pre-v3 certificate (hash recomputed from the same mutable rows).
 *
 * THE HONEST LIMIT. An actor who compromises the APP SERVER (env + database)
 * holds the secret and can re-sign. This is machine attestation of the tally at
 * close time — tamper-evidence against database compromise — not a person's
 * signature and not an external anchor. See docs/SIGNING.md.
 */
export const serverSigningKeysTable = pgTable("server_signing_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  algorithm: text("algorithm").notNull().default("Ed25519"),
  /** SPKI DER, base64. Copied into every v3 certificate payload so it verifies standalone. */
  publicKey: text("public_key").notNull(),
  /** sha256 of the public key, hex — record it out of band at provisioning. */
  fingerprint: text("fingerprint").notNull(),
  /** PKCS#8 DER, AES-256-GCM encrypted under a key derived from SERVER_SIGNING_SECRET. */
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
  /** A retired key still verifies its past certificates; it just cannot mint new ones. */
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export type ServerSigningKey = typeof serverSigningKeysTable.$inferSelect;
