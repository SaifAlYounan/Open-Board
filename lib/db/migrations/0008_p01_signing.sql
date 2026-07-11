CREATE TABLE "signing_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
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
ALTER TABLE "minutes_signatures" ALTER COLUMN "signature_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "minutes_signatures" ADD COLUMN "signature" text;--> statement-breakpoint
ALTER TABLE "minutes_signatures" ADD COLUMN "algorithm" text;--> statement-breakpoint
ALTER TABLE "minutes_signatures" ADD COLUMN "signing_key_id" uuid;--> statement-breakpoint
ALTER TABLE "minutes_signatures" ADD COLUMN "public_key" text;--> statement-breakpoint
ALTER TABLE "minutes_signatures" ADD COLUMN "content_sha256" text;--> statement-breakpoint
ALTER TABLE "minutes_signatures" ADD COLUMN "signer_name" text;--> statement-breakpoint
ALTER TABLE "minutes_signatures" ADD COLUMN "payload_version" text;--> statement-breakpoint
ALTER TABLE "signing_keys" ADD CONSTRAINT "signing_keys_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signing_keys_person_id_idx" ON "signing_keys" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "minutes_signatures" ADD CONSTRAINT "minutes_signatures_signing_key_id_signing_keys_id_fk" FOREIGN KEY ("signing_key_id") REFERENCES "public"."signing_keys"("id") ON DELETE no action ON UPDATE no action;