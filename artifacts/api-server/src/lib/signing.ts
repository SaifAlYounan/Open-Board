import crypto from "crypto";

/**
 * P0.1 — per-user Ed25519 minutes signing (F6).
 *
 * WHAT THIS BUYS (and what it does not).
 *
 * The private key exists on the server ONLY wrapped under a passphrase that the
 * signer types at the moment of signing and that is never stored. The server
 * therefore cannot produce a signature for a director — not even a malicious
 * operator with full database access can, because the plaintext key is never
 * there to steal. That is *sole control*, the property that makes a signature
 * attributable to a person, and it is the substance of an eIDAS **advanced**
 * electronic signature (Art. 26): uniquely linked to the signer, capable of
 * identifying them, created with means under their sole control, and bound to
 * the data such that any later change is detectable.
 *
 * THE HONEST LIMIT. An adversary with database write access cannot forge a
 * signature under a signer's key, but they CAN swap the recorded public key for
 * one of their own and re-sign. Nothing inside the database can prevent that —
 * the same structural limit as an audit chain with no external anchor. It is
 * detected only by checking the signer's key FINGERPRINT against a copy held
 * outside the system (the signer's own record of it, shown once at enrollment).
 * A *qualified* signature (QES) closes this by moving key custody and identity
 * binding to a qualified trust service provider with a certificate; that is a
 * procurement decision, not a code change. See docs/SIGNING.md.
 */

export const PAYLOAD_VERSION = "LQGovernance-Minutes-Signature-v1";

// scrypt cost. N=2^15 with r=8 costs ~32 MB and ~100 ms — deliberate friction on
// a key-wrapping passphrase, which is entered rarely and guessed offline.
export const KDF_N = 32768;
export const KDF_R = 8;
export const KDF_P = 1;
const KEY_LEN = 32;
// scrypt's memory ceiling must be raised to admit N=2^15 (default is 32 MB).
const SCRYPT_MAXMEM = 128 * KDF_N * KDF_R * 2;

export interface WrappedKey {
  publicKey: string; // SPKI DER, base64
  fingerprint: string; // sha256(publicKey DER), hex
  encryptedPrivateKey: string; // PKCS#8 DER, AES-256-GCM, base64
  kdfSalt: string;
  kdfN: number;
  kdfR: number;
  kdfP: number;
  cipherIv: string;
  cipherTag: string;
}

function deriveKek(passphrase: string, salt: Buffer, N: number, r: number, p: number): Buffer {
  return crypto.scryptSync(passphrase.normalize("NFKC"), salt, KEY_LEN, {
    N,
    r,
    p,
    maxmem: SCRYPT_MAXMEM,
  });
}

export function publicKeyFingerprint(publicKeyB64: string): string {
  return crypto.createHash("sha256").update(Buffer.from(publicKeyB64, "base64")).digest("hex");
}

/** Generate an Ed25519 keypair and wrap the private half under `passphrase`. */
export function generateWrappedKeypair(passphrase: string): WrappedKey {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;

  const salt = crypto.randomBytes(16);
  const kek = deriveKek(passphrase, salt, KDF_N, KDF_R, KDF_P);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);
  const enc = Buffer.concat([cipher.update(pkcs8), cipher.final()]);
  const tag = cipher.getAuthTag();

  const publicKeyB64 = spki.toString("base64");
  return {
    publicKey: publicKeyB64,
    fingerprint: publicKeyFingerprint(publicKeyB64),
    encryptedPrivateKey: enc.toString("base64"),
    kdfSalt: salt.toString("base64"),
    kdfN: KDF_N,
    kdfR: KDF_R,
    kdfP: KDF_P,
    cipherIv: iv.toString("base64"),
    cipherTag: tag.toString("base64"),
  };
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("Signing passphrase is incorrect");
    this.name = "WrongPassphraseError";
  }
}

/**
 * Unwrap a private key with the signer's passphrase. A wrong passphrase fails
 * on the GCM auth tag — there is no oracle beyond "it did not authenticate".
 * The returned key object lives only for the duration of one signature.
 */
export function unwrapPrivateKey(
  row: {
    encryptedPrivateKey: string;
    kdfSalt: string;
    kdfN: number;
    kdfR: number;
    kdfP: number;
    cipherIv: string;
    cipherTag: string;
  },
  passphrase: string,
): crypto.KeyObject {
  const kek = deriveKek(passphrase, Buffer.from(row.kdfSalt, "base64"), row.kdfN, row.kdfR, row.kdfP);
  const decipher = crypto.createDecipheriv("aes-256-gcm", kek, Buffer.from(row.cipherIv, "base64"));
  decipher.setAuthTag(Buffer.from(row.cipherTag, "base64"));
  let pkcs8: Buffer;
  try {
    pkcs8 = Buffer.concat([
      decipher.update(Buffer.from(row.encryptedPrivateKey, "base64")),
      decipher.final(),
    ]);
  } catch {
    throw new WrongPassphraseError();
  }
  return crypto.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
}

export interface SignaturePayload {
  minutesId: string;
  contentSha256: string;
  signerId: string;
  signerName: string;
  /** The EXACT instant persisted on the signature row — the old code signed one it never stored. */
  signedAt: string;
  algorithm: string;
  publicKey: string;
}

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/**
 * The canonical bytes a signature commits to. Deterministic, order-fixed, and
 * reconstructible from persisted data alone — the whole point of F6. Every
 * field that gives the signature meaning is inside it: change the minutes text,
 * the signer, the timestamp, or the key, and verification fails.
 *
 * Each VALUE is JSON-escaped. The fields are newline-separated, so a value that
 * itself contained a newline could otherwise fake a field boundary: a signer
 * named `Bob\nsignedAt:1999-01-01T00:00:00.000Z` would serialize identically to
 * a different, honest payload — two distinct records, one signature. Escaping
 * makes the encoding injective, which is the property a canonical form has to
 * have. (Names are sanitized upstream today; a signature format must not depend
 * on that staying true.)
 */
function field(name: string, value: string): string {
  return `${name}:${JSON.stringify(value ?? "")}`;
}

export function canonicalPayload(p: SignaturePayload): string {
  return [
    PAYLOAD_VERSION,
    field("minutesId", p.minutesId),
    field("contentSha256", p.contentSha256),
    field("signerId", p.signerId),
    field("signerName", p.signerName),
    field("signedAt", p.signedAt),
    field("algorithm", p.algorithm),
    field("publicKey", p.publicKey),
  ].join("\n");
}

export function signPayload(privateKey: crypto.KeyObject, payload: SignaturePayload): string {
  const bytes = Buffer.from(canonicalPayload(payload), "utf8");
  // Ed25519 takes no separate digest algorithm — pass null.
  return crypto.sign(null, bytes, privateKey).toString("base64");
}

export function verifyPayload(payload: SignaturePayload, signatureB64: string, publicKeyB64: string): boolean {
  try {
    const key = crypto.createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
    const bytes = Buffer.from(canonicalPayload(payload), "utf8");
    return crypto.verify(null, bytes, key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

export type SignatureStatus = "verified" | "invalid" | "legacy_unverifiable";

export interface SignatureRowLike {
  signature: string | null;
  algorithm: string | null;
  publicKey: string | null;
  contentSha256: string | null;
  signerName: string | null;
  personId: string | null;
  minutesId: string | null;
  signedAt: Date | string;
  payloadVersion: string | null;
}

/**
 * Verify ONE signature against the live minutes content.
 *
 * Two independent checks, both required:
 *  1. the content hash the signature commits to still matches the minutes as
 *     they stand (so an edit after signing is detected), and
 *  2. the Ed25519 signature verifies over the canonical payload rebuilt from
 *     the persisted row (so a forged or altered row is detected).
 *
 * A row with no `signature` is pre-P0.1 and is reported `legacy_unverifiable` —
 * never "verified". Silence would be the lie the old code told.
 */
export function verifySignatureRow(
  row: SignatureRowLike,
  content: string,
): { status: SignatureStatus; reason?: string } {
  if (!row.signature || !row.publicKey || !row.contentSha256 || !row.algorithm) {
    return { status: "legacy_unverifiable", reason: "Signed before cryptographic signing was introduced" };
  }
  if (row.payloadVersion !== PAYLOAD_VERSION) {
    return { status: "invalid", reason: `Unknown payload version: ${row.payloadVersion ?? "none"}` };
  }
  if (row.algorithm !== "Ed25519") {
    return { status: "invalid", reason: `Unsupported algorithm: ${row.algorithm}` };
  }

  const liveHash = sha256Hex(content);
  if (liveHash !== row.contentSha256) {
    return { status: "invalid", reason: "The minutes content has changed since it was signed" };
  }

  const signedAt = row.signedAt instanceof Date ? row.signedAt.toISOString() : new Date(row.signedAt).toISOString();
  const ok = verifyPayload(
    {
      minutesId: row.minutesId ?? "",
      contentSha256: row.contentSha256,
      signerId: row.personId ?? "",
      signerName: row.signerName ?? "",
      signedAt,
      algorithm: row.algorithm,
      publicKey: row.publicKey,
    },
    row.signature,
    row.publicKey,
  );

  return ok
    ? { status: "verified" }
    : { status: "invalid", reason: "Signature does not verify over the signed data" };
}
