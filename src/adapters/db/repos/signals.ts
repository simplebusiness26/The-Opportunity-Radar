import { and, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import {
  entities,
  evidenceUnitSignals,
  evidenceUnits,
  signalEntities,
  signalProcessingEvents,
  signals,
  sourceAffiliations,
} from '../schema/index';
import type {
  ClusterableEvidenceRow,
  ComputedSignalFields,
  EntityRepository,
  EvidenceRepository,
  EvidenceUnitRow,
  NewSignal,
  SignalFilter,
  SignalRepository,
  SignalRow,
} from '../../../ports/repositories/intelligence';
import { clusterMembers } from '../schema/index';
import { slugify } from '../../../domain/text/slug';

type Row = typeof signals.$inferSelect;

function toSignalRow(row: Row): SignalRow {
  return {
    ...row,
    signalTypeKey: row.signalTypeKey as SignalRow['signalTypeKey'],
    monetaryEvidence: (row.monetaryEvidence ?? {}) as SignalRow['monetaryEvidence'],
  } as SignalRow;
}

export function createSignalRepository(db: Executor): SignalRepository {
  return {
    async insert(workspaceId, input: NewSignal & { computed: ComputedSignalFields }) {
      const [row] = await db
        .insert(signals)
        .values({
          workspaceId,
          sourceId: input.sourceId ?? null,
          externalId: input.externalId ?? null,
          title: input.title,
          url: input.url ?? null,
          canonicalUrl: input.computed.canonicalUrl,
          bodyText: input.bodyText,
          authorHandle: input.authorHandle ?? null,
          authorIdentityKey: input.computed.authorIdentityKey,
          signalTypeKey: input.signalTypeKey,
          evidenceClass: input.evidenceClass,
          geography: input.geography ?? null,
          segment: input.segment ?? null,
          painPoint: input.painPoint ?? null,
          monetaryEvidence: input.monetaryEvidence ?? {},
          publishedAt: input.publishedAt ?? null,
          observedAt: input.observedAt,
          contentHash: input.computed.contentHash,
          simhash: input.computed.simhash,
          originKey: input.computed.originKey,
          citesUrl: input.citesUrl ?? null,
          embedding: input.computed.embedding,
          embeddingModel: input.computed.embeddingModel,
          halfLifeDaysOverride: input.halfLifeDaysOverride ?? null,
          demo: input.demo ?? false,
        })
        .returning();
      if (!row) throw new Error('insert signal returned no row');
      return toSignalRow(row);
    },

    async findById(workspaceId, id) {
      const rows = await db
        .select()
        .from(signals)
        .where(and(eq(signals.workspaceId, workspaceId), eq(signals.id, id)))
        .limit(1);
      return rows[0] ? toSignalRow(rows[0]) : null;
    },

    async list(workspaceId, filter: SignalFilter = {}) {
      const conditions = [eq(signals.workspaceId, workspaceId)];

      if (filter.signalTypes?.length) conditions.push(inArray(signals.signalTypeKey, filter.signalTypes));
      if (filter.evidenceClasses?.length) conditions.push(inArray(signals.evidenceClass, filter.evidenceClasses));
      if (filter.status?.length) conditions.push(inArray(signals.status, filter.status));
      if (filter.geography) conditions.push(eq(signals.geography, filter.geography));
      if (filter.segment) conditions.push(eq(signals.segment, filter.segment));
      if (filter.observedAfter) conditions.push(gte(signals.observedAt, filter.observedAfter));
      if (filter.observedBefore) conditions.push(lte(signals.observedAt, filter.observedBefore));
      if (!filter.includeDemo) conditions.push(eq(signals.demo, false));

      if (filter.search) {
        const term = `%${filter.search.toLowerCase()}%`;
        conditions.push(
          or(
            sql`lower(${signals.title}) like ${term}`,
            sql`lower(${signals.bodyText}) like ${term}`,
            sql`lower(coalesce(${signals.painPoint}, '')) like ${term}`,
          )!,
        );
      }

      const where = and(...conditions);
      const limit = Math.min(filter.limit ?? 50, 200);

      const [rows, counted] = await Promise.all([
        db.select().from(signals).where(where).orderBy(desc(signals.observedAt)).limit(limit).offset(filter.offset ?? 0),
        db.select({ count: sql<number>`count(*)::int` }).from(signals).where(where),
      ]);

      return { rows: rows.map(toSignalRow), total: counted[0]?.count ?? 0 };
    },

    /**
     * Blocking: only signals that could plausibly match are loaded. Comparing
     * every new signal against the whole history would be quadratic and would
     * make ingestion slow down as the workspace grows.
     */
    async findDedupeCandidates(workspaceId, input) {
      const windowStart = new Date(input.observedAt.getTime() - input.windowDays * 86_400_000);
      const windowEnd = new Date(input.observedAt.getTime() + input.windowDays * 86_400_000);

      const exact = [
        eq(signals.contentHash, input.contentHash),
        ...(input.canonicalUrl ? [eq(signals.canonicalUrl, input.canonicalUrl)] : []),
        ...(input.sourceId && input.externalId
          ? [and(eq(signals.sourceId, input.sourceId), eq(signals.externalId, input.externalId))!]
          : []),
      ];

      const rows = await db
        .select()
        .from(signals)
        .where(
          and(
            eq(signals.workspaceId, workspaceId),
            or(
              or(...exact)!,
              and(gte(signals.observedAt, windowStart), lte(signals.observedAt, windowEnd))!,
            )!,
          ),
        )
        .orderBy(desc(signals.observedAt))
        .limit(input.limit ?? 200);

      return rows.map(toSignalRow);
    },

    async attachToEvidenceUnit(signalId, evidenceUnitId, status) {
      await db.update(signals).set({ evidenceUnitId, status }).where(eq(signals.id, signalId));
    },

    async recordProcessing(signalId, event) {
      await db.insert(signalProcessingEvents).values({
        signalId,
        stage: event.stage,
        decision: event.decision,
        reasonCode: event.reasonCode ?? null,
        detail: event.detail ?? {},
      });
    },

    async listProcessing(signalId) {
      const rows = await db
        .select()
        .from(signalProcessingEvents)
        .where(eq(signalProcessingEvents.signalId, signalId))
        .orderBy(signalProcessingEvents.createdAt);
      return rows.map((row) => ({
        stage: row.stage,
        decision: row.decision,
        reasonCode: row.reasonCode,
        detail: (row.detail ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt,
      }));
    },

    async linkEntities(signalId, entityIds) {
      if (entityIds.length === 0) return;
      await db
        .insert(signalEntities)
        .values(entityIds.map((entityId) => ({ signalId, entityId })))
        .onConflictDoNothing();
    },

    async entityKeysFor(signalIds) {
      if (signalIds.length === 0) return new Map();
      const rows = await db
        .select({ signalId: signalEntities.signalId, matchKey: entities.matchKey })
        .from(signalEntities)
        .innerJoin(entities, eq(signalEntities.entityId, entities.id))
        .where(inArray(signalEntities.signalId, signalIds));

      const result = new Map<string, string[]>();
      for (const row of rows) {
        const existing = result.get(row.signalId) ?? [];
        existing.push(row.matchKey);
        result.set(row.signalId, existing);
      }
      return result;
    },

    async countByType(workspaceId) {
      const rows = await db
        .select({ signalTypeKey: signals.signalTypeKey, count: sql<number>`count(*)::int` })
        .from(signals)
        .where(and(eq(signals.workspaceId, workspaceId), eq(signals.demo, false)))
        .groupBy(signals.signalTypeKey);
      return rows as Array<{ signalTypeKey: SignalRow['signalTypeKey']; count: number }>;
    },
  };
}

export function createEvidenceRepository(db: Executor): EvidenceRepository {
  const toRow = (row: typeof evidenceUnits.$inferSelect): EvidenceUnitRow => row as EvidenceUnitRow;

  return {
    async create(workspaceId, input) {
      const [row] = await db
        .insert(evidenceUnits)
        .values({
          workspaceId,
          canonicalClaim: input.canonicalClaim,
          evidenceClass: input.evidenceClass,
          signalTypeKey: input.signalTypeKey,
          representativeSignalId: input.representativeSignalId,
          baseStrength: input.baseStrength,
          effectiveStrength: input.effectiveStrength,
          firstSeenAt: input.observedAt,
          lastSeenAt: input.observedAt,
          demo: input.demo,
        })
        .returning();
      if (!row) throw new Error('create evidence unit returned no row');
      return toRow(row);
    },

    async addMention(evidenceUnitId, signalId, input) {
      await db
        .insert(evidenceUnitSignals)
        .values({
          evidenceUnitId,
          signalId,
          role: input.role,
          dedupeReason: input.dedupeReason,
          detail: input.detail,
        })
        .onConflictDoNothing();

      await db
        .update(evidenceUnits)
        .set({
          lastSeenAt: sql`greatest(${evidenceUnits.lastSeenAt}, ${input.observedAt})`,
          firstSeenAt: sql`least(${evidenceUnits.firstSeenAt}, ${input.observedAt})`,
        })
        .where(eq(evidenceUnits.id, evidenceUnitId));
    },

    async findById(workspaceId, id) {
      const rows = await db
        .select()
        .from(evidenceUnits)
        .where(and(eq(evidenceUnits.workspaceId, workspaceId), eq(evidenceUnits.id, id)))
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async listByIds(workspaceId, ids) {
      if (ids.length === 0) return [];
      const rows = await db
        .select()
        .from(evidenceUnits)
        .where(and(eq(evidenceUnits.workspaceId, workspaceId), inArray(evidenceUnits.id, ids)));
      return rows.map(toRow);
    },

    async mentionsFor(evidenceUnitIds) {
      if (evidenceUnitIds.length === 0) return [];
      return db
        .select({
          evidenceUnitId: evidenceUnitSignals.evidenceUnitId,
          originKey: signals.originKey,
          authorIdentityKey: signals.authorIdentityKey,
          evidenceClass: signals.evidenceClass,
        })
        .from(evidenceUnitSignals)
        .innerJoin(signals, eq(evidenceUnitSignals.signalId, signals.id))
        .where(inArray(evidenceUnitSignals.evidenceUnitId, evidenceUnitIds));
    },

    async refreshCounts(evidenceUnitId, counts) {
      await db
        .update(evidenceUnits)
        .set({
          mentionCount: counts.mentionCount,
          independentSourceCount: counts.independentSourceCount,
        })
        .where(eq(evidenceUnits.id, evidenceUnitId));
    },

    async updateStrength(evidenceUnitId, effectiveStrength, computedAt) {
      await db
        .update(evidenceUnits)
        .set({ effectiveStrength, strengthComputedAt: computedAt })
        .where(eq(evidenceUnits.id, evidenceUnitId));
    },

    async affiliations(workspaceId) {
      const rows = await db
        .select()
        .from(sourceAffiliations)
        .where(eq(sourceAffiliations.workspaceId, workspaceId));
      return new Map(rows.map((row) => [row.originKey, row.groupKey]));
    },

    async listClusterable(workspaceId, options = {}) {
      const conditions = [eq(evidenceUnits.workspaceId, workspaceId)];
      if (options.evidenceUnitIds?.length) {
        conditions.push(inArray(evidenceUnits.id, options.evidenceUnitIds));
      }
      if (options.unclusteredOnly) {
        // Evidence with no live cluster membership. Removed members leave a row
        // with removed_at set, so they become eligible again.
        conditions.push(
          sql`not exists (
            select 1 from ${clusterMembers}
            where ${clusterMembers.evidenceUnitId} = ${evidenceUnits.id}
              and ${clusterMembers.removedAt} is null
          )`,
        );
      }

      const units = await db
        .select({
          id: evidenceUnits.id,
          claimText: evidenceUnits.canonicalClaim,
          evidenceClass: evidenceUnits.evidenceClass,
          mentionCount: evidenceUnits.mentionCount,
          firstSeenAt: evidenceUnits.firstSeenAt,
          lastSeenAt: evidenceUnits.lastSeenAt,
          strength: evidenceUnits.effectiveStrength,
          bodyText: signals.bodyText,
          embedding: signals.embedding,
          embeddingModel: signals.embeddingModel,
        })
        .from(evidenceUnits)
        .leftJoin(signals, eq(evidenceUnits.representativeSignalId, signals.id))
        .where(and(...conditions))
        .orderBy(desc(evidenceUnits.lastSeenAt))
        .limit(Math.min(options.limit ?? 500, 2000));

      if (units.length === 0) return [];
      const ids = units.map((unit) => unit.id);

      const originRows = await db
        .select({
          evidenceUnitId: evidenceUnitSignals.evidenceUnitId,
          originKey: signals.originKey,
          authorIdentityKey: signals.authorIdentityKey,
        })
        .from(evidenceUnitSignals)
        .innerJoin(signals, eq(evidenceUnitSignals.signalId, signals.id))
        .where(inArray(evidenceUnitSignals.evidenceUnitId, ids));

      const entityRows = await db
        .select({
          evidenceUnitId: evidenceUnitSignals.evidenceUnitId,
          matchKey: entities.matchKey,
        })
        .from(evidenceUnitSignals)
        .innerJoin(signalEntities, eq(evidenceUnitSignals.signalId, signalEntities.signalId))
        .innerJoin(entities, eq(signalEntities.entityId, entities.id))
        .where(inArray(evidenceUnitSignals.evidenceUnitId, ids));

      const originsBy = new Map<string, Set<string>>();
      for (const row of originRows) {
        const key = row.originKey ?? row.authorIdentityKey;
        if (!key) continue;
        const set = originsBy.get(row.evidenceUnitId) ?? new Set<string>();
        set.add(key);
        originsBy.set(row.evidenceUnitId, set);
      }

      const entitiesBy = new Map<string, Set<string>>();
      for (const row of entityRows) {
        const set = entitiesBy.get(row.evidenceUnitId) ?? new Set<string>();
        set.add(row.matchKey);
        entitiesBy.set(row.evidenceUnitId, set);
      }

      return units.map(
        (unit): ClusterableEvidenceRow => ({
          id: unit.id,
          claimText: unit.claimText,
          bodyText: unit.bodyText ?? '',
          embedding: unit.embedding,
          embeddingModel: unit.embeddingModel,
          entityKeys: [...(entitiesBy.get(unit.id) ?? [])],
          evidenceClass: unit.evidenceClass,
          originKeys: [...(originsBy.get(unit.id) ?? [])],
          mentionCount: unit.mentionCount,
          firstSeenAt: unit.firstSeenAt,
          lastSeenAt: unit.lastSeenAt,
          strength: unit.strength,
        }),
      );
    },
  };
}

export function createEntityRepository(db: Executor): EntityRepository {
  return {
    async upsertMany(workspaceId, names) {
      if (names.length === 0) return [];

      const values = names
        .map(({ name, kind }) => ({
          workspaceId,
          kind: kind ?? 'topic',
          canonicalName: name.trim(),
          matchKey: slugify(name),
        }))
        .filter((value) => value.matchKey.length > 0);

      if (values.length === 0) return [];

      await db.insert(entities).values(values).onConflictDoNothing();

      const rows = await db
        .select({ id: entities.id, matchKey: entities.matchKey })
        .from(entities)
        .where(
          and(
            eq(entities.workspaceId, workspaceId),
            inArray(
              entities.matchKey,
              values.map((value) => value.matchKey),
            ),
          ),
        );
      return rows;
    },
  };
}

