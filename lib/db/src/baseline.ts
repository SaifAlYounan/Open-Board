/**
 * Baseline an EXISTING deployment onto versioned migrations (issue #17).
 *
 * Context: deployments created before v3.1 had their schema applied with
 * `drizzle-kit push --force`, so the database has all the tables but no
 * migration journal. Running migrate() against such a database would try to
 * re-run the baseline migration and fail on the first CREATE TABLE.
 *
 * This script marks the CURRENT migrations as already applied, exactly the way
 * drizzle's migrator records them (drizzle.__drizzle_migrations rows keyed by
 * the journal's `when` timestamp, hash = sha256 of the migration SQL). It:
 *   - refuses to run against an empty database (fresh DBs should just migrate),
 *   - is idempotent (rows already present are left alone).
 *
 * Usage (once, before first boot of the migrations-era version):
 *   DATABASE_URL=postgres://… pnpm --filter @workspace/db run baseline
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = process.env.MIGRATIONS_DIR || path.resolve(here, "..", "migrations");

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set.");
  }

  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    throw new Error(`No migration journal at ${journalPath}`);
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: Array<{ when: number; tag: string }>;
  };

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // Guard: this is for databases that ALREADY carry the pushed schema. On an
    // empty database the right move is a plain migrate (boot does it).
    const { rows: existing } = await client.query(
      "select 1 from information_schema.tables where table_schema = 'public' and table_name = 'people'"
    );
    if (existing.length === 0) {
      throw new Error(
        "This database has no LQGovernance schema — nothing to baseline. " +
          "Fresh databases are migrated automatically at boot (or run: pnpm --filter @workspace/db run migrate)."
      );
    }

    await client.query("CREATE SCHEMA IF NOT EXISTS drizzle");
    await client.query(
      `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
         id SERIAL PRIMARY KEY,
         hash text NOT NULL,
         created_at bigint
       )`
    );

    let inserted = 0;
    for (const entry of journal.entries) {
      const sqlFile = path.join(migrationsFolder, `${entry.tag}.sql`);
      const hash = crypto.createHash("sha256").update(fs.readFileSync(sqlFile, "utf8")).digest("hex");
      const { rows } = await client.query(
        "select 1 from drizzle.__drizzle_migrations where created_at = $1",
        [entry.when]
      );
      if (rows.length > 0) {
        console.log(`= ${entry.tag} already recorded — skipping`);
        continue;
      }
      await client.query("insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)", [
        hash,
        entry.when,
      ]);
      inserted++;
      console.log(`+ ${entry.tag} marked as applied`);
    }
    console.log(
      inserted > 0
        ? `Baseline complete: ${inserted} migration(s) recorded. Future migrations will apply normally at boot.`
        : "Baseline already in place — nothing to do."
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[baseline] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
