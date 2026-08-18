import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  text,
  uniqueIndex,
  uuid,
  pgTable,
} from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './_shared';
import { users, workspaces } from './tenancy';
import { opportunities } from './opportunities';

/**
 * The internal intelligence graph: what this particular team already has.
 *
 * This is the half of the product the outside world cannot replicate. Anyone
 * can watch the market; nobody else knows which of these opportunities the
 * owner could ship in a fortnight because most of it already exists in their
 * repositories.
 *
 * Modelled as nodes and edges with typed satellite tables, rather than as a
 * generic key-value store. Anything a score depends on gets a column, so it can
 * be joined, filtered and asserted on; the loose remainder lives in `attrs`.
 */

export const igNodeKindEnum = pgEnum('ig_node_kind', [
  'person',
  'skill',
  'project',
  'repo',
  'capability',
  'asset',
  'infrastructure',
  'knowledge',
  'resource',
  'constraint',
  'goal',
  'audience',
]);

export const igEdgeKindEnum = pgEnum('ig_edge_kind', [
  'has_skill',
  'owns',
  'uses',
  'depends_on',
  'provides_capability',
  'reusable_for',
  'constrains',
  'supports_goal',
  'derived_from',
  'reaches',
]);

export const igSourceEnum = pgEnum('ig_source', ['manual', 'github', 'document', 'derived']);

export const igNodes = pgTable(
  'ig_nodes',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: igNodeKindEnum('kind').notNull(),
    name: text('name').notNull(),
    /** Normalised name, so the same thing entered twice is recognised as one. */
    matchKey: text('match_key').notNull(),
    summary: text('summary'),
    source: igSourceEnum('source').notNull().default('manual'),
    /** How sure we are this is real and current, 0-1. */
    confidence: doublePrecision('confidence').notNull().default(1),
    attrs: jsonb('attrs').notNull().default({}),
    /** When the underlying thing last changed, for capability decay. */
    verifiedAt: ts('verified_at'),
    demo: boolean('demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('ig_nodes_workspace_kind_key').on(table.workspaceId, table.kind, table.matchKey),
    index('ig_nodes_workspace_kind_idx').on(table.workspaceId, table.kind),
  ],
);

export const igEdges = pgTable(
  'ig_edges',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    fromNodeId: uuid('from_node_id')
      .notNull()
      .references(() => igNodes.id, { onDelete: 'cascade' }),
    toNodeId: uuid('to_node_id')
      .notNull()
      .references(() => igNodes.id, { onDelete: 'cascade' }),
    kind: igEdgeKindEnum('kind').notNull(),
    weight: doublePrecision('weight').notNull().default(1),
    evidence: jsonb('evidence').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('ig_edges_unique').on(table.fromNodeId, table.toNodeId, table.kind),
    index('ig_edges_from_idx').on(table.fromNodeId, table.kind),
    index('ig_edges_to_idx').on(table.toNodeId, table.kind),
  ],
);

export const maturityEnum = pgEnum('capability_maturity', [
  'experimental',
  'working',
  'production',
  'battle_tested',
]);

/**
 * A capability the team has. Resolved against the shared taxonomy so that
 * "what this opportunity needs" and "what we have" are comparable as keys
 * rather than as strings an LLM has to guess are the same thing.
 */
export const capabilities = pgTable(
  'capabilities',
  {
    nodeId: uuid('node_id')
      .primaryKey()
      .references(() => igNodes.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    taxonomyKey: text('taxonomy_key').notNull(),
    maturity: maturityEnum('maturity').notNull().default('working'),
    /** How strongly the claim to have this is supported, 0-1. */
    evidenceStrength: doublePrecision('evidence_strength').notNull().default(0.6),
    lastVerifiedAt: ts('last_verified_at'),
    notes: text('notes'),
  },
  (table) => [index('capabilities_workspace_key_idx').on(table.workspaceId, table.taxonomyKey)],
);

export const reuseReadinessEnum = pgEnum('reuse_readiness', [
  'concept',
  'needs_work',
  'lift_and_shift',
  'drop_in',
]);

export const assets = pgTable(
  'assets',
  {
    nodeId: uuid('node_id')
      .primaryKey()
      .references(() => igNodes.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    assetKind: text('asset_kind').notNull(),
    reuseReadiness: reuseReadinessEnum('reuse_readiness').notNull().default('needs_work'),
    licence: text('licence'),
    /** Rough size, used only to temper reuse estimates. */
    sizeEstimate: text('size_estimate'),
    lastChangeAt: ts('last_change_at'),
    location: text('location'),
  },
  (table) => [index('assets_workspace_kind_idx').on(table.workspaceId, table.assetKind)],
);

export const resourceKindEnum = pgEnum('resource_kind', ['budget', 'time', 'compute', 'team']);

export const resources = pgTable(
  'resources',
  {
    nodeId: uuid('node_id')
      .primaryKey()
      .references(() => igNodes.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    resourceKind: resourceKindEnum('resource_kind').notNull(),
    amount: doublePrecision('amount').notNull(),
    unit: text('unit').notNull(),
    /** `week`, `month`, `once`. */
    period: text('period').notNull().default('month'),
    committed: doublePrecision('committed').notNull().default(0),
  },
  (table) => [index('resources_workspace_kind_idx').on(table.workspaceId, table.resourceKind)],
);

export const goals = pgTable(
  'goals',
  {
    nodeId: uuid('node_id')
      .primaryKey()
      .references(() => igNodes.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    horizon: text('horizon').notNull().default('quarter'),
    priority: integer('priority').notNull().default(1),
    metric: text('metric'),
    target: text('target'),
    /** Weight overrides this goal implies, applied by the strategy engine. */
    weightHints: jsonb('weight_hints').notNull().default({}),
  },
  (table) => [index('goals_workspace_priority_idx').on(table.workspaceId, table.priority)],
);

export const constraints = pgTable(
  'constraints',
  {
    nodeId: uuid('node_id')
      .primaryKey()
      .references(() => igNodes.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    constraintKind: text('constraint_kind').notNull(),
    /** A hard constraint disqualifies; a soft one only penalises. */
    hard: boolean('hard').notNull().default(false),
    expression: jsonb('expression').notNull().default({}),
    description: text('description').notNull(),
  },
  (table) => [index('constraints_workspace_idx').on(table.workspaceId, table.hard)],
);

/**
 * A connected repository. Analysis is deliberately shallow and cached: manifests
 * and structure, never a wholesale upload of the source, which would be both
 * expensive and a needless exposure of private code.
 */
export const repos = pgTable(
  'repos',
  {
    nodeId: uuid('node_id')
      .primaryKey()
      .references(() => igNodes.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('github'),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    defaultBranch: text('default_branch'),
    visibility: text('visibility'),
    /** Digest of the manifests, so unchanged repositories are not re-analysed. */
    manifestDigest: text('manifest_digest'),
    lastAnalysedAt: ts('last_analysed_at'),
    lastChangeAt: ts('last_change_at'),
  },
  (table) => [uniqueIndex('repos_workspace_full_name').on(table.workspaceId, table.owner, table.name)],
);

export const repoAnalyses = pgTable(
  'repo_analyses',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoNodeId: uuid('repo_node_id')
      .notNull()
      .references(() => repos.nodeId, { onDelete: 'cascade' }),
    structure: jsonb('structure').notNull().default({}),
    manifests: jsonb('manifests').notNull().default({}),
    detectedCapabilities: jsonb('detected_capabilities').notNull().default([]),
    /** Null when detection was purely deterministic, which it is by default. */
    aiCallId: uuid('ai_call_id'),
    tokensUsed: integer('tokens_used').notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [index('repo_analyses_repo_idx').on(table.repoNodeId, table.createdAt)],
);

/**
 * What actually happened when something was pursued.
 *
 * This is the execution memory: the dataset that makes the system's estimates
 * get better, and that no competitor can copy because it is a record of this
 * team's own work.
 */
export const executionHistory = pgTable(
  'execution_history',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    opportunityId: uuid('opportunity_id').references(() => opportunities.id, {
      onDelete: 'set null',
    }),
    projectNodeId: uuid('project_node_id').references(() => igNodes.id, { onDelete: 'set null' }),

    predictedBuildDays: doublePrecision('predicted_build_days'),
    actualBuildDays: doublePrecision('actual_build_days'),
    predictedCost: doublePrecision('predicted_cost'),
    actualCost: doublePrecision('actual_cost'),
    predictedConfidence: doublePrecision('predicted_confidence'),
    predictedScore: doublePrecision('predicted_score'),
    actualRevenue: doublePrecision('actual_revenue'),
    retention: jsonb('retention'),

    outcome: text('outcome').notNull(),
    reason: text('reason'),
    notes: text('notes'),
    source: text('source').notNull().default('manual'),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    recordedAt: ts('recorded_at').notNull().defaultNow(),
  },
  (table) => [
    index('execution_history_workspace_idx').on(table.workspaceId, table.recordedAt),
    index('execution_history_opportunity_idx').on(table.opportunityId),
  ],
);
