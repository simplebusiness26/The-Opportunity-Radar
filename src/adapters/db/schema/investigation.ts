import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  text,
  uniqueIndex,
  uuid,
  pgTable,
} from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './_shared';
import { users, workspaces } from './tenancy';
import { opportunities } from './opportunities';
import { evidenceUnits } from './intelligence';

export const investigationStateEnum = pgEnum('investigation_state', [
  'queued',
  'running',
  'complete',
  'terminated',
  'failed',
  'blocked',
]);

/**
 * One run of one investigation role against one subject.
 *
 * Every role declares what would make it stop, and that condition is stored
 * with the run rather than left to a model's judgement. An investigation that
 * cannot say why it finished is one that will keep spending money.
 */
export const investigations = pgTable(
  'investigations',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    roleKey: text('role_key').notNull(),
    state: investigationStateEnum('state').notNull().default('queued'),
    /** How much this run may spend before it stops. */
    budgetCapUsd: numeric('budget_cap_usd', { precision: 10, scale: 4 }),
    spentUsd: numeric('spent_usd', { precision: 10, scale: 6 }).notNull().default('0'),
    /** Why it stopped: satisfied, exhausted, capped, or refused. */
    terminationReason: text('termination_reason'),
    jobId: uuid('job_id'),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    createdAt: createdAt(),
  },
  (table) => [
    index('investigations_subject_idx').on(table.subjectType, table.subjectId),
    index('investigations_workspace_state_idx').on(table.workspaceId, table.state),
  ],
);

export const investigationOutputs = pgTable(
  'investigation_outputs',
  {
    id: pk(),
    investigationId: uuid('investigation_id')
      .notNull()
      .references(() => investigations.id, { onDelete: 'cascade' }),
    schemaKey: text('schema_key').notNull(),
    schemaVersion: text('schema_version').notNull(),
    payload: jsonb('payload').notNull(),
    /** Which prompt produced it, so a past conclusion is reproducible. */
    promptKey: text('prompt_key'),
    promptVersion: text('prompt_version'),
    aiCallId: uuid('ai_call_id'),
    /** What the projector had to correct or discard. */
    projectionReport: jsonb('projection_report').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [index('investigation_outputs_investigation_idx').on(table.investigationId)],
);

export const uncertaintyKindEnum = pgEnum('uncertainty_kind', [
  'known_fact',
  'assumption',
  'unknown',
  'critical_unknown',
  'evidence_gap',
]);

export const uncertaintyStatusEnum = pgEnum('uncertainty_status', [
  'open',
  'resolved',
  'unresolvable',
  'superseded',
]);

/**
 * What we know, what we are assuming, and what we do not know.
 *
 * Separating these is what lets Radar answer "what would most efficiently
 * reduce our uncertainty" instead of researching whatever is easiest. An
 * assumption recorded as an assumption stops being mistaken for a finding.
 */
export const uncertaintyItems = pgTable(
  'uncertainty_items',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    kind: uncertaintyKindEnum('kind').notNull(),
    statement: text('statement').notNull(),
    /** How much the answer would change the decision, 0-1. */
    impact: doublePrecision('impact').notNull().default(0.5),
    /** How readily it could be answered, 0-1. */
    resolvability: doublePrecision('resolvability').notNull().default(0.5),
    costToResolve: doublePrecision('cost_to_resolve'),
    daysToResolve: doublePrecision('days_to_resolve'),
    /** Computed: impact against cost. Drives what to do next. */
    voiScore: doublePrecision('voi_score').notNull().default(0),
    status: uncertaintyStatusEnum('status').notNull().default('open'),
    resolution: text('resolution'),
    evidenceUnitIds: jsonb('evidence_unit_ids').notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('uncertainty_opportunity_idx').on(table.opportunityId, table.status),
    index('uncertainty_voi_idx').on(table.workspaceId, table.voiScore),
  ],
);

export const experimentStateEnum = pgEnum('experiment_state', [
  'proposed',
  'approved',
  'running',
  'blocked',
  'completed',
  'abandoned',
]);

export const experimentVerdictEnum = pgEnum('experiment_verdict', [
  'validated',
  'partially_validated',
  'inconclusive',
  'rejected',
]);

/**
 * The cheapest credible test of the riskiest assumption.
 *
 * Thresholds are recorded before the experiment runs, deliberately. Deciding
 * afterwards what would have counted as success is how a disappointing result
 * gets reinterpreted as an encouraging one.
 */
export const validationPlans = pgTable(
  'validation_plans',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    hypothesis: text('hypothesis').notNull(),
    /** The single assumption most likely to be wrong and most costly if it is. */
    riskiestAssumptionId: uuid('riskiest_assumption_id').references(() => uncertaintyItems.id, {
      onDelete: 'set null',
    }),
    whyItMatters: text('why_it_matters').notNull(),
    experimentType: text('experiment_type').notNull(),
    audience: text('audience').notNull(),
    steps: jsonb('steps').notNull().default([]),
    estimatedCost: doublePrecision('estimated_cost').notNull().default(0),
    estimatedDays: doublePrecision('estimated_days').notNull().default(1),
    successThreshold: jsonb('success_threshold').notNull(),
    failureThreshold: jsonb('failure_threshold').notNull(),
    evidenceToCollect: jsonb('evidence_to_collect').notNull().default([]),
    /** What must not be built until this resolves. */
    doNotBuildYet: jsonb('do_not_build_yet').notNull().default([]),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (table) => [index('validation_plans_opportunity_idx').on(table.opportunityId)],
);

export const experiments = pgTable(
  'experiments',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    validationPlanId: uuid('validation_plan_id').references(() => validationPlans.id, {
      onDelete: 'set null',
    }),
    name: text('name').notNull(),
    state: experimentStateEnum('state').notNull().default('proposed'),
    stateSince: ts('state_since').notNull().defaultNow(),
    verdict: experimentVerdictEnum('verdict'),
    budget: doublePrecision('budget').notNull().default(0),
    actualCost: doublePrecision('actual_cost').notNull().default(0),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    conclusion: text('conclusion'),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'set null' }),
    demo: boolean('demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index('experiments_workspace_state_idx').on(table.workspaceId, table.state)],
);

export const experimentTransitions = pgTable('experiment_transitions', {
  id: pk(),
  experimentId: uuid('experiment_id')
    .notNull()
    .references(() => experiments.id, { onDelete: 'cascade' }),
  fromState: text('from_state'),
  toState: text('to_state').notNull(),
  reason: text('reason').notNull(),
  actorKind: text('actor_kind').notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

/**
 * What an experiment actually measured.
 *
 * Recorded against the thresholds set beforehand, so whether it passed is a
 * comparison rather than an interpretation.
 */
export const experimentResults = pgTable(
  'experiment_results',
  {
    id: pk(),
    experimentId: uuid('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    metricKey: text('metric_key').notNull(),
    value: doublePrecision('value').notNull(),
    unit: text('unit'),
    notes: text('notes'),
    /** Evidence the experiment itself produced. */
    evidenceUnitId: uuid('evidence_unit_id').references(() => evidenceUnits.id, {
      onDelete: 'set null',
    }),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    recordedAt: ts('recorded_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('experiment_results_metric').on(table.experimentId, table.metricKey)],
);

/** Contacts made and how they responded, for experiments that involve people. */
export const experimentContacts = pgTable(
  'experiment_contacts',
  {
    id: pk(),
    experimentId: uuid('experiment_id')
      .notNull()
      .references(() => experiments.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    outcome: text('outcome').notNull().default('contacted'),
    notes: text('notes'),
    contactedAt: ts('contacted_at').notNull().defaultNow(),
  },
  (table) => [index('experiment_contacts_experiment_idx').on(table.experimentId)],
);

export const reevaluationTriggers = pgTable(
  'reevaluation_triggers',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    description: text('description').notNull(),
    /** A predicate evaluated deterministically against incoming evidence. */
    predicate: jsonb('predicate').notNull(),
    active: boolean('active').notNull().default(true),
    lastCheckedAt: ts('last_checked_at'),
    firedAt: ts('fired_at'),
    firedSignalId: uuid('fired_signal_id'),
    checkCount: integer('check_count').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [index('reevaluation_triggers_active_idx').on(table.workspaceId, table.active)],
);
