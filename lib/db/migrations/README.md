# Migrations

Versioned SQL migrations (issue #17). At boot the server applies them with
drizzle's journaled `migrate()` (`../src/migrate.ts`); CI does the same. Each
migration is a `NNNN_name.sql` file plus a `meta/NNNN_snapshot.json` and an entry
in `meta/_journal.json`.

## Add a migration

1. Edit the schema in `../src/schema/*.ts`.
2. From this package (`pnpm --filter @workspace/db run generate`) generate the
   SQL + snapshot + journal entry.
3. Review the generated SQL. If existing rows need a data backfill (drizzle only
   emits DDL), add it to the `.sql` by hand — e.g. `0002_cool_warpath.sql`
   reassigns `audit_trail.seq` in `(created_at, id)` order so an existing
   deployment's audit hash-chain order is preserved.
4. Apply with `pnpm --filter @workspace/db run migrate`.

## Gotcha: `out` must be relative

`drizzle.config.ts` sets `out: "./migrations"` **relative on purpose**. An
absolute `out` trips a drizzle-kit bug that prepends `./` to the path and then
can't find `meta/*_snapshot.json` (fails with `ENOENT .//Users/...`). Always run
drizzle-kit from this package directory so the relative path resolves.

## Regenerating the snapshot chain

If the `meta/*_snapshot.json` files ever drift from the SQL (e.g. a migration was
hand-authored without a snapshot), rebuild from the last known-good snapshot:
reset `_journal.json` to the good entries, delete the orphaned `.sql`/snapshots,
then `generate` against the current schema to produce a single consistent
migration + snapshot. Verify with a fresh database: `createdb`, `migrate`, then
`generate` again — it must report **"No schema changes."**
