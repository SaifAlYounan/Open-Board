/**
 * Integration tests for the Postgres-backed login lockout (issue #7). Needs a
 * real database — the suite skips itself when DATABASE_URL is absent, same as
 * the other *.integration.test.ts suites.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { integrationSuite } from "../testutil/integrationSuite";

const d = integrationSuite;

d("login lockout store (Postgres-backed)", () => {
  const KEY = "lockout-store-test@test.local";

  async function freshImports() {
    process.env.SESSION_SECRET ||= "test-secret-please-override";
    const { LoginLockoutStore } = await import("./loginLockout");
    const { db, loginLockoutsTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    return { LoginLockoutStore, db, loginLockoutsTable, eq };
  }

  beforeEach(async () => {
    const { db, loginLockoutsTable, eq } = await freshImports();
    await db.delete(loginLockoutsTable).where(eq(loginLockoutsTable.key, KEY));
  });

  it("locks after N failures — and not before", async () => {
    const { LoginLockoutStore } = await freshImports();
    const store = new LoginLockoutStore({ maxFailures: 3, lockoutMs: 60_000 });

    await store.recordFailure(KEY);
    await store.recordFailure(KEY);
    expect(await store.isLocked(KEY)).toBe(false);

    await store.recordFailure(KEY);
    expect(await store.isLocked(KEY)).toBe(true);
  });

  it("holds across a simulated restart (a brand-new store instance)", async () => {
    const { LoginLockoutStore } = await freshImports();
    const store = new LoginLockoutStore({ maxFailures: 2, lockoutMs: 60_000 });
    await store.recordFailure(KEY);
    await store.recordFailure(KEY);
    expect(await store.isLocked(KEY)).toBe(true);

    // "Restart": the old in-memory Map would forget everything here.
    const rebooted = new LoginLockoutStore({ maxFailures: 2, lockoutMs: 60_000 });
    expect(await rebooted.isLocked(KEY)).toBe(true);
  });

  it("unlocks after the lockout expires", async () => {
    const { LoginLockoutStore } = await freshImports();
    const store = new LoginLockoutStore({ maxFailures: 1, lockoutMs: 150 });
    await store.recordFailure(KEY);
    expect(await store.isLocked(KEY)).toBe(true);

    await new Promise((r) => setTimeout(r, 200));
    expect(await store.isLocked(KEY)).toBe(false);
  });

  it("clears the counter on successful login", async () => {
    const { LoginLockoutStore, db, loginLockoutsTable, eq } = await freshImports();
    const store = new LoginLockoutStore({ maxFailures: 3, lockoutMs: 60_000 });
    await store.recordFailure(KEY);
    await store.clear(KEY);

    const rows = await db.select().from(loginLockoutsTable).where(eq(loginLockoutsTable.key, KEY));
    expect(rows).toHaveLength(0);
    expect(await store.isLocked(KEY)).toBe(false);
  });

  it("increments atomically under concurrent failures", async () => {
    const { LoginLockoutStore, db, loginLockoutsTable, eq } = await freshImports();
    const store = new LoginLockoutStore({ maxFailures: 100, lockoutMs: 60_000 });

    await Promise.all(Array.from({ length: 10 }, () => store.recordFailure(KEY)));

    const [row] = await db.select().from(loginLockoutsTable).where(eq(loginLockoutsTable.key, KEY));
    expect(row.failedCount).toBe(10); // no lost updates
  });

  it("sweeps expired rows opportunistically", async () => {
    const { LoginLockoutStore, db, loginLockoutsTable, eq } = await freshImports();
    const store = new LoginLockoutStore({ maxFailures: 1, lockoutMs: 50 });
    await store.recordFailure(KEY);
    await new Promise((r) => setTimeout(r, 100));

    await store.sweepExpired(true);
    const rows = await db.select().from(loginLockoutsTable).where(eq(loginLockoutsTable.key, KEY));
    expect(rows).toHaveLength(0);
  });
});
