CREATE TYPE "public"."dedupe_reason" AS ENUM('canonical_url', 'content_hash', 'source_external_id', 'near_duplicate', 'semantic', 'syndication', 'distinct');--> statement-breakpoint
CREATE TYPE "public"."evidence_class" AS ENUM('direct_customer', 'transaction', 'primary', 'reliable_secondary', 'community', 'social', 'ai_derived');--> statement-breakpoint
CREATE TYPE "public"."signal_status" AS ENUM('new', 'processed', 'duplicate', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."cluster_status" AS ENUM('new', 'watching', 'investigating', 'promoted', 'dormant', 'merged');--> statement-breakpoint
CREATE TYPE "public"."evidence_stance" AS ENUM('for', 'against');--> statement-breakpoint
CREATE TYPE "public"."opportunity_state" AS ENUM('detected', 'watching', 'investigating', 'candidate', 'validation_ready', 'validating', 'validated', 'execution', 'rejected', 'archived', 'reopened');--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"canonical_name" text NOT NULL,
	"match_key" text NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_ids" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_unit_signals" (
	"evidence_unit_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"dedupe_reason" "dedupe_reason" NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_unit_signals_evidence_unit_id_signal_id_pk" PRIMARY KEY("evidence_unit_id","signal_id")
);
--> statement-breakpoint
CREATE TABLE "evidence_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"canonical_claim" text NOT NULL,
	"evidence_class" "evidence_class" NOT NULL,
	"signal_type_key" text NOT NULL,
	"representative_signal_id" uuid,
	"mention_count" integer DEFAULT 1 NOT NULL,
	"independent_source_count" integer DEFAULT 1 NOT NULL,
	"base_strength" double precision NOT NULL,
	"effective_strength" double precision NOT NULL,
	"strength_computed_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_entities" (
	"signal_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"role" text DEFAULT 'mentions' NOT NULL,
	"salience" double precision DEFAULT 0.5 NOT NULL,
	CONSTRAINT "signal_entities_signal_id_entity_id_pk" PRIMARY KEY("signal_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "signal_processing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"decision" text NOT NULL,
	"reason_code" text,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_types" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"base_strength" double precision NOT NULL,
	"default_half_life_days" integer NOT NULL,
	"decay_mode" text DEFAULT 'time' NOT NULL,
	"builtin" boolean DEFAULT true NOT NULL,
	"workspace_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid,
	"external_id" text,
	"title" text NOT NULL,
	"url" text,
	"canonical_url" text,
	"body_text" text NOT NULL,
	"author_handle" text,
	"author_identity_key" text,
	"signal_type_key" text NOT NULL,
	"evidence_class" "evidence_class" NOT NULL,
	"geography" text,
	"segment" text,
	"pain_point" text,
	"monetary_evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"content_hash" text NOT NULL,
	"simhash" text NOT NULL,
	"origin_key" text,
	"cites_url" text,
	"embedding" "bytea",
	"embedding_model" text,
	"evidence_unit_id" uuid,
	"status" "signal_status" DEFAULT 'new' NOT NULL,
	"half_life_days_override" integer,
	"superseded_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_affiliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"origin_key" text NOT NULL,
	"group_key" text NOT NULL,
	"kind" text DEFAULT 'same_owner' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cluster_members" (
	"cluster_id" uuid NOT NULL,
	"evidence_unit_id" uuid NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"added_by" text DEFAULT 'manual' NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	CONSTRAINT "cluster_members_cluster_id_evidence_unit_id_pk" PRIMARY KEY("cluster_id","evidence_unit_id")
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text NOT NULL,
	"problem_statement" text NOT NULL,
	"target_customer" text,
	"status" "cluster_status" DEFAULT 'new' NOT NULL,
	"centroid_embedding" text,
	"raw_mentions" integer DEFAULT 0 NOT NULL,
	"unique_evidence_count" integer DEFAULT 0 NOT NULL,
	"independent_source_count" integer DEFAULT 0 NOT NULL,
	"source_diversity" double precision DEFAULT 0 NOT NULL,
	"momentum_30d" double precision,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"geography" text,
	"category" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_evidence_at" timestamp with time zone NOT NULL,
	"merged_into_id" uuid,
	"created_by_user_id" uuid,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"decision" text NOT NULL,
	"rationale" text NOT NULL,
	"radar_recommendation" text,
	"radar_confidence" double precision,
	"actor_user_id" uuid,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"cluster_id" uuid,
	"reference" integer NOT NULL,
	"title" text NOT NULL,
	"thesis" text NOT NULL,
	"type_key" text NOT NULL,
	"state" "opportunity_state" DEFAULT 'detected' NOT NULL,
	"state_since" timestamp with time zone DEFAULT now() NOT NULL,
	"target_customer" text,
	"problem_statement" text,
	"why_now" text,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"owner_user_id" uuid,
	"created_by" text DEFAULT 'manual' NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_evidence" (
	"opportunity_id" uuid NOT NULL,
	"evidence_unit_id" uuid NOT NULL,
	"stance" "evidence_stance" DEFAULT 'for' NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"note" text,
	"added_by" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_evidence_opportunity_id_evidence_unit_id_stance_pk" PRIMARY KEY("opportunity_id","evidence_unit_id","stance")
);
--> statement-breakpoint
CREATE TABLE "opportunity_state_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_state" "opportunity_state",
	"to_state" "opportunity_state" NOT NULL,
	"reason" text NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_user_id" uuid,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_deltas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_score_id" uuid,
	"to_score_id" uuid NOT NULL,
	"composite" text NOT NULL,
	"from_value" integer,
	"to_value" integer,
	"delta" integer NOT NULL,
	"top_drivers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cause" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_weight_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"preset_key" text,
	"active" boolean DEFAULT false NOT NULL,
	"weights" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"profile_id" uuid,
	"engine_version" text NOT NULL,
	"inputs_digest" text NOT NULL,
	"inputs_snapshot" jsonb NOT NULL,
	"attractiveness" integer,
	"fit" integer,
	"leverage" integer,
	"timing" integer,
	"validation_efficiency" integer,
	"strategic_value" integer,
	"execution_risk" integer,
	"confidence" double precision NOT NULL,
	"dimensions" jsonb NOT NULL,
	"gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence_factors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_unit_signals" ADD CONSTRAINT "evidence_unit_signals_evidence_unit_id_evidence_units_id_fk" FOREIGN KEY ("evidence_unit_id") REFERENCES "public"."evidence_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_unit_signals" ADD CONSTRAINT "evidence_unit_signals_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_units" ADD CONSTRAINT "evidence_units_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_units" ADD CONSTRAINT "evidence_units_signal_type_key_signal_types_key_fk" FOREIGN KEY ("signal_type_key") REFERENCES "public"."signal_types"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_entities" ADD CONSTRAINT "signal_entities_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_entities" ADD CONSTRAINT "signal_entities_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_processing_events" ADD CONSTRAINT "signal_processing_events_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_types" ADD CONSTRAINT "signal_types_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_signal_type_key_signal_types_key_fk" FOREIGN KEY ("signal_type_key") REFERENCES "public"."signal_types"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_affiliations" ADD CONSTRAINT "source_affiliations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_evidence_unit_id_evidence_units_id_fk" FOREIGN KEY ("evidence_unit_id") REFERENCES "public"."evidence_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_log" ADD CONSTRAINT "decision_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_evidence" ADD CONSTRAINT "opportunity_evidence_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_evidence" ADD CONSTRAINT "opportunity_evidence_evidence_unit_id_evidence_units_id_fk" FOREIGN KEY ("evidence_unit_id") REFERENCES "public"."evidence_units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_state_transitions" ADD CONSTRAINT "opportunity_state_transitions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_state_transitions" ADD CONSTRAINT "opportunity_state_transitions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_deltas" ADD CONSTRAINT "score_deltas_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_deltas" ADD CONSTRAINT "score_deltas_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_deltas" ADD CONSTRAINT "score_deltas_from_score_id_scores_id_fk" FOREIGN KEY ("from_score_id") REFERENCES "public"."scores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_deltas" ADD CONSTRAINT "score_deltas_to_score_id_scores_id_fk" FOREIGN KEY ("to_score_id") REFERENCES "public"."scores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_weight_profiles" ADD CONSTRAINT "score_weight_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scores" ADD CONSTRAINT "scores_profile_id_score_weight_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."score_weight_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entities_workspace_match_key" ON "entities" USING btree ("workspace_id","kind","match_key");--> statement-breakpoint
CREATE INDEX "entities_workspace_idx" ON "entities" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "evidence_unit_signals_signal_idx" ON "evidence_unit_signals" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "evidence_units_workspace_idx" ON "evidence_units" USING btree ("workspace_id","last_seen_at");--> statement-breakpoint
CREATE INDEX "evidence_units_strength_idx" ON "evidence_units" USING btree ("workspace_id","effective_strength");--> statement-breakpoint
CREATE INDEX "signal_entities_entity_idx" ON "signal_entities" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "signal_processing_signal_idx" ON "signal_processing_events" USING btree ("signal_id","created_at");--> statement-breakpoint
CREATE INDEX "signal_types_workspace_idx" ON "signal_types" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "signals_workspace_observed_idx" ON "signals" USING btree ("workspace_id","observed_at");--> statement-breakpoint
CREATE INDEX "signals_workspace_type_idx" ON "signals" USING btree ("workspace_id","signal_type_key");--> statement-breakpoint
CREATE INDEX "signals_workspace_status_idx" ON "signals" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "signals_evidence_unit_idx" ON "signals" USING btree ("evidence_unit_id");--> statement-breakpoint
CREATE INDEX "signals_content_hash_idx" ON "signals" USING btree ("workspace_id","content_hash");--> statement-breakpoint
CREATE INDEX "signals_canonical_url_idx" ON "signals" USING btree ("workspace_id","canonical_url");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_source_external_key" ON "signals" USING btree ("workspace_id","source_id","external_id") WHERE source_id is not null and external_id is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "source_affiliations_key" ON "source_affiliations" USING btree ("workspace_id","origin_key");--> statement-breakpoint
CREATE INDEX "cluster_members_evidence_idx" ON "cluster_members" USING btree ("evidence_unit_id");--> statement-breakpoint
CREATE INDEX "clusters_workspace_status_idx" ON "clusters" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "clusters_workspace_evidence_idx" ON "clusters" USING btree ("workspace_id","last_evidence_at");--> statement-breakpoint
CREATE INDEX "decision_log_workspace_idx" ON "decision_log" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "decision_log_subject_idx" ON "decision_log" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_workspace_reference" ON "opportunities" USING btree ("workspace_id","reference");--> statement-breakpoint
CREATE INDEX "opportunities_workspace_state_idx" ON "opportunities" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "opportunities_cluster_idx" ON "opportunities" USING btree ("cluster_id");--> statement-breakpoint
CREATE INDEX "opportunity_evidence_unit_idx" ON "opportunity_evidence" USING btree ("evidence_unit_id");--> statement-breakpoint
CREATE INDEX "opportunity_transitions_idx" ON "opportunity_state_transitions" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE INDEX "score_deltas_opportunity_idx" ON "score_deltas" USING btree ("opportunity_id","created_at");--> statement-breakpoint
CREATE INDEX "score_deltas_workspace_idx" ON "score_deltas" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "score_profiles_workspace_idx" ON "score_weight_profiles" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "score_profiles_active_key" ON "score_weight_profiles" USING btree ("workspace_id") WHERE active;--> statement-breakpoint
CREATE INDEX "scores_opportunity_idx" ON "scores" USING btree ("opportunity_id","computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scores_current_key" ON "scores" USING btree ("opportunity_id") WHERE is_current;