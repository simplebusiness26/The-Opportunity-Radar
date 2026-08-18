import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import {
  clusterMembers,
  clusters,
  decisionLog,
  entities,
  evidenceUnitSignals,
  signalEntities,
  opportunities,
  opportunityEvidence,
  opportunityCapabilityRequirements,
  opportunityStateTransitions,
  scoreDeltas,
  scoreWeightProfiles,
  scores,
} from '../schema/index';
import type {
  CapabilityRequirementRow,
  ClusterRepository,
  ClusterRow,
  DecisionRepository,
  OpportunityRepository,
  OpportunityRow,
  ScoreDeltaRow,
  ScoreRepository,
  ScoreRow,
} from '../../../ports/repositories/opportunities';

export function createClusterRepository(db: Executor): ClusterRepository {
  const toRow = (row: typeof clusters.$inferSelect): ClusterRow => row as ClusterRow;

  return {
    async create(workspaceId, input) {
      const [row] = await db
        .insert(clusters)
        .values({
          workspaceId,
          title: input.title,
          problemStatement: input.problemStatement,
          targetCustomer: input.targetCustomer ?? null,
          createdByUserId: input.createdByUserId ?? null,
          firstSeenAt: input.observedAt,
          lastEvidenceAt: input.observedAt,
          demo: input.demo ?? false,
        })
        .returning();
      if (!row) throw new Error('create cluster returned no row');
      return toRow(row);
    },

    async findById(workspaceId, id) {
      const rows = await db
        .select()
        .from(clusters)
        .where(and(eq(clusters.workspaceId, workspaceId), eq(clusters.id, id)))
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async list(workspaceId, options = {}) {
      const conditions = [eq(clusters.workspaceId, workspaceId)];
      if (options.status?.length) conditions.push(inArray(clusters.status, options.status));
      if (!options.includeDemo) conditions.push(eq(clusters.demo, false));

      const rows = await db
        .select()
        .from(clusters)
        .where(and(...conditions))
        .orderBy(desc(clusters.independentSourceCount), desc(clusters.lastEvidenceAt))
        .limit(Math.min(options.limit ?? 100, 300));
      return rows.map(toRow);
    },

    async addMember(clusterId, evidenceUnitId, addedBy) {
      await db
        .insert(clusterMembers)
        .values({ clusterId, evidenceUnitId, addedBy })
        .onConflictDoUpdate({
          target: [clusterMembers.clusterId, clusterMembers.evidenceUnitId],
          // Re-adding something previously removed brings it back rather than
          // leaving a tombstone that silently excludes it.
          set: { removedAt: sql`null`, addedBy },
        });
    },

    async removeMember(clusterId, evidenceUnitId, at) {
      await db
        .update(clusterMembers)
        .set({ removedAt: at })
        .where(
          and(eq(clusterMembers.clusterId, clusterId), eq(clusterMembers.evidenceUnitId, evidenceUnitId)),
        );
    },

    async memberEvidenceIds(clusterId) {
      const rows = await db
        .select({ evidenceUnitId: clusterMembers.evidenceUnitId })
        .from(clusterMembers)
        .where(and(eq(clusterMembers.clusterId, clusterId), isNull(clusterMembers.removedAt)));
      return rows.map((row) => row.evidenceUnitId);
    },

    async updateMetrics(clusterId, metrics) {
      await db
        .update(clusters)
        .set({
          rawMentions: metrics.rawMentions,
          uniqueEvidenceCount: metrics.uniqueEvidenceCount,
          independentSourceCount: metrics.independentSourceCount,
          sourceDiversity: metrics.sourceDiversity,
          confidence: metrics.confidence,
          lastEvidenceAt: metrics.lastEvidenceAt,
          momentum30d: metrics.momentum30d ?? null,
        })
        .where(eq(clusters.id, clusterId));
    },

    async setStatus(clusterId, status) {
      await db.update(clusters).set({ status }).where(eq(clusters.id, clusterId));
    },

    async centroids(workspaceId) {
      const rows = await db
        .select({
          clusterId: clusters.id,
          embedding: clusters.centroidEmbedding,
          embeddingModel: clusters.centroidEmbeddingModel,
          title: clusters.title,
          problemStatement: clusters.problemStatement,
        })
        .from(clusters)
        .where(
          and(
            eq(clusters.workspaceId, workspaceId),
            // A merged cluster is a redirect, not a destination.
            isNull(clusters.mergedIntoId),
          ),
        );

      if (rows.length === 0) return [];

      const entityRows = await db
        .select({ clusterId: clusterMembers.clusterId, matchKey: entities.matchKey })
        .from(clusterMembers)
        .innerJoin(evidenceUnitSignals, eq(clusterMembers.evidenceUnitId, evidenceUnitSignals.evidenceUnitId))
        .innerJoin(signalEntities, eq(evidenceUnitSignals.signalId, signalEntities.signalId))
        .innerJoin(entities, eq(signalEntities.entityId, entities.id))
        .where(
          and(
            inArray(
              clusterMembers.clusterId,
              rows.map((row) => row.clusterId),
            ),
            isNull(clusterMembers.removedAt),
          ),
        );

      const entitiesBy = new Map<string, Set<string>>();
      for (const row of entityRows) {
        const set = entitiesBy.get(row.clusterId) ?? new Set<string>();
        set.add(row.matchKey);
        entitiesBy.set(row.clusterId, set);
      }

      return rows.map((row) => ({
        clusterId: row.clusterId,
        embedding: row.embedding ? Buffer.from(row.embedding, 'base64') : null,
        embeddingModel: row.embeddingModel,
        title: row.title,
        problemStatement: row.problemStatement,
        entityKeys: [...(entitiesBy.get(row.clusterId) ?? [])],
      }));
    },

    async clusterIdsForEvidence(workspaceId, evidenceUnitId) {
      const rows = await db
        .select({ clusterId: clusterMembers.clusterId })
        .from(clusterMembers)
        .innerJoin(clusters, eq(clusterMembers.clusterId, clusters.id))
        .where(
          and(
            eq(clusters.workspaceId, workspaceId),
            eq(clusterMembers.evidenceUnitId, evidenceUnitId),
            isNull(clusterMembers.removedAt),
          ),
        );
      return rows.map((row) => row.clusterId);
    },

    async setCentroid(clusterId, embedding, embeddingModel) {
      await db
        .update(clusters)
        .set({
          centroidEmbedding: embedding ? embedding.toString('base64') : null,
          centroidEmbeddingModel: embeddingModel,
        })
        .where(eq(clusters.id, clusterId));
    },
  };
}

export function createOpportunityRepository(db: Executor): OpportunityRepository {
  const toRow = (row: typeof opportunities.$inferSelect): OpportunityRow =>
    ({ ...row, notes: (row.notes ?? {}) as Record<string, unknown> }) as OpportunityRow;

  return {
    async capabilityRequirements(opportunityId) {
      return db
        .select({
          id: opportunityCapabilityRequirements.id,
          opportunityId: opportunityCapabilityRequirements.opportunityId,
          label: opportunityCapabilityRequirements.label,
          taxonomyKey: opportunityCapabilityRequirements.taxonomyKey,
          criticality: opportunityCapabilityRequirements.criticality,
          resolvedBy: opportunityCapabilityRequirements.resolvedBy,
        })
        .from(opportunityCapabilityRequirements)
        .where(eq(opportunityCapabilityRequirements.opportunityId, opportunityId)) as unknown as Promise<
        CapabilityRequirementRow[]
      >;
    },

    async setCapabilityRequirements(workspaceId, opportunityId, requirements) {
      // Replaced wholesale rather than merged: the set of things an opportunity
      // needs is a statement about it, not an accumulation of edits.
      await db
        .delete(opportunityCapabilityRequirements)
        .where(eq(opportunityCapabilityRequirements.opportunityId, opportunityId));

      if (requirements.length === 0) return;

      await db.insert(opportunityCapabilityRequirements).values(
        requirements.map((requirement) => ({
          workspaceId,
          opportunityId,
          label: requirement.label,
          taxonomyKey: requirement.taxonomyKey,
          criticality: requirement.criticality,
          resolvedBy: requirement.resolvedBy,
        })),
      );
    },

    async nextReference(workspaceId) {
      // Human-facing reference numbers are per workspace and start at 1, so the
      // owner can say "opportunity 27" and mean something stable.
      const rows = await db
        .select({ max: sql<number>`coalesce(max(${opportunities.reference}), 0)::int` })
        .from(opportunities)
        .where(eq(opportunities.workspaceId, workspaceId));
      return (rows[0]?.max ?? 0) + 1;
    },

    async create(workspaceId, input) {
      const reference = await this.nextReference(workspaceId);
      const [row] = await db
        .insert(opportunities)
        .values({
          workspaceId,
          reference,
          clusterId: input.clusterId ?? null,
          title: input.title,
          thesis: input.thesis,
          typeKey: input.typeKey,
          targetCustomer: input.targetCustomer ?? null,
          problemStatement: input.problemStatement ?? null,
          whyNow: input.whyNow ?? null,
          ownerUserId: input.ownerUserId ?? null,
          createdBy: input.createdBy,
          demo: input.demo ?? false,
        })
        .returning();
      if (!row) throw new Error('create opportunity returned no row');
      return toRow(row);
    },

    async findById(workspaceId, id) {
      const rows = await db
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.workspaceId, workspaceId), eq(opportunities.id, id)))
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async findByReference(workspaceId, reference) {
      const rows = await db
        .select()
        .from(opportunities)
        .where(and(eq(opportunities.workspaceId, workspaceId), eq(opportunities.reference, reference)))
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async list(workspaceId, options = {}) {
      const conditions = [eq(opportunities.workspaceId, workspaceId)];
      if (options.states?.length) conditions.push(inArray(opportunities.state, options.states));
      if (options.typeKeys?.length) conditions.push(inArray(opportunities.typeKey, options.typeKeys));
      if (!options.includeDemo) conditions.push(eq(opportunities.demo, false));

      const rows = await db
        .select()
        .from(opportunities)
        .where(and(...conditions))
        .orderBy(desc(opportunities.updatedAt))
        .limit(Math.min(options.limit ?? 100, 300));
      return rows.map(toRow);
    },

    async update(workspaceId, id, patch, now) {
      const [row] = await db
        .update(opportunities)
        .set({ ...patch, updatedAt: now })
        .where(and(eq(opportunities.workspaceId, workspaceId), eq(opportunities.id, id)))
        .returning();
      if (!row) throw new Error('opportunity not found');
      return toRow(row);
    },

    async setState(id, state, at) {
      await db
        .update(opportunities)
        .set({ state, stateSince: at, updatedAt: at })
        .where(eq(opportunities.id, id));
    },

    async recordTransition(input) {
      await db.insert(opportunityStateTransitions).values({
        opportunityId: input.opportunityId,
        fromState: input.fromState,
        toState: input.toState,
        reason: input.reason,
        actorKind: input.actorKind,
        actorUserId: input.actorUserId,
        evidence: input.evidence ?? {},
      });
    },

    async listTransitions(opportunityId) {
      const rows = await db
        .select()
        .from(opportunityStateTransitions)
        .where(eq(opportunityStateTransitions.opportunityId, opportunityId))
        .orderBy(desc(opportunityStateTransitions.createdAt));
      return rows.map((row) => ({
        fromState: row.fromState,
        toState: row.toState,
        reason: row.reason,
        actorKind: row.actorKind,
        evidence: (row.evidence ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt,
      }));
    },

    async attachEvidence(input) {
      await db
        .insert(opportunityEvidence)
        .values({
          opportunityId: input.opportunityId,
          evidenceUnitId: input.evidenceUnitId,
          stance: input.stance,
          weight: input.weight ?? 1,
          note: input.note ?? null,
          addedBy: input.addedBy,
        })
        .onConflictDoUpdate({
          target: [
            opportunityEvidence.opportunityId,
            opportunityEvidence.evidenceUnitId,
            opportunityEvidence.stance,
          ],
          set: { weight: input.weight ?? 1, note: input.note ?? null },
        });
    },

    async detachEvidence(opportunityId, evidenceUnitId, stance) {
      await db
        .delete(opportunityEvidence)
        .where(
          and(
            eq(opportunityEvidence.opportunityId, opportunityId),
            eq(opportunityEvidence.evidenceUnitId, evidenceUnitId),
            eq(opportunityEvidence.stance, stance),
          ),
        );
    },

    async evidenceFor(opportunityId) {
      const rows = await db
        .select()
        .from(opportunityEvidence)
        .where(eq(opportunityEvidence.opportunityId, opportunityId));
      return rows.map((row) => ({
        evidenceUnitId: row.evidenceUnitId,
        stance: row.stance,
        weight: row.weight,
        note: row.note,
      }));
    },
  };
}

export function createScoreRepository(db: Executor): ScoreRepository {
  const toRow = (row: typeof scores.$inferSelect): ScoreRow => row as ScoreRow;

  return {
    async save(workspaceId, opportunityId, input) {
      // Exactly one current score per opportunity, enforced by a partial unique
      // index; the previous one is demoted in the same transaction.
      await db
        .update(scores)
        .set({ isCurrent: false })
        .where(and(eq(scores.opportunityId, opportunityId), eq(scores.isCurrent, true)));

      const composites = input.result.composites;
      const [row] = await db
        .insert(scores)
        .values({
          workspaceId,
          opportunityId,
          profileId: input.profileId,
          engineVersion: input.result.engineVersion,
          inputsDigest: input.result.inputsDigest,
          inputsSnapshot: input.snapshot as unknown as Record<string, unknown>,
          attractiveness: composites.attractiveness.value,
          fit: composites.fit.value,
          leverage: composites.leverage.value,
          timing: composites.timing.value,
          validationEfficiency: composites.validation_efficiency.value,
          strategicValue: composites.strategic_value.value,
          executionRisk: composites.execution_risk.value,
          confidence: input.result.confidence.value,
          dimensions: input.result.dimensions as unknown as Record<string, unknown>,
          gaps: input.result.gaps as unknown as Record<string, unknown>,
          confidenceFactors: input.result.confidence.factors as unknown as Record<string, unknown>,
          isCurrent: true,
          computedAt: input.computedAt,
        })
        .returning();
      if (!row) throw new Error('save score returned no row');
      return toRow(row);
    },

    async current(workspaceId, opportunityId) {
      const rows = await db
        .select()
        .from(scores)
        .where(
          and(
            eq(scores.workspaceId, workspaceId),
            eq(scores.opportunityId, opportunityId),
            eq(scores.isCurrent, true),
          ),
        )
        .limit(1);
      return rows[0] ? toRow(rows[0]) : null;
    },

    async history(workspaceId, opportunityId, limit = 50) {
      const rows = await db
        .select()
        .from(scores)
        .where(and(eq(scores.workspaceId, workspaceId), eq(scores.opportunityId, opportunityId)))
        .orderBy(desc(scores.computedAt))
        .limit(limit);
      return rows.map(toRow);
    },

    async currentForMany(workspaceId, opportunityIds) {
      if (opportunityIds.length === 0) return new Map();
      const rows = await db
        .select()
        .from(scores)
        .where(
          and(
            eq(scores.workspaceId, workspaceId),
            inArray(scores.opportunityId, opportunityIds),
            eq(scores.isCurrent, true),
          ),
        );
      return new Map(rows.map((row) => [row.opportunityId, toRow(row)]));
    },

    async recordDeltas(workspaceId, opportunityId, input) {
      if (input.deltas.length === 0) return;
      await db.insert(scoreDeltas).values(
        input.deltas.map((delta) => ({
          workspaceId,
          opportunityId,
          fromScoreId: input.fromScoreId,
          toScoreId: input.toScoreId,
          composite: delta.composite,
          fromValue: delta.from,
          toValue: delta.to,
          delta: Math.round(delta.delta),
          topDrivers: delta.topDrivers as Record<string, unknown>,
          cause: input.cause,
        })),
      );
    },

    async recentDeltas(workspaceId, since, limit = 50) {
      const rows = await db
        .select()
        .from(scoreDeltas)
        .where(and(eq(scoreDeltas.workspaceId, workspaceId), gte(scoreDeltas.createdAt, since)))
        .orderBy(desc(scoreDeltas.createdAt))
        .limit(limit);
      return rows.map(
        (row): ScoreDeltaRow => ({
          id: row.id,
          opportunityId: row.opportunityId,
          toScoreId: row.toScoreId,
          composite: row.composite,
          fromValue: row.fromValue,
          toValue: row.toValue,
          delta: row.delta,
          topDrivers: (row.topDrivers ?? []) as ScoreDeltaRow['topDrivers'],
          cause: row.cause,
          createdAt: row.createdAt,
        }),
      );
    },

    async activeWeights(workspaceId) {
      const rows = await db
        .select()
        .from(scoreWeightProfiles)
        .where(and(eq(scoreWeightProfiles.workspaceId, workspaceId), eq(scoreWeightProfiles.active, true)))
        .limit(1);
      const profile = rows[0];
      return {
        profileId: profile?.id ?? null,
        weights: (profile?.weights ?? {}) as Record<string, number>,
      };
    },
  };
}

export function createDecisionRepository(db: Executor): DecisionRepository {
  return {
    async record(workspaceId, input) {
      await db.insert(decisionLog).values({
        workspaceId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        decision: input.decision,
        rationale: input.rationale,
        radarRecommendation: input.radarRecommendation ?? null,
        radarConfidence: input.radarConfidence ?? null,
        actorUserId: input.actorUserId,
        context: input.context ?? {},
      });
    },

    async list(workspaceId, limit = 100) {
      const rows = await db
        .select()
        .from(decisionLog)
        .where(eq(decisionLog.workspaceId, workspaceId))
        .orderBy(desc(decisionLog.createdAt))
        .limit(limit);
      return rows.map((row) => ({
        subjectType: row.subjectType,
        subjectId: row.subjectId,
        decision: row.decision,
        rationale: row.rationale,
        radarRecommendation: row.radarRecommendation,
        radarConfidence: row.radarConfidence,
        createdAt: row.createdAt,
      }));
    },
  };
}
