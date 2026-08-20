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
import { tokenize } from '../../domain/dedupe/fingerprint';
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
  available: number;
  batch: number;
  batches: number;
  candidateGroups: number;
  created: number;
  createdClusterIds: string[];
}

const BLOCKING_STOPWORDS = new Set([
  'about',
  'after',
  'also',
  'been',
  'being',
  'build',
  'business',
  'company',
  'could',
  'from',
  'have',
  'into',
  'just',
  'looking',
  'more',
  'need',
  'people',
  'should',
  'software',
  'some',
  'system',
  'than',
  'that',
  'their',
  'there',
  'these',
  'they',
  'this',
  'tool',
  'tools',
  'using',
  'users',
  'want',
  'what',
  'when',
  'where',
  'which',
  'with',
  'would',
]);

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

/**
 * Cheap blocking before the expensive similarity calculation.
 *
 * lexical-v1 already requires token overlap before trusting its vector, so
 * comparing an item against groups with no meaningful shared token cannot
 * produce a valid lexical match. Entity keys are included because they can
 * independently justify a cluster join.
 */
function blockingKeys(evidence: ClusterableEvidence): string[] {
  const keys = new Set<string>();

  for (const entity of evidence.entityKeys) {
    if (entity) keys.add(`entity:${entity}`);
  }

  for (const token of tokenize(evidence.matchText)) {
    if (token.length < 4 || BLOCKING_STOPWORDS.has(token) || /^\d+$/.test(token)) continue;
    keys.add(`token:${token}`);
    if (keys.size >= 48) break;
  }

  return [...keys];
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
 *
 * Serverless runs inspect one rotating batch at a time. The larger read is
 * cheap and lets batches rotate across the whole loose-evidence pool; the
 * expensive similarity work stays bounded. Once any batch creates a real
 * cluster, the normal assignment job can absorb matching evidence from later
 * batches into it.
 */
export async function seedProblemClusters(
  deps: ClusterDeps,
  ctx: ActorCtx,
  options: {
    limit?: number;
    batchSize?: number;
    batchIndex?: number;
    maxClusters?: number;
    thresholds?: ClusteringThresholds;
  } = {},
): Promise<SeedProblemClustersResult> {
  const thresholds = options.thresholds ?? deps.thresholds ?? DEFAULT_CLUSTERING;
  const allRows = await deps.repos.evidence.listClusterable(ctx.workspaceId, {
    unclusteredOnly: true,
    limit: options.limit ?? 1000,
  });

  if (allRows.length === 0) {
    return {
      considered: 0,
      available: 0,
      batch: 0,
      batches: 0,
      candidateGroups: 0,
      created: 0,
      createdClusterIds: [],
    };
  }

  const batchSize = Math.min(Math.max(1, options.batchSize ?? allRows.length), allRows.length);
  const batches = Math.max(1, Math.ceil(allRows.length / batchSize));
  const requestedBatch = Math.max(0, Math.floor(options.batchIndex ?? 0));
  const batch = requestedBatch % batches;
  const start = batch * batchSize;
  const rows = allRows.slice(start, start + batchSize);

  const ordered = rows
    .map((row) => ({ row, evidence: toDomain(row) }))
    .sort(
      (a, b) =>
        b.evidence.strength - a.evidence.strength ||
        b.evidence.lastSeenAt.getTime() - a.evidence.lastSeenAt.getTime(),
    );

  const groups: SeedGroup[] = [];
  const groupIndexByKey = new Map<string, number>();
  const blockIndex = new Map<string, Set<number>>();

  const indexMember = (groupIndex: number, member: SeedMember): void => {
    for (const key of blockingKeys(member.evidence)) {
      const indexes = blockIndex.get(key) ?? new Set<number>();
      indexes.add(groupIndex);
      blockIndex.set(key, indexes);
    }
  };

  for (const member of ordered) {
    const candidateIndexes = new Set<number>();
    for (const key of blockingKeys(member.evidence)) {
      for (const groupIndex of blockIndex.get(key) ?? []) candidateIndexes.add(groupIndex);
    }

    const candidateCentroids = [...candidateIndexes]
      .map((groupIndex) => groups[groupIndex])
      .filter((group): group is SeedGroup => Boolean(group))
      .map(asCentroid);
    const match = candidateCentroids.length
      ? findCluster(member.evidence, candidateCentroids, thresholds)
      : null;

    if (match) {
      const groupIndex = groupIndexByKey.get(match.clusterId);
      const group = groupIndex === undefined ? undefined : groups[groupIndex];
      if (group && groupIndex !== undefined) {
        group.members.push(member);
        indexMember(groupIndex, member);
        continue;
      }
    }

    const key = `seed:${member.evidence.id}`;
    const groupIndex = groups.length;
    groups.push({ key, representative: member, members: [member] });
    groupIndexByKey.set(key, groupIndex);
    indexMember(groupIndex, member);
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
    .slice(0, options.maxClusters ?? 6);

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
    available: allRows.length,
    batch,
    batches,
    candidateGroups: ready.length,
    created: createdClusterIds.length,
    createdClusterIds,
  };
}
