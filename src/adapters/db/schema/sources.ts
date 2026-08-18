import {
  boolean,
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
import { workspaces } from './tenancy';
import { secrets } from './audit';

export const sourceCategoryEnum = pgEnum('source_category', [
  'community',
  'customer_evidence',
  'labour',
  'technology',
  'market',
  'trend',
  'regulatory',
]);

export const sourceStatusEnum = pgEnum('source_status', [
  'ok',
  'degraded',
  'failing',
  'not_configured',
  'disabled',
]);

/**
 * A configured source.
 *
 * Non-secret settings live in `config`; anything secret is in `secrets` and
 * referenced by id, so this row can be read by the interface without exposing a
 * credential.
 */
export const sources = pgTable(
  'sources',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    adapterKey: text('adapter_key').notNull(),
    name: text('name').notNull(),
    category: sourceCategoryEnum('category').notNull(),
    config: jsonb('config').notNull().default({}),
    secretId: uuid('secret_id').references(() => secrets.id, { onDelete: 'set null' }),
    enabled: boolean('enabled').notNull().default(true),
    /** How far to trust what this source produces, before per-item assessment. */
    reliabilityTier: integer('reliability_tier').notNull().default(3),
    pollIntervalSec: integer('poll_interval_sec').notNull().default(3600),
    /** Cap per run, reduced when the budget governor asks for shallower scans. */
    maxItemsPerRun: integer('max_items_per_run').notNull().default(50),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('sources_workspace_name').on(table.workspaceId, table.name),
    index('sources_workspace_enabled_idx').on(table.workspaceId, table.enabled),
  ],
);

/**
 * Where a source got to, so a run resumes rather than re-reading everything.
 * Kept apart from the source row because it changes on every run.
 */
export const sourceState = pgTable('source_state', {
  sourceId: uuid('source_id')
    .primaryKey()
    .references(() => sources.id, { onDelete: 'cascade' }),
  cursor: text('cursor'),
  status: sourceStatusEnum('status').notNull().default('not_configured'),
  lastRunAt: ts('last_run_at'),
  lastSuccessAt: ts('last_success_at'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  /** Set while a failing source is being backed off. */
  backoffUntil: ts('backoff_until'),
  lastMessage: text('last_message'),
  /** What the owner should do, when there is a concrete answer. */
  lastRemedy: text('last_remedy'),
  itemsLastRun: integer('items_last_run').notNull().default(0),
  updatedAt: updatedAt(),
});

export const sourceHealthEvents = pgTable(
  'source_health_events',
  {
    id: pk(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    status: sourceStatusEnum('status').notNull(),
    message: text('message').notNull(),
    itemsFetched: integer('items_fetched').notNull().default(0),
    durationMs: integer('duration_ms'),
    createdAt: createdAt(),
  },
  (table) => [index('source_health_events_source_idx').on(table.sourceId, table.createdAt)],
);

/**
 * Every fetch Radar made: the provenance root.
 *
 * A claim can be traced from an opportunity, through the evidence and the
 * signal, to the exact request that produced it and the address it resolved to.
 */
export const fetchRecords = pgTable(
  'fetch_records',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    runId: uuid('run_id'),
    url: text('url').notNull(),
    finalUrl: text('final_url'),
    httpStatus: integer('http_status'),
    contentHash: text('content_hash'),
    bytes: integer('bytes').notNull().default(0),
    /** Each redirect hop and the address it resolved to. */
    hops: jsonb('hops').notNull().default([]),
    robotsDecision: text('robots_decision'),
    blockedReason: text('blocked_reason'),
    fetchedAt: ts('fetched_at').notNull().defaultNow(),
  },
  (table) => [
    index('fetch_records_workspace_idx').on(table.workspaceId, table.fetchedAt),
    index('fetch_records_url_idx').on(table.url),
  ],
);
