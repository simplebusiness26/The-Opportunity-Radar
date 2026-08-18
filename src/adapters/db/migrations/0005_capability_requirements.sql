CREATE TYPE "public"."capability_criticality" AS ENUM('nice_to_have', 'important', 'essential');--> statement-breakpoint
CREATE TABLE "opportunity_capability_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"label" text NOT NULL,
	"taxonomy_key" text,
	"criticality" "capability_criticality" DEFAULT 'important' NOT NULL,
	"resolved_by" text DEFAULT 'unresolved' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunity_capability_requirements" ADD CONSTRAINT "opportunity_capability_requirements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_capability_requirements" ADD CONSTRAINT "opportunity_capability_requirements_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_capability_unique" ON "opportunity_capability_requirements" USING btree ("opportunity_id","label");--> statement-breakpoint
CREATE INDEX "opportunity_capability_key_idx" ON "opportunity_capability_requirements" USING btree ("workspace_id","taxonomy_key");