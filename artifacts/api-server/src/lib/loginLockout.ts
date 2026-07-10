import { db, loginLockoutsTable } from "@workspace/db";
import { and, eq, isNull, isNotNull, lt, or, sql } from "drizzle-orm";
import { logger } from "./logger";

// Same thresholds the old in-memory Map used (issue #7): 30 failures → 24 h lock.
export const MAX_FAILURES = 30;
export const LOCKOUT_MS = 24 * 60 * 60 * 1000;

export interface LoginLockoutOptions {
  maxFailures?: number;
  lockoutMs?: number;
  /** Minimum gap between opportunistic sweeps of expired rows. */
  sweepIntervalMs?: number;
}

/**
 * Postgres-backed login lockout. Replaces the per-process in-memory Map so the
 * counter survives restarts and is shared across processes. Semantics match the
 * old Map exactly:
 *  - every failed password check increments the counter;
 *  - reaching the threshold locks the key for `lockoutMs`;
 *  - a lock that has expired no longer blocks, but the counter remains, so the
 *    next failure re-locks immediately;
 *  - a successful login deletes the row.
 */
export class LoginLockoutStore {
  private readonly maxFailures: number;
  private readonly lockoutMs: number;
  private readonly sweepIntervalMs: number;
  private lastSweep = 0;

  constructor(opts: LoginLockoutOptions = {}) {
    this.maxFailures = opts.maxFailures ?? MAX_FAILURES;
    this.lockoutMs = opts.lockoutMs ?? LOCKOUT_MS;
    this.sweepIntervalMs = opts.sweepIntervalMs ?? 60_000;
  }

  /** Is this key locked out right now? */
  async isLocked(key: string): Promise<boolean> {
    const [row] = await db
      .select({ lockedUntil: loginLockoutsTable.lockedUntil })
      .from(loginLockoutsTable)
      .where(eq(loginLockoutsTable.key, key));
    return !!row?.lockedUntil && row.lockedUntil.getTime() > Date.now();
  }

  /**
   * Record one failed attempt. A single atomic upsert — the counter increments
   * in SQL and the lock engages in the same statement the moment the threshold
   * is reached, so concurrent failures can't lose increments or race past the
   * threshold.
   */
  async recordFailure(key: string): Promise<void> {
    const lockUntil = new Date(Date.now() + this.lockoutMs);
    await db
      .insert(loginLockoutsTable)
      .values({
        key,
        failedCount: 1,
        lockedUntil: this.maxFailures <= 1 ? lockUntil : null,
      })
      .onConflictDoUpdate({
        target: loginLockoutsTable.key,
        set: {
          failedCount: sql`${loginLockoutsTable.failedCount} + 1`,
          // Reaching (or being past) the threshold sets a fresh lock; below it,
          // keep whatever was there (null, or an expired lock awaiting cleanup).
          lockedUntil: sql`case when ${loginLockoutsTable.failedCount} + 1 >= ${this.maxFailures} then ${lockUntil} else ${loginLockoutsTable.lockedUntil} end`,
          updatedAt: sql`now()`,
        },
      });
    // Opportunistic cleanup — fire and forget; never delays or fails the login path.
    void this.sweepExpired().catch((err) => logger.warn({ err }, "login-lockout sweep failed"));
  }

  /** Successful login — forget the key entirely (the old Map.delete). */
  async clear(key: string): Promise<void> {
    await db.delete(loginLockoutsTable).where(eq(loginLockoutsTable.key, key));
  }

  /**
   * Delete rows that no longer protect anything: locks that have expired, and
   * bare counters not touched for a full lockout window. Throttled to at most
   * one sweep per `sweepIntervalMs` per process.
   */
  async sweepExpired(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastSweep < this.sweepIntervalMs) return;
    this.lastSweep = now;
    await db.delete(loginLockoutsTable).where(
      or(
        and(isNotNull(loginLockoutsTable.lockedUntil), lt(loginLockoutsTable.lockedUntil, new Date(now))),
        and(isNull(loginLockoutsTable.lockedUntil), lt(loginLockoutsTable.updatedAt, new Date(now - this.lockoutMs))),
      ),
    );
  }
}

/** The store the login route uses — production thresholds. */
export const loginLockout = new LoginLockoutStore();
