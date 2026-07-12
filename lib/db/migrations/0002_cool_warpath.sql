ALTER TABLE "access_control" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "audit_trail" ADD COLUMN "seq" bigserial NOT NULL;--> statement-breakpoint
CREATE INDEX "audit_trail_seq_idx" ON "audit_trail" USING btree ("seq");--> statement-breakpoint
-- P0.6/A2: bigserial assigns seq in physical order. On an EXISTING deployment,
-- reassign in (created_at, id) order so the hash chain's order is preserved,
-- then advance the sequence past the max. No-op on a fresh database.
WITH ordered AS (SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn FROM "audit_trail")
UPDATE "audit_trail" a SET "seq" = o.rn FROM ordered o WHERE a.id = o.id;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('audit_trail', 'seq'), COALESCE((SELECT MAX("seq") FROM "audit_trail"), 0) + 1, false);