import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";
import { pool } from "./index";

/**
 * Versioned-migration runner (issue #17) — replaces `drizzle-kit push --force`
 * at boot. Applies the journaled SQL migrations in lib/db/migrations with
 * drizzle's migrate(): ordered by the meta/_journal.json entries, executed
 * inside a transaction, and recorded in drizzle.__drizzle_migrations.
 *
 * Concurrency: drizzle's migrate() alone is NOT safe under two processes
 * booting at once — it reads the journal table BEFORE opening its transaction,
 * so two racers can both decide to apply and one dies on "already exists"
 * (verified against drizzle-orm's pg dialect source). We therefore serialize
 * runners with a Postgres session advisory lock held on a dedicated
 * connection: the second booter waits, then re-reads the journal and no-ops.
 */

// Arbitrary but stable app-wide lock key for "schema migration in progress".
const MIGRATION_LOCK_KEY = 0x0b0a7d01;

/**
 * Locate the migrations folder. Checked in order:
 *  1. MIGRATIONS_DIR (explicit override)
 *  2. <cwd>/lib/db/migrations        — Docker (WORKDIR /app) and repo root
 *  3. <cwd>/../../lib/db/migrations  — local dev (cwd = artifacts/api-server)
 */
export function resolveMigrationsFolder(): string {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.join(process.cwd(), "lib", "db", "migrations"),
    path.join(process.cwd(), "..", "..", "lib", "db", "migrations"),
  ].filter((c): c is string => !!c);

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "meta", "_journal.json"))) {
      return path.resolve(candidate);
    }
  }
  throw new Error(
    `Could not locate the migrations folder (no meta/_journal.json in: ${candidates.join(", ")}). ` +
      "Set MIGRATIONS_DIR to the lib/db/migrations directory."
  );
}

/** @param targetPool overridable for tests that migrate a scratch database. */
export async function runMigrations(targetPool: pg.Pool = pool): Promise<void> {
  const migrationsFolder = resolveMigrationsFolder();

  // Dedicated connection: the advisory lock is session-scoped, and migrate()
  // must run on the SAME session so its work is serialized under the lock.
  const client = await targetPool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
    try {
      const migrationDb = drizzle(client);
      await migrate(migrationDb, { migrationsFolder });
    } finally {
      await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}
