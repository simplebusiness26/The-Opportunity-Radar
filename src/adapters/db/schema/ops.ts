import { sql } from 'drizzle-orm';
import {
  bigserial,
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

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'running',
  'complete',
  'failed',
  'retrying',
  'cancelled',
  /** Held because a precondition is absent (no provider, budget spent). Not a
   *  failure: it resumes when the precondition returns. */
  'blocked',
]);

/**
 * The work queue.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so several workers can drain the same
 * queue without a lock server. Timeouts are enforced by a lease and a reaper
 * rather than an in-process timer, so a worker that dies mid-job releases its
 * work instead of holding it until someone notices.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull().default({}),

    /**
     * Identity of the work, not of the row. Enqueueing the same key while an
     * equivalent job is pending is a no-op, which is what makes the scheduler
     * exactly-once per bucket and makes event fan-out safe to debounce.
     */
    dedupeKey: text('dedupe_key'),

    status: jobStatusEnum('status').notNull().default('queued'),
    priority: integer('priority').notNull().default(0),

    runAt: ts('run_at').notNull().defaultNow(),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),

    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    timeoutSec: integer('timeout_sec').notNull().default(300),
    leaseExpiresAt: ts('lease_expires_at'),
    workerId: text('worker_id'),

    lastError: text('last_error'),
    /** Partial progress, written in the same transaction as the work it covers. */
    checkpoint: jsonb('checkpoint'),

    parentJobId: uuid('parent_job_id'),
    /** Groups every job produced by one scan or one tick. */
    runId: uuid('run_id'),
    /** Guards against an event loop enqueuing itself forever. */
    causationDepth: integer('causation_depth').notNull().default(0),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('jobs_claim_idx').on(table.status, table.runAt, table.priority),
    index('jobs_workspace_kind_idx').on(table.workspaceId, table.kind, table.status),
    index('jobs_lease_idx').on(table.leaseExpiresAt),
    index('jobs_run_idx').on(table.runId),
    // Only pending work is deduplicated: once a job finishes, the same key may
    // legitimately be enqueued again.
    uniqueIndex('jobs_dedupe_pending_key')
      .on(table.workspaceId, table.dedupeKey)
      .where(sql`status in ('queued', 'running', 'retrying', 'blocked') and dedupe_key is not null`),
  ],
);

export const jobEvents = pgTable(
  'job_events',
  {
    id: pk(),
    jobId: uuid('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    level: text('level').notNull().default('info'),
    code: text('code').notNull(),
    message: text('message'),
    detail: jsonb('detail').notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [index('job_events_job_idx').on(table.jobId, table.createdAt)],
);

/**
 * Recurring work. The scheduler enqueues with a dedupe key derived from the due
 * bucket, so a double tick, a clock skew or a second worker cannot produce two
 * runs of the same schedule.
 */
export const schedules = pgTable(
  'schedules',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    cron: text('cron').notNull(),
    timezone: text('timezone').notNull().default('UTC'),
    jobKind: text('job_kind').notNull(),
    payload: jsonb('payload').notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    lastFiredAt: ts('last_fired_at'),
    nextDueAt: ts('next_due_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('schedules_workspace_key').on(table.workspaceId, table.key),
    index('schedules_due_idx').on(table.enabled, table.nextDueAt),
  ],
);

/**
 * Transactional outbox. Handlers append events in the same transaction as their
 * writes, so an event can never describe a change that was rolled back, and a
 * change can never fail to produce its event.
 */
export const domainEvents = pgTable(
  'domain_events',
  {
    sequence: bigserial('sequence', { mode: 'number' }).primaryKey(),
    id: uuid('id')
      .notNull()
      .default(sql`gen_random_uuid()`),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id'),
    payload: jsonb('payload').notNull().default({}),
    causationDepth: integer('causation_depth').notNull().default(0),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    processedAt: ts('processed_at'),
  },
  (table) => [
    index('domain_events_unprocessed_idx').on(table.processedAt, table.sequence),
    index('domain_events_subject_idx').on(table.subjectType, table.subjectId),
  ],
);

export const alertSeverityEnum = pgEnum('alert_severity', ['info', 'notable', 'urgent']);

/**
 * Alerts exist to be rare. Each carries a dedupe key so the same condition
 * cannot notify twice, and a suppression window so a metric hovering around a
 * threshold does not generate a stream of near-identical messages.
 */
export const alerts = pgTable(
  'alerts',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    severity: alertSeverityEnum('severity').notNull().default('info'),
    subjectType: text('subject_type'),
    subjectId: uuid('subject_id'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** What the owner should do, when there is a concrete answer. */
    action: text('action'),
    dedupeKey: text('dedupe_key').notNull(),
    suppressedUntil: ts('suppressed_until'),
    acknowledgedAt: ts('acknowledged_at'),
    acknowledgedByUserId: uuid('acknowledged_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    demo: boolean('demo').notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    index('alerts_workspace_created_idx').on(table.workspaceId, table.createdAt),
    index('alerts_unack_idx').on(table.workspaceId, table.acknowledgedAt),
    index('alerts_dedupe_idx').on(table.workspaceId, table.dedupeKey),
  ],
);

/**
 * The daily brief. Stored rather than rendered on demand so "what changed since
 * you last looked" has a fixed reference point, and so a brief can be reread
 * exactly as it was issued.
 */
export const dailyBriefs = pgTable(
  'daily_briefs',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    briefDate: text('brief_date').notNull(),
    /** Counts: scanned, retained, new clusters, strengthened, weakened. */
    metrics: jsonb('metrics').notNull().default({}),
    bestMove: jsonb('best_move'),
    sections: jsonb('sections').notNull().default({}),
    generatedAt: ts('generated_at').notNull().defaultNow(),
  },
  (table) => [uniqueIndex('daily_briefs_workspace_date_key').on(table.workspaceId, table.briefDate)],
);

/** When each person last looked, so "since your last visit" is per-person. */
export const userVisits = pgTable(
  'user_visits',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    previousSeenAt: ts('previous_seen_at'),
  },
  (table) => [uniqueIndex('user_visits_key').on(table.userId, table.workspaceId)],
);

/** Rolling counters for the machine view: throughput without a metrics server. */
export const runStats = pgTable(
  'run_stats',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    runId: uuid('run_id'),
    kind: text('kind').notNull(),
    itemsSeen: integer('items_seen').notNull().default(0),
    itemsRetained: integer('items_retained').notNull().default(0),
    duplicatesDropped: integer('duplicates_dropped').notNull().default(0),
    durationMs: doublePrecision('duration_ms'),
    createdAt: createdAt(),
  },
  (table) => [index('run_stats_workspace_kind_idx').on(table.workspaceId, table.kind, table.createdAt)],
);
