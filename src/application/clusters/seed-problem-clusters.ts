import {
  assessClusterReadiness,
  computeClusterConfidence,
  computeClusterMetrics,
  DEFAULT_CLUSTERING,
  findCluster,
  type ClusterableEvidence,
  type ClusterCentroid,
  type ClusteringThresholds,
} from '../../domain/clustering/index';
import {
  LEXICAL_MODEL,
  lexicalEmbedding,
  unpackEmbedding,
} from '../../domain/dedupe/embedding';
import type { ActorCtx } from '../../domain/types/identity';
import type { ClusterableEvidenceRow } from '../../ports/repositories/intelligence';
import { createCluster, type ClusterDeps } from './cluster-evidence';

interface SeedMember {
  row: ClusterableEvidenceRow;
  evidence: ClusterableEvidence;
}

interface SeedGroup {
  key: string;
  representative: SeedMember;
  members: SeedMember[];
}

export interface SeedProblemClustersResult {
  considered: number;
  candidateGroups: number;
  created: number;
  createdClusterIds: string[];
}

function toDomain(row: ClusterableEvidenceRow): ClusterableEvidence {
  const matchText = `${row.claimText} ${row.bodyText}`.trim();
  return {
    id: row.id,
    claimText: row.claimText,
    matchText,
    embedding: row.embedding ? unpackEmbedding(row.embedding) : lexicalEmbedding(matchText),
    embeddingModel: row.embeddingModel ?? LEXICAL_MODEL,
    entityKeys: row.entityKeys,
    evidenceClass: row.evidenceClass,
    originKeys: row.originKeys,
    mentionCount: row.mentionCount,
    firstSeenAt: row.firstSeenAt,
    lastSeenAt: row.lastSeenAt,
    strength: row.strength,
  };
}

function asCentroid(group: SeedGroup): ClusterCentroid {
  const representative = group.representative.evidence;
  return {
    clusterId: group.key,
    embedding: representative.embedding,
    embeddingModel: representative.embeddingModel,
    title: representative.claimText,
    problemStatement: representative.matchText,
    entityKeys: representative.entityKeys,
  };
}

function cleanTitle(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return (oneLine || 'Repeated market problem').slice(0, 200);
}

function problemStatement(value: string): string {
  const claim = value.replace(/\s+/g, ' ').trim();
  return `Repeated independent evidence indicates this problem: ${claim}`.slice(0, 2000);
}

/**
 * Seeds real problem clusters from repeated, still-unclustered evidence.
 *
 * The existing assignment engine intentionally refuses to turn one observation
 * into a problem. This keeps that rule: loose evidence is grouped provisionally,
 * then only groups already satisfying the normal readiness gate are persisted.
 * A singleton can never create a market problem by itself.
 */
export async function seedProblemClusters(
  deps: ClusterDeps,
  ctx: ActorCtx,
  options: { limit?: number; maxClusters?: number; thresholds?: ClusteringThresholds } = {},
): Promise<SeedProblemClustersResult> {
  const thresholds = options.thresholds ?? deps.thresholds ?? DEFAULT_CLUSTERING;
  const rows = await deps.repos.evidence.listClusterable(ctx.workspaceId, {
    unclusteredOnly: true,
    limit: options.limit ?? 500,
  });

  if (rows.length === 0) {
    return { considered: 0, candidateGroups: 0, created: 0, createdClusterIds: [] };
  }

  const ordered = rows
    .map((row) => ({ row, evidence: toDomain(row) }))
    .sort(
      (a, b) =>
        b.evidence.strength - a.evidence.strength ||
        b.evidence.lastSeenAt.getTime() - a.evidence.lastSeenAt.getTime(),
    );

  const groups: SeedGroup[] = [];

  for (const member of ordered) {
    const match = findCluster(member.evidence, groups.map(asCentroid), thresholds);

    if (match) {
      const group = groups.find((candidate) => candidate.key === match.clusterId);
      if (group) group.members.push(member);
      continue;
    }

    groups.push({
      key: `seed:${member.evidence.id}`,
      representative: member,
      members: [member],
    });
  }

  const ready = groups
    .map((group) => {
      const metrics = computeClusterMetrics(
        group.members.map((member) => member.evidence),
        deps.clock.now(),
      );
      return {
        group,
        metrics,
        confidence: computeClusterConfidence(metrics),
        readiness: assessClusterReadiness(metrics, thresholds),
      };
    })
    .filter((candidate) => candidate.readiness.ready)
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        b.metrics.independentSourceCount - a.metrics.independentSourceCount ||
        b.metrics.uniqueEvidenceCount - a.metrics.uniqueEvidenceCount,
    )
    .slice(0, options.maxClusters ?? 8);

  const createdClusterIds: string[] = [];

  for (const candidate of ready) {
    const representative = candidate.group.representative.evidence;
    const cluster = await createCluster(deps, ctx, {
      title: cleanTitle(representative.claimText),
      problemStatement: problemStatement(representative.claimText),
      evidenceUnitIds: candidate.group.members.map((member) => member.evidence.id).slice(0, 500),
    });
    createdClusterIds.push(cluster.id);
  }

  return {
    considered: rows.length,
    candidateGroups: ready.length,
    created: createdClusterIds.length,
    createdClusterIds,
  };
}
