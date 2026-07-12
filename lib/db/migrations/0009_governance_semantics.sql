CREATE TABLE "server_signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"algorithm" text DEFAULT 'Ed25519' NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"kdf" text DEFAULT 'scrypt' NOT NULL,
	"kdf_salt" text NOT NULL,
	"kdf_n" integer NOT NULL,
	"kdf_r" integer NOT NULL,
	"kdf_p" integer NOT NULL,
	"cipher" text DEFAULT 'aes-256-gcm' NOT NULL,
	"cipher_iv" text NOT NULL,
	"cipher_tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "certificate_version" integer;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "certificate_payload" jsonb;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "certificate_signature" text;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "certificate_key_id" uuid;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "deadline_extended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "votes" ADD COLUMN "deadline_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD COLUMN "extend_days" integer DEFAULT 7;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD COLUMN "quorum_basis" text;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD COLUMN "denominator_basis" text;--> statement-breakpoint
ALTER TABLE "audit_trail" ADD COLUMN "key_id" text;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_certificate_key_id_server_signing_keys_id_fk" FOREIGN KEY ("certificate_key_id") REFERENCES "public"."server_signing_keys"("id") ON DELETE no action ON UPDATE no action;