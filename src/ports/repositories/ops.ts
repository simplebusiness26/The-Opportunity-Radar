import type { JobStatus } from '../../domain/jobs/backoff';

export interface JobRow {
  id: string;
  workspaceId: string;
  kind: string;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  status: JobStatus;
  priority: number;
  runAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  attempts: number;
  maxAttempts: number;
  timeoutSec: number;
  leaseExpiresAt: Date | null;
  workerId: string | null;
  lastError: string | null;
  checkpoint: Record<string, unknown> | null;
  parentJobId: string | null;
  runId: string | null;
  causationDepth: number;
  createdAt: Date;
}

export interface EnqueueInput {
  kind: string;
  payload?: Record<string, unknown>;
  dedupeKey?: string | null;
  priority?: number;
  runAt?: Date;
  maxAttempts?: number;
  timeoutSec?: number;
  parentJobId?: string | null;
  runId?: string | null;
  causationDepth?: number;
}

export interface JobRepository {
  /**
   * Adds work. Returns null when an equivalent job is already pending, which is
   * how the scheduler stays exactly-once and event fan-out stays debounced.
   */
  enqueue(workspaceId: string, input: EnqueueInput): Promise<JobRow | null>;
  /**
   * Claims one runnable job with FOR UPDATE SKIP LOCKED and takes a lease on it.
   * Returns null when there is nothing to do.
   */
  claim(workerId: string, now: Date, options?: { kinds?: string[] }): Promise<JobRow | null>;
  /** Extends the lease of a long-running job so the reaper leaves it alone. */
  heartbeat(jobId: string, now: Date, timeoutSec: number): Promise<void>;
  complete(jobId: string, now: Date, detail?: Record<string, unknown>): Promise<void>;
  fail(
    jobId: string,
    now: Date,
    input: { status: Extract<JobStatus, 'failed' | 'retrying' | 'blocked'>; error: string; retryAt?: Date },
  ): Promise<void>;
  cancel(workspaceId: string, jobId: string, now: Date): Promise<boolean>;
  saveCheckpoint(jobId: string, checkpoint: Record<string, unknown>): Promise<void>;
  /** Returns jobs whose lease expired to `retrying`, or `failed` past the limit. */
  reapExpired(now: Date, retryDelaySeconds: (attempt: number) => number): Promise<number>;
  findById(workspaceId: string, jobId: string): Promise<JobRow | null>;
  list(
    workspaceId: string,
    options?: { status?: JobStatus[]; kind?: string; limit?: number },
  ): Promise<JobRow[]>;
  counts(workspaceId: string): Promise<Record<JobStatus, number>>;
  recordEvent(
    jobId: string,
    event: { level?: 'info' | 'warn' | 'error'; code: string; message?: string; detail?: Record<string, unknown> },
  ): Promise<void>;
  listEvents(jobId: string, limit?: number): Promise<Array<{ level: string; code: string; message: string | null; detail: Record<string, unknown>; createdAt: Date }>>;
  /** Releases jobs held on a precondition that has since been satisfied. */
  unblock(workspaceId: string, kinds: string[], now: Date): Promise<number>;
  /**
   * Runnable work across every workspace. Lets a caller loop until the machine
   * is genuinely idle instead of guessing how many passes it needs.
   */
  countRunnable(now: Date): Promise<number>;
}

export interface ScheduleRow {
  id: string;
  workspaceId: string;
  key: string;
  cron: string;
  timezone: string;
  jobKind: string;
  payload: Record<string, unknown>;
  enabled: boolean;
  lastFiredAt: Date | null;
  nextDueAt: Date | null;
}

export interface ScheduleRepository {
  upsert(
    workspaceId: string,
    input: { key: string; cron: string; jobKind: string; payload?: Record<string, unknown>; enabled?: boolean; timezone?: string },
  ): Promise<ScheduleRow>;
  listDue(now: Date, limit?: number): Promise<ScheduleRow[]>;
  listAll(workspaceId: string): Promise<ScheduleRow[]>;
  markFired(scheduleId: string, firedAt: Date, nextDueAt: Date | null): Promise<void>;
  setEnabled(workspaceId: string, key: string, enabled: boolean): Promise<void>;
  /** Enabled schedules, which is one of the preconditions for autonomous mode. */
  countEnabled(workspaceId: string): Promise<number>;
}

export interface DomainEventRow {
  sequence: number;
  id: string;
  workspaceId: string;
  kind: string;
  subjectType: string;
  subjectId: string | null;
  payload: Record<string, unknown>;
  causationDepth: number;
  occurredAt: Date;
}

export interface DomainEventRepository {
  /** Appended in the same transaction as the change it describes. */
  append(
    workspaceId: string,
    input: { kind: string; subjectType: string; subjectId?: string | null; payload?: Record<string, unknown>; causationDepth?: number },
  ): Promise<void>;
  /** Unprocessed events in sequence order. Ordering is the contract. */
  listUnprocessed(limit?: number): Promise<DomainEventRow[]>;
  markProcessed(sequences: number[], now: Date): Promise<void>;
  countUnprocessed(workspaceId: string): Promise<number>;
}

export interface AlertRow {
  id: string;
  workspaceId: string;
  kind: string;
  severity: 'info' | 'notable' | 'urgent';
  subjectType: string | null;
  subjectId: string | null;
  title: string;
  body: string;
  action: string | null;
  dedupeKey: string;
  suppressedUntil: Date | null;
  acknowledgedAt: Date | null;
  demo: boolean;
  createdAt: Date;
}

export interface AlertRepository {
  /** Returns null when an identical alert is still within its suppression window. */
  raise(
    workspaceId: string,
    input: {
      kind: string;
      severity?: 'info' | 'notable' | 'urgent';
      subjectType?: string | null;
      subjectId?: string | null;
      title: string;
      body: string;
      action?: string | null;
      dedupeKey: string;
      suppressForSeconds?: number;
      demo?: boolean;
    },
    now: Date,
  ): Promise<AlertRow | null>;
  list(workspaceId: string, options?: { acknowledged?: boolean; limit?: number }): Promise<AlertRow[]>;
  acknowledge(workspaceId: string, alertId: string, userId: string, now: Date): Promise<void>;
  countUnacknowledged(workspaceId: string): Promise<number>;
}

export interface BriefRow {
  id: string;
  workspaceId: string;
  briefDate: string;
  metrics: Record<string, unknown>;
  bestMove: Record<string, unknown> | null;
  sections: Record<string, unknown>;
  generatedAt: Date;
}

export interface BriefRepository {
  save(
    workspaceId: string,
    input: { briefDate: string; metrics: Record<string, unknown>; bestMove: Record<string, unknown> | null; sections: Record<string, unknown> },
    now: Date,
  ): Promise<BriefRow>;
  find(workspaceId: string, briefDate: string): Promise<BriefRow | null>;
  latest(workspaceId: string): Promise<BriefRow | null>;
}

export interface VisitRepository {
  /** Records this visit and returns when the person previously looked. */
  touch(workspaceId: string, userId: string, now: Date): Promise<{ previousSeenAt: Date | null }>;
  lastSeen(workspaceId: string, userId: string): Promise<Date | null>;
}

export interface RunStatsRepository {
  record(
    workspaceId: string,
    input: { runId?: string | null; kind: string; itemsSeen?: number; itemsRetained?: number; duplicatesDropped?: number; durationMs?: number },
  ): Promise<void>;
  summary(
    workspaceId: string,
    since: Date,
  ): Promise<Array<{ kind: string; itemsSeen: number; itemsRetained: number; duplicatesDropped: number; runs: number }>>;
}
