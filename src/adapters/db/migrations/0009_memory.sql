CREATE TYPE "public"."opportunity_relationship_kind" AS ENUM('duplicate_of', 'supersedes', 'variant_of', 'depends_on', 'competes_with', 'shares_capability', 'learned_from');--> statement-breakpoint
CREATE TABLE "opportunity_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_opportunity_id" uuid NOT NULL,
	"to_opportunity_id" uuid NOT NULL,
	"kind" "opportunity_relationship_kind" NOT NULL,
	"note" text,
	"asserted_by" text DEFAULT 'manual' NOT NULL,
	"created_by_user_id" uuid,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_relationships" ADD CONSTRAINT "opportunity_relationships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_relationships" ADD CONSTRAINT "opportunity_relationships_from_opportunity_id_opportunities_id_fk" FOREIGN KEY ("from_opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_relationships" ADD CONSTRAINT "opportunity_relationships_to_opportunity_id_opportunities_id_fk" FOREIGN KEY ("to_opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_relationships" ADD CONSTRAINT "opportunity_relationships_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_relationships_unique" ON "opportunity_relationships" USING btree ("from_opportunity_id","to_opportunity_id","kind");--> statement-breakpoint
CREATE INDEX "opportunity_relationships_from_idx" ON "opportunity_relationships" USING btree ("from_opportunity_id");--> statement-breakpoint
CREATE INDEX "opportunity_relationships_to_idx" ON "opportunity_relationships" USING btree ("to_opportunity_id");