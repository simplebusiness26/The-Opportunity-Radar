CREATE TYPE "public"."experiment_state" AS ENUM('proposed', 'approved', 'running', 'blocked', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."experiment_verdict" AS ENUM('validated', 'partially_validated', 'inconclusive', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."investigation_state" AS ENUM('queued', 'running', 'complete', 'terminated', 'failed', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."uncertainty_kind" AS ENUM('known_fact', 'assumption', 'unknown', 'critical_unknown', 'evidence_gap');--> statement-breakpoint
CREATE TYPE "public"."uncertainty_status" AS ENUM('open', 'resolved', 'unresolvable', 'superseded');--> statement-breakpoint
CREATE TABLE "experiment_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"label" text NOT NULL,
	"outcome" text DEFAULT 'contacted' NOT NULL,
	"notes" text,
	"contacted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"value" double precision NOT NULL,
	"unit" text,
	"notes" text,
	"evidence_unit_id" uuid,
	"recorded_by_user_id" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiment_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"experiment_id" uuid NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"reason" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"validation_plan_id" uuid,
	"name" text NOT NULL,
	"state" "experiment_state" DEFAULT 'proposed' NOT NULL,
	"state_since" timestamp with time zone DEFAULT now() NOT NULL,
	"verdict" "experiment_verdict",
	"budget" double precision DEFAULT 0 NOT NULL,
	"actual_cost" double precision DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"conclusion" text,
	"owner_user_id" uuid,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigation_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"investigation_id" uuid NOT NULL,
	"schema_key" text NOT NULL,
	"schema_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"prompt_key" text,
	"prompt_version" text,
	"ai_call_id" uuid,
	"projection_report" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"state" "investigation_state" DEFAULT 'queued' NOT NULL,
	"budget_cap_usd" numeric(10, 4),
	"spent_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"termination_reason" text,
	"job_id" uuid,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reevaluation_triggers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"predicate" jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"fired_at" timestamp with time zone,
	"fired_signal_id" uuid,
	"check_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uncertainty_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"kind" "uncertainty_kind" NOT NULL,
	"statement" text NOT NULL,
	"impact" double precision DEFAULT 0.5 NOT NULL,
	"resolvability" double precision DEFAULT 0.5 NOT NULL,
	"cost_to_resolve" double precision,
	"days_to_resolve" double precision,
	"voi_score" double precision DEFAULT 0 NOT NULL,
	"status" "uncertainty_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"evidence_unit_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"hypothesis" text NOT NULL,
	"riskiest_assumption_id" uuid,
	"why_it_matters" text NOT NULL,
	"experiment_type" text NOT NULL,
	"audience" text NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_cost" double precision DEFAULT 0 NOT NULL,
	"estimated_days" double precision DEFAULT 1 NOT NULL,
	"success_threshold" jsonb NOT NULL,
	"failure_threshold" jsonb NOT NULL,
	"evidence_to_collect" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"do_not_build_yet" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "experiment_contacts" ADD CONSTRAINT "experiment_contacts_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_results" ADD CONSTRAINT "experiment_results_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_results" ADD CONSTRAINT "experiment_results_evidence_unit_id_evidence_units_id_fk" FOREIGN KEY ("evidence_unit_id") REFERENCES "public"."evidence_units"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_results" ADD CONSTRAINT "experiment_results_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_transitions" ADD CONSTRAINT "experiment_transitions_experiment_id_experiments_id_fk" FOREIGN KEY ("experiment_id") REFERENCES "public"."experiments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_transitions" ADD CONSTRAINT "experiment_transitions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_validation_plan_id_validation_plans_id_fk" FOREIGN KEY ("validation_plan_id") REFERENCES "public"."validation_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigation_outputs" ADD CONSTRAINT "investigation_outputs_investigation_id_investigations_id_fk" FOREIGN KEY ("investigation_id") REFERENCES "public"."investigations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investigations" ADD CONSTRAINT "investigations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reevaluation_triggers" ADD CONSTRAINT "reevaluation_triggers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reevaluation_triggers" ADD CONSTRAINT "reevaluation_triggers_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uncertainty_items" ADD CONSTRAINT "uncertainty_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uncertainty_items" ADD CONSTRAINT "uncertainty_items_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_plans" ADD CONSTRAINT "validation_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_plans" ADD CONSTRAINT "validation_plans_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_plans" ADD CONSTRAINT "validation_plans_riskiest_assumption_id_uncertainty_items_id_fk" FOREIGN KEY ("riskiest_assumption_id") REFERENCES "public"."uncertainty_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_plans" ADD CONSTRAINT "validation_plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experiment_contacts_experiment_idx" ON "experiment_contacts" USING btree ("experiment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_results_metric" ON "experiment_results" USING btree ("experiment_id","metric_key");--> statement-breakpoint
CREATE INDEX "experiments_workspace_state_idx" ON "experiments" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "investigation_outputs_investigation_idx" ON "investigation_outputs" USING btree ("investigation_id");--> statement-breakpoint
CREATE INDEX "investigations_subject_idx" ON "investigations" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "investigations_workspace_state_idx" ON "investigations" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "reevaluation_triggers_active_idx" ON "reevaluation_triggers" USING btree ("workspace_id","active");--> statement-breakpoint
CREATE INDEX "uncertainty_opportunity_idx" ON "uncertainty_items" USING btree ("opportunity_id","status");--> statement-breakpoint
CREATE INDEX "uncertainty_voi_idx" ON "uncertainty_items" USING btree ("workspace_id","voi_score");--> statement-breakpoint
CREATE INDEX "validation_plans_opportunity_idx" ON "validation_plans" USING btree ("opportunity_id");