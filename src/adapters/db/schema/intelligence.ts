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
  customType,
} from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './_shared';
import { workspaces, users } from './tenancy';

/**
 * Embeddings are stored as packed float32 rather than a vector column so that
 * one schema and one migration set serve every deployment. PGlite ships no
 * pgvector, and the similarity work happens over a deterministically blocked
 * candidate set that is small enough for exact cosine in TypeScript.
 * Approximate-nearest-neighbour indexing is a later, additive change.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

export const evidenceClassEnum = pgEnum('evidence_class', [
  'direct_customer',
  'transaction',
  'primary',
  'reliable_secondary',
  'community',
  'social',
  'ai_derived',
]);

export const signalStatusEnum = pgEnum('signal_status', [
  'new',
  'processed',
  'duplicate',
  'discarded',
]);

export const dedupeReasonEnum = pgEnum('dedupe_reason', [
  'canonical_url',
  'content_hash',
  'source_external_id',
  'near_duplicate',
  'semantic',
  'syndication',
  'distinct',
]);

/**
 * The signal taxonomy lives in the database as well as in code: the code holds
 * the maths, the table holds workspace-level overrides and lets an owner add a
 * type without a deployment.
 */
export const signalTypes = pgTable(
  'signal_types',
  {
    key: text('key').primaryKey(),
    label: text('label').notNull(),
    description: text('description').notNull(),
    baseStrength: doublePrecision('base_strength').notNull(),
    defaultHalfLifeDays: integer('default_half_life_days').notNull(),
    decayMode: text('decay_mode').notNull().default('time'),
    builtin: boolean('builtin').notNull().default(true),
    workspaceId: uuid('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (table) => [index('signal_types_workspace_idx').on(table.workspaceId)],
);

export const entities = pgTable(
  'entities',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    canonicalName: text('canonical_name').notNull(),
    /** Lowercased canonical name, used for matching and for entity overlap. */
    matchKey: text('match_key').notNull(),
    aliases: jsonb('aliases').$type<string[]>().notNull().default([]),
    externalIds: jsonb('external_ids').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('entities_workspace_match_key').on(table.workspaceId, table.kind, table.matchKey),
    index('entities_workspace_idx').on(table.workspaceId),
  ],
);

export const signals = pgTable(
  'signals',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Null for manually entered evidence; set for anything ingested. */
    sourceId: uuid('source_id'),
    externalId: text('external_id'),

    title: text('title').notNull(),
    url: text('url'),
    canonicalUrl: text('canonical_url'),
    bodyText: text('body_text').notNull(),
    authorHandle: text('author_handle'),
    /** Stable identity for one person across platforms, for independence. */
    authorIdentityKey: text('author_identity_key'),

    signalTypeKey: text('signal_type_key')
      .notNull()
      .references(() => signalTypes.key),
    evidenceClass: evidenceClassEnum('evidence_class').notNull(),

    geography: text('geography'),
    segment: text('segment'),
    painPoint: text('pain_point'),
    /** Prices, budgets and amounts extracted from the content. */
    monetaryEvidence: jsonb('monetary_evidence').notNull().default({}),

    publishedAt: ts('published_at'),
    observedAt: ts('observed_at').notNull(),

    contentHash: text('content_hash').notNull(),
    /** Stored as text: 64-bit unsigned exceeds what bigint holds comfortably. */
    simhash: text('simhash').notNull(),
    originKey: text('origin_key'),
    citesUrl: text('cites_url'),

    embedding: bytea('embedding'),
    embeddingModel: text('embedding_model'),

    /** Set once the dedupe cascade has placed it. */
    evidenceUnitId: uuid('evidence_unit_id'),
    status: signalStatusEnum('status').notNull().default('new'),

    halfLifeDaysOverride: integer('half_life_days_override'),
    supersededAt: ts('superseded_at'),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Unmistakably marks demonstration data. Never true for real evidence. */
    demo: boolean('demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('signals_workspace_observed_idx').on(table.workspaceId, table.observedAt),
    index('signals_workspace_type_idx').on(table.workspaceId, table.signalTypeKey),
    index('signals_workspace_status_idx').on(table.workspaceId, table.status),
    index('signals_evidence_unit_idx').on(table.evidenceUnitId),
    index('signals_content_hash_idx').on(table.workspaceId, table.contentHash),
    index('signals_canonical_url_idx').on(table.workspaceId, table.canonicalUrl),
    // One row per item per source: refetching an item updates it rather than
    // creating a second apparent observation. Manual signals have no source id
    // and are excluded from the constraint.
    uniqueIndex('signals_source_external_key')
      .on(table.workspaceId, table.sourceId, table.externalId)
      .where(sql`source_id is not null and external_id is not null`),
  ],
);

/** Entity links are relational because entity overlap drives dedupe and clustering. */
export const signalEntities = pgTable(
  'signal_entities',
  {
    signalId: uuid('signal_id')
      .notNull()
      .references(() => signals.id, { onDelete: 'cascade' }),
    entityId: uuid('entity_id')
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('mentions'),
    salience: doublePrecision('salience').notNull().default(0.5),
  },
  (table) => [
    primaryKey({ columns: [table.signalId, table.entityId] }),
    index('signal_entities_entity_idx').on(table.entityId),
  ],
);

/**
 * Every decision the pipeline made about a signal. This is both the processing
 * history behind "why does Radar think this?" and the observability feed for
 * the machine view -- one table serving both, so they cannot disagree.
 */
export const signalProcessingEvents = pgTable(
  'signal_processing_events',
  {
    id: pk(),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => signals.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    decision: text('decision').notNull(),
    reasonCode: text('reason_code'),
    detail: jsonb('detail').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [index('signal_processing_signal_idx').on(table.signalId, table.createdAt)],
);

/**
 * A distinct claim about the world, which may have many mentions behind it.
 * Confidence reads these, never raw signal counts.
 */
export const evidenceUnits = pgTable(
  'evidence_units',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    canonicalClaim: text('canonical_claim').notNull(),
    evidenceClass: evidenceClassEnum('evidence_class').notNull(),
    signalTypeKey: text('signal_type_key')
      .notNull()
      .references(() => signalTypes.key),
    representativeSignalId: uuid('representative_signal_id'),

    mentionCount: integer('mention_count').notNull().default(1),
    independentSourceCount: integer('independent_source_count').notNull().default(1),

    baseStrength: doublePrecision('base_strength').notNull(),
    /** After decay. Refreshed by a job on threshold crossings only. */
    effectiveStrength: doublePrecision('effective_strength').notNull(),
    strengthComputedAt: ts('strength_computed_at'),

    firstSeenAt: ts('first_seen_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
    demo: boolean('demo').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('evidence_units_workspace_idx').on(table.workspaceId, table.lastSeenAt),
    index('evidence_units_strength_idx').on(table.workspaceId, table.effectiveStrength),
  ],
);

export const evidenceUnitSignals = pgTable(
  'evidence_unit_signals',
  {
    evidenceUnitId: uuid('evidence_unit_id')
      .notNull()
      .references(() => evidenceUnits.id, { onDelete: 'cascade' }),
    signalId: uuid('signal_id')
      .notNull()
      .references(() => signals.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('primary'),
    dedupeReason: dedupeReasonEnum('dedupe_reason').notNull(),
    detail: jsonb('detail').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.evidenceUnitId, table.signalId] }),
    index('evidence_unit_signals_signal_idx').on(table.signalId),
  ],
);

/**
 * Outlets under common ownership, declared by the owner. Without this, a media
 * group's six brands look like six independent confirmations.
 */
export const sourceAffiliations = pgTable(
  'source_affiliations',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    originKey: text('origin_key').notNull(),
    groupKey: text('group_key').notNull(),
    kind: text('kind').notNull().default('same_owner'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('source_affiliations_key').on(table.workspaceId, table.originKey)],
);

