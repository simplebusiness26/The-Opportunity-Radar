import { sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  pgTable,
} from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './_shared';
import { workspaces, users } from './tenancy';
import { evidenceUnits } from './intelligence';

export const clusterStatusEnum = pgEnum('cluster_status', [
  'new',
  'watching',
  'investigating',
  'promoted',
  'dormant',
  'merged',
]);

export const opportunityStateEnum = pgEnum('opportunity_state', [
  'detected',
  'watching',
  'investigating',
  'candidate',
  'validation_ready',
  'validating',
  'validated',
  'execution',
  'rejected',
  'archived',
  'reopened',
]);

export const evidenceStanceEnum = pgEnum('evidence_stance', ['for', 'against']);

/**
 * A cluster is the underlying problem several signals are about. Signals are
 * never treated as opportunities directly: one person's complaint is not a
 * market, and the cluster is where "several unrelated people hit this" becomes
 * visible.
 */
export const clusters = pgTable(
  'clusters',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    problemStatement: text('problem_statement').notNull(),
    targetCustomer: text('target_customer'),
    status: clusterStatusEnum('status').notNull().default('new'),

    centroidEmbedding: text('centroid_embedding'),

    /** Materialised from members; recomputed on membership change. */
    rawMentions: integer('raw_mentions').notNull().default(0),
    uniqueEvidenceCount: integer('unique_evidence_count').notNull().default(0),
    independentSourceCount: integer('independent_source_count').notNull().default(0),
    sourceDiversity: doublePrecision('source_diversity').notNull().default(0),
    momentum30d: doublePrecision('momentum_30d'),
    confidence: doublePrecision('confidence').notNull().default(0),

    geography: text('geography'),
    category: text('category'),

    firstSeenAt: ts('first_seen_at').notNull(),
    lastEvidenceAt: ts('last_evidence_at').notNull(),
    mergedIntoId: uuid('merged_into_id'),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    demo: boolean('demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('clusters_workspace_status_idx').on(table.workspaceId, table.status),
    index('clusters_workspace_evidence_idx').on(table.workspaceId, table.lastEvidenceAt),
  ],
);

export const clusterMembers = pgTable(
  'cluster_members',
  {
    clusterId: uuid('cluster_id')
      .notNull()
      .references(() => clusters.id, { onDelete: 'cascade' }),
    evidenceUnitId: uuid('evidence_unit_id')
      .notNull()
      .references(() => evidenceUnits.id, { onDelete: 'cascade' }),
    weight: doublePrecision('weight').notNull().default(1),
    addedBy: text('added_by').notNull().default('manual'),
    addedAt: ts('added_at').notNull().defaultNow(),
    removedAt: ts('removed_at'),
  },
  (table) => [
    primaryKey({ columns: [table.clusterId, table.evidenceUnitId] }),
    index('cluster_members_evidence_idx').on(table.evidenceUnitId),
  ],
);

export const opportunities = pgTable(
  'opportunities',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    clusterId: uuid('cluster_id').references(() => clusters.id, { onDelete: 'set null' }),

    reference: integer('reference').notNull(),
    title: text('title').notNull(),
    thesis: text('thesis').notNull(),
    typeKey: text('type_key').notNull(),
    state: opportunityStateEnum('state').notNull().default('detected'),
    stateSince: ts('state_since').notNull().defaultNow(),

    targetCustomer: text('target_customer'),
    problemStatement: text('problem_statement'),
    whyNow: text('why_now'),

    /** Narrative fields an owner writes; not inputs to any score. */
    notes: jsonb('notes').notNull().default({}),

    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: text('created_by').notNull().default('manual'),
    demo: boolean('demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('opportunities_workspace_reference').on(table.workspaceId, table.reference),
    index('opportunities_workspace_state_idx').on(table.workspaceId, table.state),
    index('opportunities_cluster_idx').on(table.clusterId),
  ],
);

/** Every state change, with its reason. The lifecycle is auditable end to end. */
export const opportunityStateTransitions = pgTable(
  'opportunity_state_transitions',
  {
    id: pk(),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    fromState: opportunityStateEnum('from_state'),
    toState: opportunityStateEnum('to_state').notNull(),
    reason: text('reason').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** What triggered it: a signal id, a score crossing, an experiment result. */
    evidence: jsonb('evidence').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [index('opportunity_transitions_idx').on(table.opportunityId, table.createdAt)],
);

/**
 * Evidence attached to an opportunity, with its stance. Red-teaming writes
 * `against` rows here, and scoring reads both sides, which is how a hostile
 * finding actually moves the numbers instead of sitting in a note.
 */
export const opportunityEvidence = pgTable(
  'opportunity_evidence',
  {
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    evidenceUnitId: uuid('evidence_unit_id')
      .notNull()
      .references(() => evidenceUnits.id, { onDelete: 'cascade' }),
    stance: evidenceStanceEnum('stance').notNull().default('for'),
    weight: doublePrecision('weight').notNull().default(1),
    note: text('note'),
    addedBy: text('added_by').notNull().default('manual'),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.opportunityId, table.evidenceUnitId, table.stance] }),
    index('opportunity_evidence_unit_idx').on(table.evidenceUnitId),
  ],
);

export const scoreWeightProfiles = pgTable(
  'score_weight_profiles',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    /** Strategy preset this came from, when it was not hand-built. */
    presetKey: text('preset_key'),
    active: boolean('active').notNull().default(false),
    weights: jsonb('weights').$type<Record<string, number>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('score_profiles_workspace_idx').on(table.workspaceId),
    uniqueIndex('score_profiles_active_key')
      .on(table.workspaceId)
      .where(sql`active`),
  ],
);

export const scores = pgTable(
  'scores',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id').references(() => scoreWeightProfiles.id, { onDelete: 'set null' }),

    engineVersion: text('engine_version').notNull(),
    /** Digest of the frozen inputs: identical inputs give an identical score. */
    inputsDigest: text('inputs_digest').notNull(),
    inputsSnapshot: jsonb('inputs_snapshot').notNull(),

    attractiveness: integer('attractiveness'),
    fit: integer('fit'),
    leverage: integer('leverage'),
    timing: integer('timing'),
    validationEfficiency: integer('validation_efficiency'),
    strategicValue: integer('strategic_value'),
    executionRisk: integer('execution_risk'),
    /** Kept as a separate column, never folded into the others. */
    confidence: doublePrecision('confidence').notNull(),

    dimensions: jsonb('dimensions').notNull(),
    gaps: jsonb('gaps').notNull().default([]),
    confidenceFactors: jsonb('confidence_factors').notNull().default([]),

    isCurrent: boolean('is_current').notNull().default(true),
    computedAt: ts('computed_at').notNull().defaultNow(),
  },
  (table) => [
    index('scores_opportunity_idx').on(table.opportunityId, table.computedAt),
    uniqueIndex('scores_current_key')
      .on(table.opportunityId)
      .where(sql`is_current`),
  ],
);

export const scoreDeltas = pgTable(
  'score_deltas',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    fromScoreId: uuid('from_score_id').references(() => scores.id, { onDelete: 'set null' }),
    toScoreId: uuid('to_score_id')
      .notNull()
      .references(() => scores.id, { onDelete: 'cascade' }),
    composite: text('composite').notNull(),
    fromValue: integer('from_value'),
    toValue: integer('to_value'),
    delta: integer('delta').notNull(),
    /** The dimensions that actually moved, so the brief needs no model. */
    topDrivers: jsonb('top_drivers').notNull().default([]),
    cause: text('cause').notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('score_deltas_opportunity_idx').on(table.opportunityId, table.createdAt),
    index('score_deltas_workspace_idx').on(table.workspaceId, table.createdAt),
  ],
);

/** Human decisions, kept so recommendations can be compared to outcomes later. */
export const decisionLog = pgTable(
  'decision_log',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    decision: text('decision').notNull(),
    rationale: text('rationale').notNull(),
    /** What Radar suggested, recorded at the time the person decided. */
    radarRecommendation: text('radar_recommendation'),
    radarConfidence: doublePrecision('radar_confidence'),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    context: jsonb('context').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    index('decision_log_workspace_idx').on(table.workspaceId, table.createdAt),
    index('decision_log_subject_idx').on(table.subjectType, table.subjectId),
  ],
);
