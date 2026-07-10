/**
 * Integration tests for the versioned-migration runner (issue #17). Needs a
 * real database — the suite skips itself when DATABASE_URL is absent, same as
 * the other *.integration.test.ts suites.
 *
 * The DATABASE_URL user must be able to CREATE DATABASE (true for the CI
 * service user and the local docker test container): each test migrates a
 * scratch database so the "fresh DB" and "two containers booting at once"
 * paths are exercised for real, not against an already-migrated schema.
 */
import { describe, it, expect, afterAll } from "vitest";
import pg from "pg";

const HAS_DB = !!process.env.DATABASE_URL;
const d = HAS_DB ? describe : describe.skip;

const { Pool, Client } = pg;

function scratchName(): string {
  return `migrate_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

function scratchUrl(name: string): string {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${name}`;
  return url.toString();
}

d("versioned migrations (drizzle migrate + advisory lock)", () => {
  const created: string[] = [];

  async function adminQuery(sql: string): Promise<void> {
    const admin = new Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    try {
      await admin.query(sql);
    } finally {
      await admin.end();
    }
  }

  async function createScratchDb(): Promise<string> {
    const name = scratchName();
    // CREATE DATABASE clones template1 and fails transiently when another
    // session touches it (possible while the parallel suites cold-start), so
    // retry a few times before giving up.
    let lastErr: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await adminQuery(`CREATE DATABASE ${name}`);
        created.push(name);
        return name;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  afterAll(async () => {
    for (const name of created) {
      await adminQuery(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {});
    }
  });

  it("applies the baseline to a FRESH database and records the journal", async () => {
    const { runMigrations } = await import("@workspace/db/migrate");
    const name = await createScratchDb();
    const pool = new Pool({ connectionString: scratchUrl(name), max: 4 });
    try {
      await runMigrations(pool);

      const tables = await pool.query(
        "select table_name from information_schema.tables where table_schema = 'public'"
      );
      const names = tables.rows.map((r) => r.table_name);
      for (const expected of ["people", "boards", "votes", "meetings", "minutes", "tasks", "documents", "ai_usage"]) {
        expect(names, `missing table ${expected}`).toContain(expected);
      }

      const journal = await pool.query("select hash, created_at from drizzle.__drizzle_migrations");
      expect(journal.rows.length).toBeGreaterThanOrEqual(1);
    } finally {
      await pool.end();
    }
  }, 30_000);

  it("is idempotent: a second run on a migrated database is a no-op", async () => {
    const { runMigrations } = await import("@workspace/db/migrate");
    const name = await createScratchDb();
    const pool = new Pool({ connectionString: scratchUrl(name), max: 4 });
    try {
      await runMigrations(pool);
      const before = await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations");
      await runMigrations(pool);
      const after = await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations");
      expect(after.rows[0].n).toBe(before.rows[0].n);
    } finally {
      await pool.end();
    }
  }, 30_000);

  it("is race-safe: two concurrent runners (two booting containers) both succeed, one applies", async () => {
    const { runMigrations } = await import("@workspace/db/migrate");
    const name = await createScratchDb();
    // Two separate pools = two separate "containers" (distinct sessions).
    const poolA = new Pool({ connectionString: scratchUrl(name), max: 2 });
    const poolB = new Pool({ connectionString: scratchUrl(name), max: 2 });
    try {
      // Without the advisory lock, one of these dies on "relation already
      // exists" (drizzle's migrate() reads the journal BEFORE its transaction).
      await Promise.all([runMigrations(poolA), runMigrations(poolB)]);

      const journal = await poolA.query("select count(*)::int as n from drizzle.__drizzle_migrations");
      const migrationCount = journal.rows[0].n as number;
      // Applied exactly once per migration file — no duplicate journal rows.
      const distinct = await poolA.query("select count(distinct created_at)::int as n from drizzle.__drizzle_migrations");
      expect(migrationCount).toBe(distinct.rows[0].n);

      const tables = await poolA.query(
        "select count(*)::int as n from information_schema.tables where table_schema = 'public'"
      );
      expect(tables.rows[0].n).toBeGreaterThan(10);
    } finally {
      await poolA.end();
      await poolB.end();
    }
  }, 30_000);
});
