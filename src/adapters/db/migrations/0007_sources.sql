CREATE TYPE "public"."source_category" AS ENUM('community', 'customer_evidence', 'labour', 'technology', 'market', 'trend', 'regulatory');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('ok', 'degraded', 'failing', 'not_configured', 'disabled');--> statement-breakpoint
CREATE TABLE "fetch_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid,
	"run_id" uuid,
	"url" text NOT NULL,
	"final_url" text,
	"http_status" integer,
	"content_hash" text,
	"bytes" integer DEFAULT 0 NOT NULL,
	"hops" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"robots_decision" text,
	"blocked_reason" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_health_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "source_status" NOT NULL,
	"message" text NOT NULL,
	"items_fetched" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_state" (
	"source_id" uuid PRIMARY KEY NOT NULL,
	"cursor" text,
	"status" "source_status" DEFAULT 'not_configured' NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"backoff_until" timestamp with time zone,
	"last_message" text,
	"last_remedy" text,
	"items_last_run" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"adapter_key" text NOT NULL,
	"name" text NOT NULL,
	"category" "source_category" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secret_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"reliability_tier" integer DEFAULT 3 NOT NULL,
	"poll_interval_sec" integer DEFAULT 3600 NOT NULL,
	"max_items_per_run" integer DEFAULT 50 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fetch_records" ADD CONSTRAINT "fetch_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fetch_records" ADD CONSTRAINT "fetch_records_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_health_events" ADD CONSTRAINT "source_health_events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_state" ADD CONSTRAINT "source_state_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fetch_records_workspace_idx" ON "fetch_records" USING btree ("workspace_id","fetched_at");--> statement-breakpoint
CREATE INDEX "fetch_records_url_idx" ON "fetch_records" USING btree ("url");--> statement-breakpoint
CREATE INDEX "source_health_events_source_idx" ON "source_health_events" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_workspace_name" ON "sources" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "sources_workspace_enabled_idx" ON "sources" USING btree ("workspace_id","enabled");