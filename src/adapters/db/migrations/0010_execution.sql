CREATE TYPE "public"."handoff_status" AS ENUM('prepared', 'delivering', 'delivered', 'failed', 'acknowledged', 'completed');--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"status" "handoff_status" DEFAULT 'prepared' NOT NULL,
	"brief" jsonb NOT NULL,
	"brief_markdown" text NOT NULL,
	"target" text,
	"external_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "handoffs_workspace_status_idx" ON "handoffs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "handoffs_opportunity_idx" ON "handoffs" USING btree ("opportunity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "handoffs_external_ref_key" ON "handoffs" USING btree ("workspace_id","external_ref");