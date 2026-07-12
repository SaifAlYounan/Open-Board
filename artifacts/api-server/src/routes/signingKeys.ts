import { Router } from "express";
import { db, signingKeysTable } from "@workspace/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { requireAuth } from "../lib/auth";
import { auditInTx } from "../lib/auditLog";
import { writeLimiter } from "../lib/rateLimiters";
import { generateWrappedKeypair } from "../lib/signing";

/**
 * P0.1 — the signer's own signing key (F6).
 *
 * Enrollment is deliberately the ONLY moment the passphrase crosses the wire
 * for key creation, and it is never stored: it wraps the private key, and only
 * the signer can unwrap it again (at signing). Losing the passphrase means the
 * key is gone — a new one must be enrolled, and past signatures keep verifying
 * under the old public key. That is the cost of the server not being able to
 * sign for you, and it is the point.
 */
const router = Router();

/** The signer's active key, if any. */
export async function activeSigningKey(personId: string) {
  const [key] = await db
    .select()
    .from(signingKeysTable)
    .where(and(eq(signingKeysTable.personId, personId), isNull(signingKeysTable.revokedAt)))
    .orderBy(desc(signingKeysTable.createdAt))
    .limit(1);
  return key ?? null;
}

router.get("/signing-keys/me", requireAuth, async (req, res): Promise<void> => {
  const key = await activeSigningKey(req.user!.id);
  res.json(
    key
      ? {
          enrolled: true,
          keyId: key.id,
          algorithm: key.algorithm,
          fingerprint: key.fingerprint,
          createdAt: key.createdAt,
        }
      : { enrolled: false },
  );
});

/**
 * Enroll a signing key. The passphrase wraps the private key and is not stored.
 * Returns the FINGERPRINT — the signer should record it somewhere outside this
 * system, because it is what proves later that the public key on file is still
 * theirs (see docs/SIGNING.md, "the honest limit").
 */
router.post("/signing-keys", requireAuth, writeLimiter, async (req, res): Promise<void> => {
  const user = req.user!;
  const { passphrase } = req.body ?? {};

  if (typeof passphrase !== "string" || passphrase.length < 12) {
    res.status(400).json({ error: "A signing passphrase of at least 12 characters is required." });
    return;
  }

  if (await activeSigningKey(user.id)) {
    res.status(409).json({
      error: "You already have a signing key. Revoke it first if you need to enroll a new one (past signatures keep verifying under the old key).",
    });
    return;
  }

  const wrapped = generateWrappedKeypair(passphrase);

  const key = await db.transaction(async (tx) => {
    const [k] = await tx
      .insert(signingKeysTable)
      .values({
        personId: user.id,
        algorithm: "Ed25519",
        publicKey: wrapped.publicKey,
        fingerprint: wrapped.fingerprint,
        encryptedPrivateKey: wrapped.encryptedPrivateKey,
        kdf: "scrypt",
        kdfSalt: wrapped.kdfSalt,
        kdfN: wrapped.kdfN,
        kdfR: wrapped.kdfR,
        kdfP: wrapped.kdfP,
        cipher: "aes-256-gcm",
        cipherIv: wrapped.cipherIv,
        cipherTag: wrapped.cipherTag,
      })
      .returning();
    await auditInTx(tx, req, "signing_key_enrolled", "person", user.id, {
      keyId: k.id,
      algorithm: "Ed25519",
      fingerprint: k.fingerprint,
    });
    return k;
  });

  res.status(201).json({
    enrolled: true,
    keyId: key.id,
    algorithm: key.algorithm,
    fingerprint: key.fingerprint,
    notice:
      "Record this fingerprint somewhere outside this system. It is how you (or an auditor) later confirm that the public key on file is the one you enrolled. Your passphrase is not stored: if you lose it, this key cannot sign again.",
  });
});

/** Revoke the active key. Past signatures still verify — a key retires, it does not vanish. */
router.delete("/signing-keys", requireAuth, writeLimiter, async (req, res): Promise<void> => {
  const user = req.user!;
  const key = await activeSigningKey(user.id);
  if (!key) {
    res.status(404).json({ error: "You have no active signing key." });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(signingKeysTable)
      .set({ revokedAt: new Date() })
      .where(eq(signingKeysTable.id, key.id));
    await auditInTx(tx, req, "signing_key_revoked", "person", user.id, { keyId: key.id });
  });

  res.json({ revoked: true, keyId: key.id });
});

export default router;
