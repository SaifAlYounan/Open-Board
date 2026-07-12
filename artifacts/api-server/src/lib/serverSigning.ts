import crypto from "crypto";
import type { Request } from "express";
import { db, serverSigningKeysTable } from "@workspace/db";
import { isNull } from "drizzle-orm";
import { generateWrappedKeypair, unwrapPrivateKey, WrongPassphraseError } from "./signing";
import { auditInTx } from "./auditLog";
import { logger } from "./logger";

/**
 * The SERVER's signing identity — external-review item 1 (the circular vote
 * certificate).
 *
 * Custody: the Ed25519 private key sits in the database wrapped EXACTLY like a
 * signer's personal key (scrypt + AES-256-GCM, lib/signing.ts), except the
 * wrapping passphrase is SERVER_SIGNING_SECRET — an environment secret that is
 * never stored in the database. Certificates are minted at vote close, a
 * server-side moment with no human present, so a human passphrase is not an
 * option here.
 *
 * WHAT THIS BUYS. A database dump alone can neither sign nor re-sign: flipping
 * ballots and recomputing the certificate hash no longer passes verification,
 * because the Ed25519 signature over the frozen payload does not recompute
 * from DB contents. That breaks the pre-v3 circularity (verify = recompute
 * the hash from the same mutable rows).
 *
 * THE HONEST LIMIT. An actor who compromises the APP SERVER (environment +
 * database) holds the secret and can re-sign. A v3 certificate is machine
 * attestation of the tally at close time — tamper-evidence against database
 * compromise — not a person's signature (that is the per-user minutes signing)
 * and not an external anchor. See docs/SIGNING.md.
 *
 * FAIL-CLOSED. If the secret is configured but cannot unwrap the stored key,
 * minting THROWS (the vote close rolls back) rather than silently minting an
 * unsigned certificate. If the secret is not configured at all, certificates
 * are minted unsigned in the legacy v2 format — allowed in development,
 * refused in production by checkStartupConfig.
 */

export const SERVER_SIGNING_ALGORITHM = "Ed25519";

export function getServerSigningSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = env.SERVER_SIGNING_SECRET;
  return s && s.trim().length > 0 ? s : null;
}

export interface ServerSigner {
  privateKey: crypto.KeyObject;
  keyId: string;
  publicKey: string;
  fingerprint: string;
}

let cachedSigner: ServerSigner | null = null;

/** Test hook: drop the in-memory signer (e.g. after wiping server_signing_keys). */
export function resetServerSignerCache(): void {
  cachedSigner = null;
}

// A provisioning audit runs outside any HTTP request; auditInTx only reads
// req.user?.id and the client ip, so a bare object attributes it to the
// system (personId null, ip "unknown").
const SYSTEM_REQ = {} as Request;

/**
 * Return the server signer, provisioning the keypair on first use. THROWS
 * (fail-closed) when the secret is configured but wrong for the stored key —
 * a silent unsigned fallback would quietly void every integrity claim.
 * Returns null only when no secret is configured at all.
 */
export async function getServerSigner(): Promise<ServerSigner | null> {
  const secret = getServerSigningSecret();
  if (!secret) return null;
  if (cachedSigner) return cachedSigner;

  const [existing] = await db
    .select()
    .from(serverSigningKeysTable)
    .where(isNull(serverSigningKeysTable.revokedAt))
    .limit(1);

  let row = existing;
  if (!row) {
    const wrapped = generateWrappedKeypair(secret);
    row = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(serverSigningKeysTable)
        .values({
          algorithm: SERVER_SIGNING_ALGORITHM,
          publicKey: wrapped.publicKey,
          fingerprint: wrapped.fingerprint,
          encryptedPrivateKey: wrapped.encryptedPrivateKey,
          kdfSalt: wrapped.kdfSalt,
          kdfN: wrapped.kdfN,
          kdfR: wrapped.kdfR,
          kdfP: wrapped.kdfP,
          cipherIv: wrapped.cipherIv,
          cipherTag: wrapped.cipherTag,
        })
        .returning();
      await auditInTx(tx, SYSTEM_REQ, "server_signing_key_provisioned", "server_signing_key", inserted.id, {
        fingerprint: wrapped.fingerprint,
        algorithm: SERVER_SIGNING_ALGORITHM,
      });
      return inserted;
    });
    // The fingerprint is the value an operator records OUT OF BAND — it is what
    // lets a verifier notice a swapped key later. Same doctrine as user keys.
    logger.warn(
      { fingerprint: row.fingerprint, keyId: row.id },
      "SERVER SIGNING KEY PROVISIONED — record this fingerprint outside the system (docs/SIGNING.md)",
    );
  }

  let privateKey: crypto.KeyObject;
  try {
    privateKey = unwrapPrivateKey(row, secret);
  } catch (err) {
    if (err instanceof WrongPassphraseError) {
      throw new Error(
        "SERVER_SIGNING_SECRET does not unwrap the stored server signing key. " +
          "Refusing to mint unsigned certificates (fail-closed). If the secret was rotated, " +
          "revoke the old key row and provision a new one; see docs/SIGNING.md.",
      );
    }
    throw err;
  }

  cachedSigner = { privateKey, keyId: row.id, publicKey: row.publicKey, fingerprint: row.fingerprint };
  return cachedSigner;
}

/** Detached Ed25519 signature over canonical bytes. */
export function signCanonical(privateKey: crypto.KeyObject, canonical: string): string {
  return crypto.sign(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64");
}

/** Verify a detached signature against a base64 SPKI public key. */
export function verifyCanonical(canonical: string, signatureB64: string, publicKeyB64: string): boolean {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKeyB64, "base64"), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(canonical, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
