import bcrypt from "bcryptjs";
import { db, peopleTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/**
 * P0.2 — password hashing cost.
 *
 * Raised from bcrypt cost 10 to 12 (≈4× the work per guess). Existing hashes
 * stay valid and are upgraded transparently on the owner's next successful
 * sign-in (`rehashIfWeak`) — nobody is forced to reset.
 *
 * Not argon2id: that needs a native dependency, and this repo's supply-chain
 * posture (pure-JS deps, `minimumReleaseAge`) argues against adding one for a
 * change that bcrypt-12 already delivers. Revisit if a native build is ever
 * acceptable — argon2id is the stronger primitive.
 */
export const PASSWORD_HASH_COST = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, PASSWORD_HASH_COST);
}

/** The cost baked into an existing bcrypt hash (`$2b$10$...` → 10), or null. */
export function hashCost(hash: string): number | null {
  const m = /^\$2[aby]?\$(\d{2})\$/.exec(hash);
  return m ? Number(m[1]) : null;
}

/**
 * Upgrade an under-cost hash after the plaintext has ALREADY been verified.
 * Never throws — a failed upgrade must not fail the sign-in it rides along with.
 */
export async function rehashIfWeak(personId: string, currentHash: string, verifiedPlain: string): Promise<void> {
  const cost = hashCost(currentHash);
  if (cost != null && cost >= PASSWORD_HASH_COST) return;
  try {
    const upgraded = await hashPassword(verifiedPlain);
    await db.update(peopleTable).set({ passwordHash: upgraded }).where(eq(peopleTable.id, personId));
    logger.info({ personId, from: cost, to: PASSWORD_HASH_COST }, "[password] rehashed at the current cost");
  } catch (err) {
    logger.warn({ err, personId }, "[password] rehash failed — sign-in unaffected");
  }
}
