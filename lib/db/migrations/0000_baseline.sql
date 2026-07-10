CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"logo_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"name" text NOT NULL,
	"abbreviation" text,
	"type" text NOT NULL,
	"proxy_limit" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"title" text,
	"avatar_color" text,
	"active" boolean DEFAULT true NOT NULL,
	"token_version" integer DEFAULT 0 NOT NULL,
	"must_reset_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "board_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid,
	"person_id" uuid,
	"role_in_board" text DEFAULT 'member',
	"voting_weight" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "board_memberships_board_id_person_id_unique" UNIQUE("board_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid,
	"title" text NOT NULL,
	"date" timestamp with time zone NOT NULL,
	"location" text,
	"status" text DEFAULT 'scheduled',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid,
	"meeting_id" uuid,
	"resolution_number" text NOT NULL,
	"title" text NOT NULL,
	"resolution_text" text NOT NULL,
	"type" text NOT NULL,
	"deadline" timestamp with time zone,
	"status" text DEFAULT 'open',
	"certificate_hash" text,
	"secret" boolean DEFAULT false,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "votes_resolution_number_unique" UNIQUE("resolution_number")
);
--> statement-breakpoint
CREATE TABLE "agenda_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"vote_id" uuid
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"file_path" text,
	"file_size" integer,
	"mime_type" text DEFAULT 'application/pdf',
	"ai_classification" jsonb,
	"confidential" boolean DEFAULT false NOT NULL,
	"confidential_note" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agenda_documents" (
	"agenda_item_id" uuid,
	"document_id" uuid,
	CONSTRAINT "agenda_documents_agenda_item_id_document_id_pk" PRIMARY KEY("agenda_item_id","document_id")
);
--> statement-breakpoint
CREATE TABLE "vote_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vote_id" uuid,
	"person_id" uuid,
	"decision" text NOT NULL,
	"comment" text,
	"cast_by" uuid,
	"weight" integer DEFAULT 1 NOT NULL,
	"voted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_records_vote_id_person_id_unique" UNIQUE("vote_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "vote_proxies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vote_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"holder_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vote_proxies_vote_id_principal_id_unique" UNIQUE("vote_id","principal_id")
);
--> statement-breakpoint
CREATE TABLE "vote_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vote_id" uuid NOT NULL,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"file_path" text,
	"file_size" integer,
	"mime_type" text DEFAULT 'application/pdf',
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "minutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_id" uuid,
	"content" text NOT NULL,
	"status" text DEFAULT 'draft',
	"pdf_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "minutes_meeting_id_unique" UNIQUE("meeting_id")
);
--> statement-breakpoint
CREATE TABLE "minutes_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minutes_id" uuid,
	"person_id" uuid,
	"type" text DEFAULT 'comment' NOT NULL,
	"original_text" text NOT NULL,
	"comment_text" text NOT NULL,
	"status" text DEFAULT 'pending',
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "minutes_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minutes_id" uuid,
	"person_id" uuid,
	"signature_hash" text NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "minutes_signatures_minutes_id_person_id_unique" UNIQUE("minutes_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "attendance" (
	"meeting_id" uuid,
	"person_id" uuid,
	"status" text DEFAULT 'pending',
	"proxy_holder_id" uuid,
	CONSTRAINT "attendance_meeting_id_person_id_pk" PRIMARY KEY("meeting_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "access_control" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"person_id" uuid,
	"has_access" boolean DEFAULT true,
	CONSTRAINT "access_control_entity_type_entity_id_person_id_unique" UNIQUE("entity_type","entity_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "approval_rule_recusals" (
	"rule_id" uuid,
	"person_id" uuid,
	"reason" text,
	CONSTRAINT "approval_rule_recusals_rule_id_person_id_pk" PRIMARY KEY("rule_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "approval_rule_required_voters" (
	"rule_id" uuid,
	"person_id" uuid,
	CONSTRAINT "approval_rule_required_voters_rule_id_person_id_pk" PRIMARY KEY("rule_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "approval_rule_weights" (
	"rule_id" uuid,
	"person_id" uuid,
	"weight" numeric DEFAULT '1',
	CONSTRAINT "approval_rule_weights_rule_id_person_id_pk" PRIMARY KEY("rule_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "approval_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vote_id" uuid,
	"type" text NOT NULL,
	"min_approvals" integer,
	"quorum" integer,
	"weighted" boolean DEFAULT false,
	"deadline_behavior" text DEFAULT 'lapse',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_rules_vote_id_unique" UNIQUE("vote_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"board_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"assignee_id" uuid,
	"source_meeting_id" uuid,
	"source_minutes_id" uuid,
	"task_number" text,
	"status" text DEFAULT 'todo',
	"due_date" date,
	"ai_extracted" boolean DEFAULT false,
	"source_paragraph" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_task_number_unique" UNIQUE("task_number")
);
--> statement-breakpoint
CREATE TABLE "task_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid,
	"submitted_by" uuid,
	"file_path" text,
	"file_name" text,
	"file_size" integer,
	"ai_verdict" text,
	"ai_reasoning" text,
	"ai_missing" jsonb,
	"secretary_decision" text,
	"secretary_comment" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pending_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid,
	"action_type" text NOT NULL,
	"action_data" jsonb NOT NULL,
	"status" text DEFAULT 'pending',
	"secretary_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_trail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"details" jsonb,
	"ip_address" text,
	"prev_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"board_id" uuid,
	"document_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"stage_index" integer NOT NULL,
	"stage_group" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"board_id" uuid,
	"approval_type" text DEFAULT 'majority' NOT NULL,
	"vote_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "login_lockouts" (
	"key" text PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"day" text PRIMARY KEY NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deleted_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"deleted_by" uuid,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "boards" ADD CONSTRAINT "boards_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_memberships" ADD CONSTRAINT "board_memberships_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_memberships" ADD CONSTRAINT "board_memberships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meetings" ADD CONSTRAINT "meetings_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "votes" ADD CONSTRAINT "votes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_items" ADD CONSTRAINT "agenda_items_vote_id_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."votes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_people_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_documents" ADD CONSTRAINT "agenda_documents_agenda_item_id_agenda_items_id_fk" FOREIGN KEY ("agenda_item_id") REFERENCES "public"."agenda_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agenda_documents" ADD CONSTRAINT "agenda_documents_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_records" ADD CONSTRAINT "vote_records_vote_id_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."votes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_records" ADD CONSTRAINT "vote_records_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_records" ADD CONSTRAINT "vote_records_cast_by_people_id_fk" FOREIGN KEY ("cast_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_proxies" ADD CONSTRAINT "vote_proxies_vote_id_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."votes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_proxies" ADD CONSTRAINT "vote_proxies_principal_id_people_id_fk" FOREIGN KEY ("principal_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_proxies" ADD CONSTRAINT "vote_proxies_holder_id_people_id_fk" FOREIGN KEY ("holder_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_proxies" ADD CONSTRAINT "vote_proxies_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_documents" ADD CONSTRAINT "vote_documents_vote_id_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."votes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vote_documents" ADD CONSTRAINT "vote_documents_uploaded_by_people_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes" ADD CONSTRAINT "minutes_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_suggestions" ADD CONSTRAINT "minutes_suggestions_minutes_id_minutes_id_fk" FOREIGN KEY ("minutes_id") REFERENCES "public"."minutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_suggestions" ADD CONSTRAINT "minutes_suggestions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_signatures" ADD CONSTRAINT "minutes_signatures_minutes_id_minutes_id_fk" FOREIGN KEY ("minutes_id") REFERENCES "public"."minutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "minutes_signatures" ADD CONSTRAINT "minutes_signatures_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_meeting_id_meetings_id_fk" FOREIGN KEY ("meeting_id") REFERENCES "public"."meetings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_proxy_holder_id_people_id_fk" FOREIGN KEY ("proxy_holder_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_control" ADD CONSTRAINT "access_control_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule_recusals" ADD CONSTRAINT "approval_rule_recusals_rule_id_approval_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."approval_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule_recusals" ADD CONSTRAINT "approval_rule_recusals_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule_required_voters" ADD CONSTRAINT "approval_rule_required_voters_rule_id_approval_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."approval_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule_required_voters" ADD CONSTRAINT "approval_rule_required_voters_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule_weights" ADD CONSTRAINT "approval_rule_weights_rule_id_approval_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."approval_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rule_weights" ADD CONSTRAINT "approval_rule_weights_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_rules" ADD CONSTRAINT "approval_rules_vote_id_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."votes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_people_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_meeting_id_meetings_id_fk" FOREIGN KEY ("source_meeting_id") REFERENCES "public"."meetings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_minutes_id_minutes_id_fk" FOREIGN KEY ("source_minutes_id") REFERENCES "public"."minutes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_evidence" ADD CONSTRAINT "task_evidence_submitted_by_people_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_trail" ADD CONSTRAINT "audit_trail_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_created_by_people_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_workflow_id_approval_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."approval_workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_stages" ADD CONSTRAINT "workflow_stages_vote_id_votes_id_fk" FOREIGN KEY ("vote_id") REFERENCES "public"."votes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deleted_records" ADD CONSTRAINT "deleted_records_deleted_by_people_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_memberships_person_id_idx" ON "board_memberships" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "meetings_board_id_idx" ON "meetings" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "votes_board_id_idx" ON "votes" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "documents_board_id_idx" ON "documents" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "documents_uploaded_by_idx" ON "documents" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX "vote_records_vote_id_idx" ON "vote_records" USING btree ("vote_id");--> statement-breakpoint
CREATE INDEX "vote_proxies_vote_id_idx" ON "vote_proxies" USING btree ("vote_id");--> statement-breakpoint
CREATE INDEX "vote_proxies_holder_id_idx" ON "vote_proxies" USING btree ("holder_id");--> statement-breakpoint
CREATE INDEX "vote_documents_vote_id_idx" ON "vote_documents" USING btree ("vote_id");--> statement-breakpoint
CREATE INDEX "minutes_suggestions_minutes_id_idx" ON "minutes_suggestions" USING btree ("minutes_id");--> statement-breakpoint
CREATE INDEX "minutes_signatures_minutes_id_idx" ON "minutes_signatures" USING btree ("minutes_id");--> statement-breakpoint
CREATE INDEX "access_control_entity_lookup" ON "access_control" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "access_control_person_id_idx" ON "access_control" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "tasks_board_id_idx" ON "tasks" USING btree ("board_id");--> statement-breakpoint
CREATE INDEX "tasks_assignee_id_idx" ON "tasks" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "audit_trail_created_at_idx" ON "audit_trail" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "workflow_stages_workflow_id_idx" ON "workflow_stages" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "workflow_stages_vote_id_idx" ON "workflow_stages" USING btree ("vote_id");--> statement-breakpoint
CREATE INDEX "deleted_records_entity_idx" ON "deleted_records" USING btree ("entity_type","entity_id");