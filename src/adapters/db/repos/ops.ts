import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import {
  alerts,
  dailyBriefs,
  domainEvents,
  jobEvents,
  jobs,
  runStats,
  schedules,
  userVisits,
} from '../schema/index';
import type { JobStatus } from '../../../domain/jobs/backoff';
import type {
  AlertRepository,
  AlertRow,
  BriefRepository,
  BriefRow,
  DomainEventRepository,
  DomainEventRow,
  JobRepository,
  JobRow,
  RunStatsRepository,
  ScheduleRepository,
  ScheduleRow,
  VisitRepository,
} from '../../../ports/repositories/ops';

function toJob(row: typeof jobs.$inferSelect): JobRow {
  return {
    ...row,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    checkpoint: (row.checkpoint ?? null) as Record<string, unknown> | null,
  } as JobRow;
}

export function createJobRepository(db: Executor): JobRepository {
  return {
    async enqueue(workspaceId, input) {
      const [row] = await db
        .insert(jobs)
        .values({
          workspaceId,
          kind: input.kind,
          payload: input.payload ?? {},
          dedupeKey: input.dedupeKey ?? null,
          priority: input.priority ?? 0,
          runAt: input.runAt ?? new Date(0),
          maxAttempts: input.maxAttempts ?? 5,
          timeoutSec: input.timeoutSec ?? 300,
          parentJobId: input.parentJobId ?? null,
          runId: input.runId ?? null,
          causationDepth: input.causationDepth ?? 0,
        })
        // The partial unique index covers pending work only, so an equivalent
        // job already waiting silently absorbs this one.
        .onConflictDoNothing()
        .returning();

      return row ? toJob(row) : null;
    },

    async claim(workerId, now, options = {}) {
      const kindFilter = options.kinds?.length
        ? sql`and kind = any(${sql.raw(`array[${options.kinds.map((k) => `'${k.replace(/'/g, "''")}'`).join(',')}]`)})`
        : sql``;

      /*
       * One statement claims the job and takes the lease. SKIP LOCKED means a
       * second worker running this at the same instant selects a different row
       * rather than blocking, so the queue scales by adding workers and needs no
       * external coordination.
       */
      const result = await db.execute<typeof jobs.$inferSelect>(sql`
        update ${jobs} set
          status = 'running',
          worker_id = ${workerId},
          started_at = ${now}::timestamptz,
          attempts = attempts + 1,
          -- The cast is required: an untyped parameter here is inferred as an
          -- interval, and the addition then fails to match the column type.
          lease_expires_at = ${now}::timestamptz + make_interval(secs => timeout_sec),
          updated_at = ${now}::timestamptz
        where id = (
          select id from ${jobs}
          where status in ('queued', 'retrying')
            and run_at <= ${now}::timestamptz
            ${kindFilter}
          order by priority desc, run_at asc
          for update skip locked
          limit 1
        )
        returning *
      `);

      const row = result.rows[0];
      return row ? toJob(row) : null;
    },

    async heartbeat(jobId, now, timeoutSec) {
      await db.execute(sql`
        update ${jobs}
        set lease_expires_at = ${now}::timestamptz + make_interval(secs => ${timeoutSec}::int),
            updated_at = ${now}::timestamptz
        where id = ${jobId} and status = 'running'
      `);
    },

    async complete(jobId, now, detail) {
      await db
        .update(jobs)
        .set({
          status: 'complete',
          finishedAt: now,
          leaseExpiresAt: null,
          workerId: null,
          lastError: null,
          updatedAt: now,
        })
        .where(eq(jobs.id, jobId));

      if (detail) {
        await db.insert(jobEvents).values({ jobId, level: 'info', code: 'completed', detail });
      }
    },

    async fail(jobId, now, input) {
      await db
        .update(jobs)
        .set({
          status: input.status,
          lastError: input.error.slice(0, 4000),
          runAt: input.retryAt ?? undefined,
          leaseExpiresAt: null,
          workerId: null,
          finishedAt: input.status === 'failed' ? now : null,
          updatedAt: now,
        })
        .where(eq(jobs.id, jobId));

      await db.insert(jobEvents).values({
        jobId,
        level: input.status === 'failed' ? 'error' : 'warn',
        code: input.status,
        message: input.error.slice(0, 1000),
      });
    },

    async cancel(workspaceId, jobId, now) {
      const rows = await db
        .update(jobs)
        .set({ status: 'cancelled', finishedAt: now, leaseExpiresAt: null, updatedAt: now })
        .where(
          and(
            eq(jobs.workspaceId, workspaceId),
            eq(jobs.id, jobId),
            inArray(jobs.status, ['queued', 'retrying', 'running', 'blocked']),
          ),
        )
        .returning({ id: jobs.id });
      return rows.length > 0;
    },

    async saveCheckpoint(jobId, checkpoint) {
      await db.update(jobs).set({ checkpoint }).where(eq(jobs.id, jobId));
    },

    async reapExpired(now, retryDelaySeconds) {
      // A worker that died holds its lease until it expires. Reclaiming here is
      // what makes timeouts survive process death rather than depending on a
      // timer inside the process that vanished.
      const expired = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.status, 'running'), sql`${jobs.leaseExpiresAt} < ${now}`))
        .limit(200);

      for (const job of expired) {
        const exhausted = job.attempts >= job.maxAttempts;
        await db
          .update(jobs)
          .set({
            status: exhausted ? 'failed' : 'retrying',
            lastError: `Lease expired after ${job.timeoutSec}s (attempt ${job.attempts}).`,
            runAt: exhausted ? job.runAt : new Date(now.getTime() + retryDelaySeconds(job.attempts) * 1000),
            leaseExpiresAt: null,
            workerId: null,
            finishedAt: exhausted ? now : null,
            updatedAt: now,
          })
          .where(eq(jobs.id, job.id));

        await db.insert(jobEvents).values({
          jobId: job.id,
          level: 'warn',
          code: 'lease_expired',
          message: `Reclaimed after the worker stopped reporting.`,
        });
      }

      return expired.length;
    },

    async findById(workspaceId, jobId) {
      const rows = await db
        .select()
        .from(jobs)
        .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.id, jobId)))
        .limit(1);
      return rows[0] ? toJob(rows[0]) : null;
    },

    async list(workspaceId, options = {}) {
      const conditions = [eq(jobs.workspaceId, workspaceId)];
      if (options.status?.length) conditions.push(inArray(jobs.status, options.status));
      if (options.kind) conditions.push(eq(jobs.kind, options.kind));

      const rows = await db
        .select()
        .from(jobs)
        .where(and(...conditions))
        .orderBy(desc(jobs.createdAt))
        .limit(Math.min(options.limit ?? 50, 200));
      return rows.map(toJob);
    },

    async counts(workspaceId) {
      const rows = await db
        .select({ status: jobs.status, count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(eq(jobs.workspaceId, workspaceId))
        .groupBy(jobs.status);

      const base: Record<JobStatus, number> = {
        queued: 0,
        running: 0,
        complete: 0,
        failed: 0,
        retrying: 0,
        cancelled: 0,
        blocked: 0,
      };
      for (const row of rows) base[row.status as JobStatus] = row.count;
      return base;
    },

    async recordEvent(jobId, event) {
      await db.insert(jobEvents).values({
        jobId,
        level: event.level ?? 'info',
        code: event.code,
        message: event.message ?? null,
        detail: event.detail ?? {},
      });
    },

    async listEvents(jobId, limit = 50) {
      return db
        .select({
          level: jobEvents.level,
          code: jobEvents.code,
          message: jobEvents.message,
          detail: jobEvents.detail,
          createdAt: jobEvents.createdAt,
        })
        .from(jobEvents)
        .where(eq(jobEvents.jobId, jobId))
        .orderBy(desc(jobEvents.createdAt))
        .limit(limit) as never;
    },

    async countRunnable(now) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(and(inArray(jobs.status, ['queued', 'retrying']), sql`${jobs.runAt} <= ${now}`));
      return rows[0]?.count ?? 0;
    },

    async unblock(workspaceId, kinds, now) {
      const rows = await db
        .update(jobs)
        .set({ status: 'queued', runAt: now, lastError: null, updatedAt: now })
        .where(
          and(
            eq(jobs.workspaceId, workspaceId),
            eq(jobs.status, 'blocked'),
            kinds.length ? inArray(jobs.kind, kinds) : sql`true`,
          ),
        )
        .returning({ id: jobs.id });
      return rows.length;
    },
  };
}

export function createScheduleRepository(db: Executor): ScheduleRepository {
  const toRow = (row: typeof schedules.$inferSelect): ScheduleRow =>
    ({ ...row, payload: (row.payload ?? {}) as Record<string, unknown> }) as ScheduleRow;

  return {
    async upsert(workspaceId, input) {
      const [row] = await db
        .insert(schedules)
        .values({
          workspaceId,
          key: input.key,
          cron: input.cron,
          jobKind: input.jobKind,
          payload: input.payload ?? {},
          enabled: input.enabled ?? true,
          timezone: input.timezone ?? 'UTC',
        })
        .onConflictDoUpdate({
          target: [schedules.workspaceId, schedules.key],
          set: {
            cron: input.cron,
            jobKind: input.jobKind,
            payload: input.payload ?? {},
            enabled: input.enabled ?? true,
          },
        })
        .returning();
      if (!row) throw new Error('upsert schedule returned no row');
      return toRow(row);
    },

    async listDue(now, limit = 100) {
      const rows = await db
        .select()
        .from(schedules)
        .where(
          and(
            eq(schedules.enabled, true),
            sql`(${schedules.nextDueAt} is null or ${schedules.nextDueAt} <= ${now})`,
          ),
        )
        .orderBy(asc(schedules.nextDueAt))
        .limit(limit);
      return rows.map(toRow);
    },

    async listAll(workspaceId) {
      const rows = await db
        .select()
        .from(schedules)
        .where(eq(schedules.workspaceId, workspaceId))
        .orderBy(asc(schedules.key));
      return rows.map(toRow);
    },

    async markFired(scheduleId, firedAt, nextDueAt) {
      await db
        .update(schedules)
        .set({ lastFiredAt: firedAt, nextDueAt, updatedAt: firedAt })
        .where(eq(schedules.id, scheduleId));
    },

    async setEnabled(workspaceId, key, enabled) {
      await db
        .update(schedules)
        .set({ enabled })
        .where(and(eq(schedules.workspaceId, workspaceId), eq(schedules.key, key)));
    },

    async countEnabled(workspaceId) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(schedules)
        .where(and(eq(schedules.workspaceId, workspaceId), eq(schedules.enabled, true)));
      return rows[0]?.count ?? 0;
    },
  };
}

export function createDomainEventRepository(db: Executor): DomainEventRepository {
  return {
    async append(workspaceId, input) {
      await db.insert(domainEvents).values({
        workspaceId,
        kind: input.kind,
        subjectType: input.subjectType,
        subjectId: input.subjectId ?? null,
        payload: input.payload ?? {},
        causationDepth: input.causationDepth ?? 0,
      });
    },

    async listUnprocessed(limit = 200) {
      const rows = await db
        .select()
        .from(domainEvents)
        .where(isNull(domainEvents.processedAt))
        .orderBy(asc(domainEvents.sequence))
        .limit(limit);
      return rows.map(
        (row): DomainEventRow => ({
          ...row,
          payload: (row.payload ?? {}) as Record<string, unknown>,
        }),
      );
    },

    async markProcessed(sequences, now) {
      if (sequences.length === 0) return;
      await db
        .update(domainEvents)
        .set({ processedAt: now })
        .where(inArray(domainEvents.sequence, sequences));
    },

    async countUnprocessed(workspaceId) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(domainEvents)
        .where(and(eq(domainEvents.workspaceId, workspaceId), isNull(domainEvents.processedAt)));
      return rows[0]?.count ?? 0;
    },
  };
}

export function createAlertRepository(db: Executor): AlertRepository {
  const toRow = (row: typeof alerts.$inferSelect): AlertRow => row as AlertRow;

  return {
    async raise(workspaceId, input, now) {
      // Suppression is checked rather than enforced by a constraint, because the
      // same condition legitimately re-alerts once its window has passed.
      const existing = await db
        .select({ id: alerts.id, suppressedUntil: alerts.suppressedUntil })
        .from(alerts)
        .where(and(eq(alerts.workspaceId, workspaceId), eq(alerts.dedupeKey, input.dedupeKey)))
        .orderBy(desc(alerts.createdAt))
        .limit(1);

      const previous = existing[0];
      if (previous?.suppressedUntil && previous.suppressedUntil > now) return null;

      const suppressForSeconds = input.suppressForSeconds ?? 12 * 60 * 60;
      const [row] = await db
        .insert(alerts)
        .values({
          workspaceId,
          kind: input.kind,
          severity: input.severity ?? 'info',
          subjectType: input.subjectType ?? null,
          subjectId: input.subjectId ?? null,
          title: input.title,
          body: input.body,
          action: input.action ?? null,
          dedupeKey: input.dedupeKey,
          suppressedUntil: new Date(now.getTime() + suppressForSeconds * 1000),
          demo: input.demo ?? false,
        })
        .returning();

      return row ? toRow(row) : null;
    },

    async list(workspaceId, options = {}) {
      const conditions = [eq(alerts.workspaceId, workspaceId)];
      if (options.acknowledged === true) conditions.push(sql`${alerts.acknowledgedAt} is not null`);
      if (options.acknowledged === false) conditions.push(isNull(alerts.acknowledgedAt));

      const rows = await db
        .select()
        .from(alerts)
        .where(and(...conditions))
        .orderBy(desc(alerts.createdAt))
        .limit(Math.min(options.limit ?? 50, 200));
      return rows.map(toRow);
    },

    async acknowledge(workspaceId, alertId, userId, now) {
      await db
        .update(alerts)
        .set({ acknowledgedAt: now, acknowledgedByUserId: userId })
        .where(and(eq(alerts.workspaceId, workspaceId), eq(alerts.id, alertId)));
    },

    async countUnacknowledged(workspaceId) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(alerts)
        .where(and(eq(alerts.workspaceId, workspaceId), isNull(alerts.acknowledgedAt)));
      return rows[0]?.count ?? 0;
    },
  };
}

export function createBriefRepository(db: Executor): BriefRepository {
  const toRow = (row: typeof dailyBriefs.$inferSelect): BriefRow =>
    ({
      ...row,
      metrics: (row.metrics ?? {}) as Record<string, unknown>,
      bestMove: (row.bestMove ?? null) as Record<string, unknown> | null,
      sections: (row.sections ?? {}) as Record<string, unknown>,
    }) as BriefRow;

  return {
    async save(workspaceId, input, now) {
      const [row] = await db
        .insert(dailyBriefs)
        .values({
          workspaceId,
          briefDate: input.briefDate,
          metrics: input.metrics,
          bestMove: input.bestMove,
          sections: input.sections,
          generatedAt: now,
        })
        .onConflictDoUpdate({
          target: [dailyBriefs.workspaceId, dailyBriefs.briefDate],
          set: {
            metrics: input.metrics,
            bestMove: input.bestMove,
            sections: input.sections,
            generatedAt: now,
          },
        })
        .returning();
      if (!row) throw new Error('save brief returned no row');
      return toRow(row);
    },

    async find(workspaceId, briefDate) {
      const rows = await db
        .select()
        .from(dailyBriefs)
        .where(and(eq(dailyBriefs.workspaceId, workspaceId), eq(dailyBriefs.briefDate, briefDate)))
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async latest(workspaceId) {
      const rows = await db
        .select()
        .from(dailyBriefs)
        .where(eq(dailyBriefs.workspaceId, workspaceId))
        .orderBy(desc(dailyBriefs.briefDate))
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },
  };
}

export function createVisitRepository(db: Executor): VisitRepository {
  return {
    async touch(workspaceId, userId, now) {
      const existing = await db
        .select({ lastSeenAt: userVisits.lastSeenAt })
        .from(userVisits)
        .where(and(eq(userVisits.workspaceId, workspaceId), eq(userVisits.userId, userId)))
        .limit(1);

      const previousSeenAt = existing[0]?.lastSeenAt ?? null;

      await db
        .insert(userVisits)
        .values({ workspaceId, userId, lastSeenAt: now, previousSeenAt })
        .onConflictDoUpdate({
          target: [userVisits.userId, userVisits.workspaceId],
          set: { lastSeenAt: now, previousSeenAt },
        });

      return { previousSeenAt };
    },

    async lastSeen(workspaceId, userId) {
      const rows = await db
        .select({ lastSeenAt: userVisits.lastSeenAt })
        .from(userVisits)
        .where(and(eq(userVisits.workspaceId, workspaceId), eq(userVisits.userId, userId)))
        .limit(1);
      return rows[0]?.lastSeenAt ?? null;
    },
  };
}

export function createRunStatsRepository(db: Executor): RunStatsRepository {
  return {
    async record(workspaceId, input) {
      await db.insert(runStats).values({
        workspaceId,
        runId: input.runId ?? null,
        kind: input.kind,
        itemsSeen: input.itemsSeen ?? 0,
        itemsRetained: input.itemsRetained ?? 0,
        duplicatesDropped: input.duplicatesDropped ?? 0,
        durationMs: input.durationMs ?? null,
      });
    },

    async summary(workspaceId, since) {
      return db
        .select({
          kind: runStats.kind,
          itemsSeen: sql<number>`coalesce(sum(${runStats.itemsSeen}), 0)::int`,
          itemsRetained: sql<number>`coalesce(sum(${runStats.itemsRetained}), 0)::int`,
          duplicatesDropped: sql<number>`coalesce(sum(${runStats.duplicatesDropped}), 0)::int`,
          runs: sql<number>`count(*)::int`,
        })
        .from(runStats)
        .where(and(eq(runStats.workspaceId, workspaceId), sql`${runStats.createdAt} >= ${since}`))
        .groupBy(runStats.kind);
    },
  };
}
