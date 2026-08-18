import { z } from 'zod';
import {
  assessClusterReadiness,
  computeClusterConfidence,
  computeClusterMetrics,
  DEFAULT_CLUSTERING,
  findCluster,
} from '../../domain/clustering/index';
import type { ClusterableEvidence, ClusteringThresholds } from '../../domain/clustering/index';
import { LEXICAL_MODEL, lexicalEmbedding, packEmbedding, unpackEmbedding } from '../../domain/dedupe/embedding';
import { errors } from '../../domain/types/errors';
import type { ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { ClusterableEvidenceRow } from '../../ports/repositories/intelligence';
import type { ClusterRow } from '../../ports/repositories/opportunities';

export interface ClusterDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
  thresholds?: ClusteringThresholds;
}

function toDomain(row: ClusterableEvidenceRow): ClusterableEvidence {
  return {
    id: row.id,
    claimText: row.claimText,
    matchText: `${row.claimText} ${row.bodyText}`.trim(),
    embedding: row.embedding ? unpackEmbedding(row.embedding) : null,
    embeddingModel: row.embeddingModel,
    entityKeys: row.entityKeys,
    evidenceClass: row.evidenceClass,
    originKeys: row.originKeys,
    mentionCount: row.mentionCount,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    strength: row.strength,
  };
}

export const createClusterInput = z.object({
  title: z.string().trim().min(3, 'Name the problem, not the solution.').max(200),
  problemStatement: z
    .string()
    .trim()
    .min(10, 'State the problem in a sentence someone affected would recognise.')
    .max(2000),
  targetCustomer: z.string().trim().max(300).optional().nullable(),
  evidenceUnitIds: z.array(z.string().uuid()).max(500).default([]),
});

export type CreateClusterInput = z.infer<typeof createClusterInput>;

/** Creates a cluster by hand and attaches the evidence it was drawn from. */
export async function createCluster(
  deps: ClusterDeps,
  ctx: ActorCtx,
  input: CreateClusterInput,
): Promise<ClusterRow> {
  if (!can(ctx, 'clusters.write')) throw errors.forbidden('clusters.write');
  const parsed = createClusterInput.parse(input);
  const now = deps.clock.now();

  return deps.tx.transaction(async (repos) => {
    const cluster = await repos.clusters.create(ctx.workspaceId, {
      title: parsed.title,
      problemStatement: parsed.problemStatement,
      targetCustomer: parsed.targetCustomer ?? null,
      createdByUserId: 'userId' in ctx ? ctx.userId : null,
      observedAt: now,
    });

    for (const evidenceUnitId of parsed.evidenceUnitIds) {
      await repos.clusters.addMember(cluster.id, evidenceUnitId, 'manual');
    }

    await repos.audit.record(ctx, {
      action: 'cluster.created',
      entityType: 'cluster',
      entityId: cluster.id,
      after: { title: parsed.title, members: parsed.evidenceUnitIds.length },
    });

    return recomputeWithin(repos, deps, ctx.workspaceId, cluster.id, now);
  });
}

/**
 * Recomputes a cluster's headline metrics from its live membership.
 *
 * Called whenever membership or evidence strength changes. The numbers are
 * materialised rather than computed on read so the dashboard stays cheap, and
 * because the *change* in them is what the daily brief reports.
 */
export async function recomputeCluster(
  deps: ClusterDeps,
  ctx: ActorCtx,
  clusterId: string,
): Promise<ClusterRow> {
  const now = deps.clock.now();
  return deps.tx.transaction((repos) => recomputeWithin(repos, deps, ctx.workspaceId, clusterId, now));
}

async function recomputeWithin(
  repos: Repositories,
  deps: ClusterDeps,
  workspaceId: string,
  clusterId: string,
  now: Date,
): Promise<ClusterRow> {
  const memberIds = await repos.clusters.memberEvidenceIds(clusterId);
  const members = memberIds.length
    ? (await repos.evidence.listClusterable(workspaceId, { evidenceUnitIds: memberIds })).map(toDomain)
    : [];

  const metrics = computeClusterMetrics(members, now);

  await repos.clusters.updateMetrics(clusterId, {
    rawMentions: metrics.rawMentions,
    uniqueEvidenceCount: metrics.uniqueEvidenceCount,
    independentSourceCount: metrics.independentSourceCount,
    sourceDiversity: metrics.sourceDiversity,
    momentum30d: metrics.momentum30d,
    confidence: computeClusterConfidence(metrics),
    lastEvidenceAt: metrics.lastEvidenceAt ?? now,
  });

  // The centroid is the mean of member vectors, so the cluster drifts towards
  // what it actually contains rather than staying anchored to its first member.
  const vectors = members
    .map((member) => member.embedding)
    .filter((vector): vector is Float32Array => vector !== null);

  if (vectors.length > 0) {
    const dimensions = vectors[0]!.length;
    const mean = new Float32Array(dimensions);
    for (const vector of vectors) {
      for (let index = 0; index < dimensions; index += 1) mean[index]! += vector[index]! / vectors.length;
    }
    await repos.clusters.setCentroid(clusterId, packEmbedding(mean), LEXICAL_MODEL);
  } else {
    await repos.clusters.setCentroid(clusterId, null, null);
  }

  const cluster = await repos.clusters.findById(workspaceId, clusterId);
  if (!cluster) throw errors.notFound('cluster');
  return cluster;
}

export interface AssignmentOutcome {
  evidenceUnitId: string;
  clusterId: string | null;
  method: 'semantic' | 'lexical' | 'entity' | 'manual' | 'unassigned';
  similarity: number;
}

/**
 * Places unclustered evidence into existing clusters where it fits.
 *
 * Evidence that matches nothing is deliberately left alone rather than made
 * into a cluster of one: a single observation is not a problem statement, and
 * inventing a cluster per signal would turn the clusters view into the signals
 * view. It surfaces as unclustered evidence instead, which is honest.
 */
export async function assignUnclusteredEvidence(
  deps: ClusterDeps,
  ctx: ActorCtx,
  options: { limit?: number } = {},
): Promise<AssignmentOutcome[]> {
  if (!can(ctx, 'clusters.write')) throw errors.forbidden('clusters.write');

  const thresholds = deps.thresholds ?? DEFAULT_CLUSTERING;
  const now = deps.clock.now();

  const pending = await deps.repos.evidence.listClusterable(ctx.workspaceId, {
    unclusteredOnly: true,
    limit: options.limit ?? 200,
  });
  if (pending.length === 0) return [];

  const centroidRows = await deps.repos.clusters.centroids(ctx.workspaceId);
  const centroids = centroidRows.map((row) => ({
    clusterId: row.clusterId,
    embedding: row.embedding ? unpackEmbedding(row.embedding) : null,
    embeddingModel: row.embeddingModel,
    title: row.title,
    problemStatement: row.problemStatement,
    entityKeys: row.entityKeys,
  }));

  const outcomes: AssignmentOutcome[] = [];
  const touched = new Set<string>();

  for (const row of pending) {
    const evidence = toDomain(row);
    // Evidence recorded before embeddings existed still needs a vector to be
    // comparable; deriving it here keeps old rows usable.
    if (!evidence.embedding) {
      evidence.embedding = lexicalEmbedding(evidence.matchText);
      evidence.embeddingModel = LEXICAL_MODEL;
    }

    const match = findCluster(evidence, centroids, thresholds);
    if (!match) {
      outcomes.push({ evidenceUnitId: evidence.id, clusterId: null, method: 'unassigned', similarity: 0 });
      continue;
    }

    await deps.repos.clusters.addMember(match.clusterId, evidence.id, `auto:${match.method}`);
    touched.add(match.clusterId);
    outcomes.push({
      evidenceUnitId: evidence.id,
      clusterId: match.clusterId,
      method: match.method,
      similarity: match.similarity,
    });
  }

  for (const clusterId of touched) {
    await deps.tx.transaction((repos) => recomputeWithin(repos, deps, ctx.workspaceId, clusterId, now));
  }

  if (touched.size > 0) {
    await deps.repos.audit.record(ctx, {
      action: 'cluster.evidence_assigned',
      entityType: 'cluster',
      after: { assigned: outcomes.filter((o) => o.clusterId).length, clusters: touched.size },
    });
  }

  return outcomes;
}

export async function addEvidenceToCluster(
  deps: ClusterDeps,
  ctx: ActorCtx,
  clusterId: string,
  evidenceUnitIds: string[],
): Promise<ClusterRow> {
  if (!can(ctx, 'clusters.write')) throw errors.forbidden('clusters.write');
  const now = deps.clock.now();

  return deps.tx.transaction(async (repos) => {
    const cluster = await repos.clusters.findById(ctx.workspaceId, clusterId);
    if (!cluster) throw errors.notFound('cluster');

    for (const evidenceUnitId of evidenceUnitIds) {
      const unit = await repos.evidence.findById(ctx.workspaceId, evidenceUnitId);
      if (!unit) throw errors.notFound('evidence');
      await repos.clusters.addMember(clusterId, evidenceUnitId, 'manual');
    }

    await repos.audit.record(ctx, {
      action: 'cluster.evidence_added',
      entityType: 'cluster',
      entityId: clusterId,
      after: { evidenceUnitIds },
    });

    return recomputeWithin(repos, deps, ctx.workspaceId, clusterId, now);
  });
}

export async function removeEvidenceFromCluster(
  deps: ClusterDeps,
  ctx: ActorCtx,
  clusterId: string,
  evidenceUnitId: string,
): Promise<ClusterRow> {
  if (!can(ctx, 'clusters.write')) throw errors.forbidden('clusters.write');
  const now = deps.clock.now();

  return deps.tx.transaction(async (repos) => {
    await repos.clusters.removeMember(clusterId, evidenceUnitId, now);
    await repos.audit.record(ctx, {
      action: 'cluster.evidence_removed',
      entityType: 'cluster',
      entityId: clusterId,
      after: { evidenceUnitId },
    });
    return recomputeWithin(repos, deps, ctx.workspaceId, clusterId, now);
  });
}

export interface ClusterReadinessView {
  cluster: ClusterRow;
  readiness: ReturnType<typeof assessClusterReadiness>;
}

/** Clusters ranked by whether they have earned attention, with the reason. */
export async function listClustersWithReadiness(
  deps: ClusterDeps,
  ctx: ActorCtx,
  options: { limit?: number; status?: ClusterRow['status'][] } = {},
): Promise<ClusterReadinessView[]> {
  if (!can(ctx, 'signals.read')) throw errors.forbidden('signals.read');
  const thresholds = deps.thresholds ?? DEFAULT_CLUSTERING;

  const clusters = await deps.repos.clusters.list(ctx.workspaceId, {
    limit: options.limit ?? 100,
    status: options.status,
  });

  return clusters.map((cluster) => ({
    cluster,
    readiness: assessClusterReadiness(
      {
        rawMentions: cluster.rawMentions,
        uniqueEvidenceCount: cluster.uniqueEvidenceCount,
        independentEvidenceCount: cluster.uniqueEvidenceCount,
        independentSourceCount: cluster.independentSourceCount,
        sourceDiversity: cluster.sourceDiversity,
        momentum30d: cluster.momentum30d,
        firstSeenAt: cluster.firstSeenAt,
        lastEvidenceAt: cluster.lastEvidenceAt,
        totalStrength: 0,
      },
      thresholds,
    ),
  }));
}
