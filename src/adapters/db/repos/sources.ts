import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import { fetchRecords, sourceHealthEvents, sourceState, sources } from '../schema/index';
import type {
  SourceRepository,
  SourceRow,
  SourceStateRow,
} from '../../../ports/repositories/sources';

function toSource(row: typeof sources.$inferSelect): SourceRow {
  return { ...row, config: (row.config ?? {}) as Record<string, string> } as SourceRow;
}

export function createSourceRepository(db: Executor): SourceRepository {
  return {
    async create(workspaceId, input) {
      const [row] = await db
        .insert(sources)
        .values({
          workspaceId,
          adapterKey: input.adapterKey,
          name: input.name,
          category: input.category,
          config: input.config ?? {},
          secretId: input.secretId ?? null,
          enabled: input.enabled ?? true,
          pollIntervalSec: input.pollIntervalSec ?? 3600,
          maxItemsPerRun: input.maxItemsPerRun ?? 50,
        })
        .returning();
      if (!row) throw new Error('create source returned no row');

      // A source starts unconfigured rather than healthy: nothing is known
      // about it until it has actually run.
      await db.insert(sourceState).values({ sourceId: row.id, status: 'not_configured' });
      return toSource(row);
    },

    async update(workspaceId, sourceId, patch, now) {
      await db
        .update(sources)
        .set({ ...patch, updatedAt: now })
        .where(and(eq(sources.workspaceId, workspaceId), eq(sources.id, sourceId)));
    },

    async findById(workspaceId, sourceId) {
      const rows = await db
        .select()
        .from(sources)
        .where(and(eq(sources.workspaceId, workspaceId), eq(sources.id, sourceId)))
        .limit(1);
      return rows[0] ? toSource(rows[0]) : null;
    },

    async list(workspaceId, options = {}) {
      const conditions = [eq(sources.workspaceId, workspaceId)];
      if (options.enabledOnly) conditions.push(eq(sources.enabled, true));

      const rows = await db
        .select()
        .from(sources)
        .where(and(...conditions))
        .orderBy(asc(sources.name));
      return rows.map(toSource);
    },

    async remove(workspaceId, sourceId) {
      await db.delete(sources).where(and(eq(sources.workspaceId, workspaceId), eq(sources.id, sourceId)));
    },

    async countEnabled(workspaceId) {
      const conditions = [eq(sources.enabled, true)];
      if (workspaceId) conditions.push(eq(sources.workspaceId, workspaceId));
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(sources)
        .where(and(...conditions));
      return rows[0]?.count ?? 0;
    },

    async listDue(now, limit = 25) {
      const rows = await db
        .select({ source: sources })
        .from(sources)
        .leftJoin(sourceState, eq(sources.id, sourceState.sourceId))
        .where(
          and(
            eq(sources.enabled, true),
            // Never run, or the interval has elapsed.
            or(
              isNull(sourceState.lastRunAt),
              sql`${sourceState.lastRunAt} + make_interval(secs => ${sources.pollIntervalSec}) <= ${now}::timestamptz`,
            ),
            // A failing source is backed off rather than hammered.
            or(isNull(sourceState.backoffUntil), sql`${sourceState.backoffUntil} <= ${now}::timestamptz`),
          ),
        )
        .limit(limit);

      return rows.map((row) => toSource(row.source));
    },

    async state(sourceId) {
      const rows = await db
        .select()
        .from(sourceState)
        .where(eq(sourceState.sourceId, sourceId))
        .limit(1);
      return (rows[0] as SourceStateRow | undefined) ?? null;
    },

    async statesFor(workspaceId) {
      const rows = await db
        .select({ state: sourceState })
        .from(sourceState)
        .innerJoin(sources, eq(sourceState.sourceId, sources.id))
        .where(eq(sources.workspaceId, workspaceId));
      return rows.map((row) => row.state as SourceStateRow);
    },

    async recordRun(sourceId, input, now) {
      await db
        .insert(sourceState)
        .values({
          sourceId,
          cursor: input.cursor ?? null,
          status: input.status,
          lastRunAt: now,
          lastSuccessAt: input.succeeded ? now : null,
          consecutiveFailures: input.succeeded ? 0 : 1,
          backoffUntil: input.backoffUntil ?? null,
          lastMessage: input.message,
          lastRemedy: input.remedy ?? null,
          itemsLastRun: input.itemsFetched,
        })
        .onConflictDoUpdate({
          target: sourceState.sourceId,
          set: {
            cursor: input.cursor ?? null,
            status: input.status,
            lastRunAt: now,
            ...(input.succeeded ? { lastSuccessAt: now } : {}),
            consecutiveFailures: input.succeeded
              ? 0
              : sql`${sourceState.consecutiveFailures} + 1`,
            backoffUntil: input.backoffUntil ?? null,
            lastMessage: input.message,
            lastRemedy: input.remedy ?? null,
            itemsLastRun: input.itemsFetched,
            updatedAt: now,
          },
        });

      await db.insert(sourceHealthEvents).values({
        sourceId,
        status: input.status,
        message: input.message,
        itemsFetched: input.itemsFetched,
        durationMs: input.durationMs ?? null,
      });
    },

    async recordFetch(workspaceId, input, now) {
      await db.insert(fetchRecords).values({
        workspaceId,
        sourceId: input.sourceId,
        runId: input.runId ?? null,
        url: input.url,
        finalUrl: input.finalUrl ?? null,
        httpStatus: input.httpStatus ?? null,
        contentHash: input.contentHash ?? null,
        bytes: input.bytes ?? 0,
        hops: input.hops ?? [],
        robotsDecision: input.robotsDecision ?? null,
        blockedReason: input.blockedReason ?? null,
        fetchedAt: now,
      });
    },

    async recentFetches(workspaceId, limit = 50) {
      return db
        .select({
          url: fetchRecords.url,
          httpStatus: fetchRecords.httpStatus,
          blockedReason: fetchRecords.blockedReason,
          fetchedAt: fetchRecords.fetchedAt,
        })
        .from(fetchRecords)
        .where(eq(fetchRecords.workspaceId, workspaceId))
        .orderBy(desc(fetchRecords.fetchedAt))
        .limit(limit);
    },
  };
}
