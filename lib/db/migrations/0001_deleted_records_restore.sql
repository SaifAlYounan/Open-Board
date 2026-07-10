ALTER TABLE "deleted_records" ADD COLUMN "restored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deleted_records" ADD COLUMN "restored_by" uuid;--> statement-breakpoint
ALTER TABLE "deleted_records" ADD CONSTRAINT "deleted_records_restored_by_people_id_fk" FOREIGN KEY ("restored_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;