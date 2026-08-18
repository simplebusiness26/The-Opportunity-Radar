CREATE TYPE "public"."ai_call_status" AS ENUM('ok', 'repaired', 'invalid_output', 'error', 'refused', 'blocked_by_budget');--> statement-breakpoint
CREATE TYPE "public"."ai_provider_kind" AS ENUM('openai', 'anthropic', 'gemini', 'openai_compatible', 'fixture');--> statement-breakpoint
CREATE TYPE "public"."ai_role" AS ENUM('cheap_extraction', 'classification', 'research', 'reasoning', 'high_value_decision', 'embedding');--> statement-breakpoint
CREATE TYPE "public"."budget_period" AS ENUM('daily', 'monthly');--> statement-breakpoint
CREATE TABLE "ai_call_payloads" (
	"ai_call_id" uuid PRIMARY KEY NOT NULL,
	"request" jsonb,
	"response" jsonb,
	"redacted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" "ai_role" NOT NULL,
	"provider_id" uuid,
	"model_id" uuid,
	"model_key" text NOT NULL,
	"prompt_key" text,
	"prompt_version" text,
	"schema_key" text,
	"schema_version" text,
	"job_id" uuid,
	"run_id" uuid,
	"subject_type" text,
	"subject_id" uuid,
	"request_hash" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"cost_estimated" boolean DEFAULT true NOT NULL,
	"latency_ms" integer,
	"status" "ai_call_status" NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error_code" text,
	"injection_attempts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"model_key" text NOT NULL,
	"label" text NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_cost_per_mtok" numeric(12, 4),
	"output_cost_per_mtok" numeric(12, 4),
	"context_window" integer,
	"max_output" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "ai_provider_kind" NOT NULL,
	"label" text NOT NULL,
	"base_url" text,
	"secret_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"health" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_role_routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" "ai_role" NOT NULL,
	"primary_model_id" uuid,
	"fallback_model_id" uuid,
	"degraded_model_id" uuid,
	"max_output_tokens" integer DEFAULT 2048 NOT NULL,
	"temperature" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"period" "budget_period" NOT NULL,
	"spent_usd" numeric(14, 6) DEFAULT '0' NOT NULL,
	"reserved_usd" numeric(14, 6) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"amount_usd" numeric(12, 6) NOT NULL,
	"ai_call_id" uuid,
	"settled_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"period" "budget_period" NOT NULL,
	"limit_usd" numeric(12, 2) NOT NULL,
	"warn_pct" double precision DEFAULT 0.7 NOT NULL,
	"degrade_pct" double precision DEFAULT 0.85 NOT NULL,
	"critical_pct" double precision DEFAULT 0.95 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"key" text NOT NULL,
	"version" text NOT NULL,
	"role" "ai_role" NOT NULL,
	"system_text" text NOT NULL,
	"user_template" text NOT NULL,
	"output_schema_key" text,
	"checksum" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_call_payloads" ADD CONSTRAINT "ai_call_payloads_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_calls" ADD CONSTRAINT "ai_calls_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_secret_id_secrets_id_fk" FOREIGN KEY ("secret_id") REFERENCES "public"."secrets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_role_routes" ADD CONSTRAINT "ai_role_routes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_role_routes" ADD CONSTRAINT "ai_role_routes_primary_model_id_ai_models_id_fk" FOREIGN KEY ("primary_model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_role_routes" ADD CONSTRAINT "ai_role_routes_fallback_model_id_ai_models_id_fk" FOREIGN KEY ("fallback_model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_role_routes" ADD CONSTRAINT "ai_role_routes_degraded_model_id_ai_models_id_fk" FOREIGN KEY ("degraded_model_id") REFERENCES "public"."ai_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_ledger" ADD CONSTRAINT "budget_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_reservations" ADD CONSTRAINT "budget_reservations_ai_call_id_ai_calls_id_fk" FOREIGN KEY ("ai_call_id") REFERENCES "public"."ai_calls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_calls_workspace_created_idx" ON "ai_calls" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_calls_subject_idx" ON "ai_calls" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "ai_calls_role_idx" ON "ai_calls" USING btree ("workspace_id","role");--> statement-breakpoint
CREATE INDEX "ai_calls_hash_idx" ON "ai_calls" USING btree ("request_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_models_provider_key" ON "ai_models" USING btree ("provider_id","model_key");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_providers_workspace_label" ON "ai_providers" USING btree ("workspace_id","label");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_role_routes_workspace_role" ON "ai_role_routes" USING btree ("workspace_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_ledger_workspace_period_key" ON "budget_ledger" USING btree ("workspace_id","period_key");--> statement-breakpoint
CREATE INDEX "budget_reservations_open_idx" ON "budget_reservations" USING btree ("settled_at","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_workspace_period" ON "budgets" USING btree ("workspace_id","period");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_templates_key_version" ON "prompt_templates" USING btree ("key","version");