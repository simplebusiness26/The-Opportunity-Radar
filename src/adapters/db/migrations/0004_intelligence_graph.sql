CREATE TYPE "public"."ig_edge_kind" AS ENUM('has_skill', 'owns', 'uses', 'depends_on', 'provides_capability', 'reusable_for', 'constrains', 'supports_goal', 'derived_from', 'reaches');--> statement-breakpoint
CREATE TYPE "public"."ig_node_kind" AS ENUM('person', 'skill', 'project', 'repo', 'capability', 'asset', 'infrastructure', 'knowledge', 'resource', 'constraint', 'goal', 'audience');--> statement-breakpoint
CREATE TYPE "public"."ig_source" AS ENUM('manual', 'github', 'document', 'derived');--> statement-breakpoint
CREATE TYPE "public"."capability_maturity" AS ENUM('experimental', 'working', 'production', 'battle_tested');--> statement-breakpoint
CREATE TYPE "public"."resource_kind" AS ENUM('budget', 'time', 'compute', 'team');--> statement-breakpoint
CREATE TYPE "public"."reuse_readiness" AS ENUM('concept', 'needs_work', 'lift_and_shift', 'drop_in');--> statement-breakpoint
CREATE TABLE "assets" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"asset_kind" text NOT NULL,
	"reuse_readiness" "reuse_readiness" DEFAULT 'needs_work' NOT NULL,
	"licence" text,
	"size_estimate" text,
	"last_change_at" timestamp with time zone,
	"location" text
);
--> statement-breakpoint
CREATE TABLE "capabilities" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"taxonomy_key" text NOT NULL,
	"maturity" "capability_maturity" DEFAULT 'working' NOT NULL,
	"evidence_strength" double precision DEFAULT 0.6 NOT NULL,
	"last_verified_at" timestamp with time zone,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "constraints" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"constraint_kind" text NOT NULL,
	"hard" boolean DEFAULT false NOT NULL,
	"expression" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"project_node_id" uuid,
	"predicted_build_days" double precision,
	"actual_build_days" double precision,
	"predicted_cost" double precision,
	"actual_cost" double precision,
	"predicted_confidence" double precision,
	"predicted_score" double precision,
	"actual_revenue" double precision,
	"retention" jsonb,
	"outcome" text NOT NULL,
	"reason" text,
	"notes" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"recorded_by_user_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"horizon" text DEFAULT 'quarter' NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"metric" text,
	"target" text,
	"weight_hints" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ig_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"from_node_id" uuid NOT NULL,
	"to_node_id" uuid NOT NULL,
	"kind" "ig_edge_kind" NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ig_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "ig_node_kind" NOT NULL,
	"name" text NOT NULL,
	"match_key" text NOT NULL,
	"summary" text,
	"source" "ig_source" DEFAULT 'manual' NOT NULL,
	"confidence" double precision DEFAULT 1 NOT NULL,
	"attrs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verified_at" timestamp with time zone,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_node_id" uuid NOT NULL,
	"structure" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"manifests" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detected_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_call_id" uuid,
	"tokens_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repos" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"default_branch" text,
	"visibility" text,
	"manifest_digest" text,
	"last_analysed_at" timestamp with time zone,
	"last_change_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"resource_kind" "resource_kind" NOT NULL,
	"amount" double precision NOT NULL,
	"unit" text NOT NULL,
	"period" text DEFAULT 'month' NOT NULL,
	"committed" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_node_id_ig_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."ig_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_node_id_ig_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."ig_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capabilities" ADD CONSTRAINT "capabilities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constraints" ADD CONSTRAINT "constraints_node_id_ig_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."ig_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "constraints" ADD CONSTRAINT "constraints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_history" ADD CONSTRAINT "execution_history_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_history" ADD CONSTRAINT "execution_history_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_history" ADD CONSTRAINT "execution_history_project_node_id_ig_nodes_id_fk" FOREIGN KEY ("project_node_id") REFERENCES "public"."ig_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_history" ADD CONSTRAINT "execution_history_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_node_id_ig_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."ig_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_edges" ADD CONSTRAINT "ig_edges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_edges" ADD CONSTRAINT "ig_edges_from_node_id_ig_nodes_id_fk" FOREIGN KEY ("from_node_id") REFERENCES "public"."ig_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_edges" ADD CONSTRAINT "ig_edges_to_node_id_ig_nodes_id_fk" FOREIGN KEY ("to_node_id") REFERENCES "public"."ig_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_nodes" ADD CONSTRAINT "ig_nodes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_analyses" ADD CONSTRAINT "repo_analyses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_analyses" ADD CONSTRAINT "repo_analyses_repo_node_id_repos_node_id_fk" FOREIGN KEY ("repo_node_id") REFERENCES "public"."repos"("node_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_node_id_ig_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."ig_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_node_id_ig_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."ig_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_workspace_kind_idx" ON "assets" USING btree ("workspace_id","asset_kind");--> statement-breakpoint
CREATE INDEX "capabilities_workspace_key_idx" ON "capabilities" USING btree ("workspace_id","taxonomy_key");--> statement-breakpoint
CREATE INDEX "constraints_workspace_idx" ON "constraints" USING btree ("workspace_id","hard");--> statement-breakpoint
CREATE INDEX "execution_history_workspace_idx" ON "execution_history" USING btree ("workspace_id","recorded_at");--> statement-breakpoint
CREATE INDEX "execution_history_opportunity_idx" ON "execution_history" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "goals_workspace_priority_idx" ON "goals" USING btree ("workspace_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "ig_edges_unique" ON "ig_edges" USING btree ("from_node_id","to_node_id","kind");--> statement-breakpoint
CREATE INDEX "ig_edges_from_idx" ON "ig_edges" USING btree ("from_node_id","kind");--> statement-breakpoint
CREATE INDEX "ig_edges_to_idx" ON "ig_edges" USING btree ("to_node_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "ig_nodes_workspace_kind_key" ON "ig_nodes" USING btree ("workspace_id","kind","match_key");--> statement-breakpoint
CREATE INDEX "ig_nodes_workspace_kind_idx" ON "ig_nodes" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE INDEX "repo_analyses_repo_idx" ON "repo_analyses" USING btree ("repo_node_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "repos_workspace_full_name" ON "repos" USING btree ("workspace_id","owner","name");--> statement-breakpoint
CREATE INDEX "resources_workspace_kind_idx" ON "resources" USING btree ("workspace_id","resource_kind");