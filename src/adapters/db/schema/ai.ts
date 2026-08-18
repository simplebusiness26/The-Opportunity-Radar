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
import { workspaces } from './tenancy';
import { secrets } from './audit';

export const aiProviderKindEnum = pgEnum('ai_provider_kind', [
  'openai',
  'anthropic',
  'gemini',
  'openai_compatible',
  'fixture',
]);

/**
 * A configured provider. Credentials live in `secrets`, encrypted; nothing here
 * holds a key, so this table can be read freely by the interface.
 */
export const aiProviders = pgTable(
  'ai_providers',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: aiProviderKindEnum('kind').notNull(),
    label: text('label').notNull(),
    baseUrl: text('base_url'),
    secretId: uuid('secret_id').references(() => secrets.id, { onDelete: 'set null' }),
    enabled: boolean('enabled').notNull().default(false),
    /** Last health check result, so the machine view can explain a failure. */
    health: jsonb('health').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('ai_providers_workspace_label').on(table.workspaceId, table.label)],
);

/**
 * A model, with the prices the owner supplied.
 *
 * Prices are configured, never hardcoded. A cost figure nobody verified is a
 * fabricated metric, and this product's whole claim rests on not doing that.
 */
export const aiModels = pgTable(
  'ai_models',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => aiProviders.id, { onDelete: 'cascade' }),
    modelKey: text('model_key').notNull(),
    label: text('label').notNull(),
    capabilities: jsonb('capabilities').notNull().default({}),
    inputCostPerMtok: numeric('input_cost_per_mtok', { precision: 12, scale: 4 }),
    outputCostPerMtok: numeric('output_cost_per_mtok', { precision: 12, scale: 4 }),
    contextWindow: integer('context_window'),
    maxOutput: integer('max_output'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('ai_models_provider_key').on(table.providerId, table.modelKey)],
);

export const aiRoleEnum = pgEnum('ai_role', [
  'cheap_extraction',
  'classification',
  'research',
  'reasoning',
  'high_value_decision',
  'embedding',
]);

/**
 * Which model serves which kind of work.
 *
 * Separating roles is what makes the cost ladder possible: cheap work goes to a
 * cheap model, and the expensive one is reserved for the rare decision that
 * justifies it.
 */
export const aiRoleRoutes = pgTable(
  'ai_role_routes',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    role: aiRoleEnum('role').notNull(),
    primaryModelId: uuid('primary_model_id').references(() => aiModels.id, { onDelete: 'set null' }),
    fallbackModelId: uuid('fallback_model_id').references(() => aiModels.id, { onDelete: 'set null' }),
    /** Used when the budget governor has stepped down. */
    degradedModelId: uuid('degraded_model_id').references(() => aiModels.id, { onDelete: 'set null' }),
    maxOutputTokens: integer('max_output_tokens').notNull().default(2048),
    temperature: doublePrecision('temperature').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('ai_role_routes_workspace_role').on(table.workspaceId, table.role)],
);

export const aiCallStatusEnum = pgEnum('ai_call_status', [
  'ok',
  'repaired',
  'invalid_output',
  'error',
  'refused',
  'blocked_by_budget',
]);

/**
 * The ledger. Every call, what it cost, and what it was for.
 *
 * Attribution by subject is what turns this into cost per source, per
 * opportunity and per job, rather than one undifferentiated monthly number.
 */
export const aiCalls = pgTable(
  'ai_calls',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    role: aiRoleEnum('role').notNull(),
    providerId: uuid('provider_id').references(() => aiProviders.id, { onDelete: 'set null' }),
    modelId: uuid('model_id').references(() => aiModels.id, { onDelete: 'set null' }),
    modelKey: text('model_key').notNull(),

    promptKey: text('prompt_key'),
    promptVersion: text('prompt_version'),
    schemaKey: text('schema_key'),
    schemaVersion: text('schema_version'),

    jobId: uuid('job_id'),
    runId: uuid('run_id'),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),

    /** Digest of the assembled prompt, for fixture lookup and cache detection. */
    requestHash: text('request_hash').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    /** True when the cost is derived from configured prices rather than billed. */
    costEstimated: boolean('cost_estimated').notNull().default(true),
    latencyMs: integer('latency_ms'),
    status: aiCallStatusEnum('status').notNull(),
    attempt: integer('attempt').notNull().default(1),
    errorCode: text('error_code'),
    /** Instructions found inside untrusted content, if any. */
    injectionAttempts: jsonb('injection_attempts').notNull().default([]),
    createdAt: createdAt(),
  },
  (table) => [
    index('ai_calls_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('ai_calls_subject_idx').on(table.subjectType, table.subjectId),
    index('ai_calls_role_idx').on(table.workspaceId, table.role),
    index('ai_calls_hash_idx').on(table.requestHash),
  ],
);

/**
 * Prompts and responses, split off so they can be purged on their own schedule.
 * Untrusted source content passes through here, so retention is deliberately
 * short and separable from the ledger it belongs to.
 */
export const aiCallPayloads = pgTable('ai_call_payloads', {
  aiCallId: uuid('ai_call_id')
    .primaryKey()
    .references(() => aiCalls.id, { onDelete: 'cascade' }),
  request: jsonb('request'),
  response: jsonb('response'),
  redacted: boolean('redacted').notNull().default(false),
  createdAt: createdAt(),
});

export const budgetPeriodEnum = pgEnum('budget_period', ['daily', 'monthly']);

export const budgets = pgTable(
  'budgets',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    period: budgetPeriodEnum('period').notNull(),
    limitUsd: numeric('limit_usd', { precision: 12, scale: 2 }).notNull(),
    warnPct: doublePrecision('warn_pct').notNull().default(0.7),
    degradePct: doublePrecision('degrade_pct').notNull().default(0.85),
    criticalPct: doublePrecision('critical_pct').notNull().default(0.95),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('budgets_workspace_period').on(table.workspaceId, table.period)],
);

/**
 * Spend against a period.
 *
 * `reserved` is what makes enforcement race-free: a call reserves its maximum
 * possible cost before it runs and settles to the actual afterwards, so two
 * concurrent callers cannot both squeeze under the same remaining balance.
 */
export const budgetLedger = pgTable(
  'budget_ledger',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** `2026-08` or `2026-08-18`. */
    periodKey: text('period_key').notNull(),
    period: budgetPeriodEnum('period').notNull(),
    spentUsd: numeric('spent_usd', { precision: 14, scale: 6 }).notNull().default('0'),
    reservedUsd: numeric('reserved_usd', { precision: 14, scale: 6 }).notNull().default('0'),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex('budget_ledger_workspace_period_key').on(table.workspaceId, table.periodKey)],
);

/**
 * An outstanding reservation. Held so a crash between calling and settling
 * cannot lose the money: the sweeper releases it after expiry, and until then
 * it counts as spent. Failing closed is the only safe direction here.
 */
export const budgetReservations = pgTable(
  'budget_reservations',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    periodKeys: jsonb('period_keys').notNull().default([]),
    amountUsd: numeric('amount_usd', { precision: 12, scale: 6 }).notNull(),
    aiCallId: uuid('ai_call_id').references(() => aiCalls.id, { onDelete: 'set null' }),
    settledAt: ts('settled_at'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('budget_reservations_open_idx').on(table.settledAt, table.expiresAt)],
);

/**
 * Versioned prompts. Recording which version produced an analysis is what makes
 * a past conclusion reproducible, and what makes a prompt change fail loudly in
 * the evaluation suite rather than passing on a stale recording.
 */
export const promptTemplates = pgTable(
  'prompt_templates',
  {
    id: pk(),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    version: text('version').notNull(),
    role: aiRoleEnum('role').notNull(),
    systemText: text('system_text').notNull(),
    userTemplate: text('user_template').notNull(),
    outputSchemaKey: text('output_schema_key'),
    checksum: text('checksum').notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('prompt_templates_key_version').on(table.key, table.version)],
);
