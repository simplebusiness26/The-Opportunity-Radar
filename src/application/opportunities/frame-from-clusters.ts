import { DEFAULT_CLUSTERING } from '../../domain/clustering/index';
import {
  describeCommercialOpening,
  qualifyCommercialOpportunity,
  type CommercialQualification,
} from '../../domain/opportunities/automatic-framing-safety';
import type { ActorCtx } from '../../domain/types/identity';
import type { ClusterRow, OpportunityRow } from '../../ports/repositories/opportunities';
import type { LifecycleDeps } from './lifecycle';
import { createOpportunity } from './lifecycle';

export interface FrameOpportunitiesResult {
  considered: number;
  ready: number;
  commerciallyQualified: number;
  blocked: number;
  created: number;
  createdOpportunityIds: string[];
  requalifiedExisting: number;
  disqualifiedExisting: number;
}

interface QualifiedCluster {
  cluster: ClusterRow;
  evidenceUnitIds: string[];
  qualification: CommercialQualification;
  opening: string;
}

async function qualifyCluster(
  deps: LifecycleDeps,
  ctx: ActorCtx,
  cluster: ClusterRow,
): Promise<QualifiedCluster> {
  const evidenceUnitIds = (await deps.repos.clusters.memberEvidenceIds(cluster.id)).slice(0, 200);
  const evidence = evidenceUnitIds.length
    ? await deps.repos.evidence.listClusterable(ctx.workspaceId, { evidenceUnitIds })
    : [];
  const qualification = qualifyCommercialOpportunity(evidence);
  const opening = describeCommercialOpening(cluster.problemStatement, qualification.strongestSignalType);
  return { cluster, evidenceUnitIds, qualification, opening };
}

function qualificationNote(qualified: QualifiedCluster, evaluatedAt: Date): Record<string, unknown> {
  return {
    version: 1,
    eligible: qualified.qualification.eligible,
    reason: qualified.qualification.reason,
    problemProofCount: qualified.qualification.problemProofCount,
    commercialProofCount: qualified.qualification.commercialProofCount,
    economicProofCount: qualified.qualification.economicProofCount,
    independentOrigins: qualified.qualification.independentOrigins,
    strongestSignalType: qualified.qualification.strongestSignalType,
    specificOpening: qualified.opening,
    evaluatedAt: evaluatedAt.toISOString(),
  };
}

async function saveQualification(
  deps: LifecycleDeps,
  ctx: ActorCtx,
  opportunity: OpportunityRow,
  qualified: QualifiedCluster,
): Promise<void> {
  await deps.repos.opportunities.update(
    ctx.workspaceId,
    opportunity.id,
    {
      notes: {
        ...opportunity.notes,
        commercialQualification: qualificationNote(qualified, deps.clock.now()),
      },
    },
    deps.clock.now(),
  );
}

/**
 * Turns evidence-backed problem clusters into provisional commercial
 * opportunities.
 *
 * Repetition alone is not enough. The problem must be independently
 * corroborated and at least one member must show a commercial mechanism such
 * as active demand, spending, a workaround, paid labour, a supply gap or a weak
 * incumbent. Product launches and trend chatter remain Signals; repeated pain
 * without commercial behaviour remains a Problem.
 */
export async function frameOpportunitiesFromReadyClusters(
  deps: LifecycleDeps,
  ctx: ActorCtx,
  options: { limit?: number; maxOpportunities?: number; requalifyLimit?: number } = {},
): Promise<FrameOpportunitiesResult> {
  const [clusters, existing] = await Promise.all([
    deps.repos.clusters.list(ctx.workspaceId, {
      status: ['new', 'watching', 'investigating'],
      includeDemo: false,
      limit: options.limit ?? 100,
    }),
    deps.repos.opportunities.list(ctx.workspaceId, { includeDemo: false, limit: 250 }),
  ]);

  // Existing auto-framed rows are non-destructively re-evaluated. The UI hides
  // them until this note says `eligible: true`, so legacy false positives stop
  // polluting the opportunity feed without throwing away their source data.
  let requalifiedExisting = 0;
  let disqualifiedExisting = 0;
  const legacy = existing
    .filter((opportunity) => opportunity.createdBy === 'auto' && Boolean(opportunity.clusterId))
    .slice(0, options.requalifyLimit ?? 50);

  for (const opportunity of legacy) {
    const cluster = opportunity.clusterId
      ? await deps.repos.clusters.findById(ctx.workspaceId, opportunity.clusterId)
      : null;
    if (!cluster) continue;
    const qualified = await qualifyCluster(deps, ctx, cluster);
    await saveQualification(deps, ctx, opportunity, qualified);
    requalifiedExisting += 1;
    if (!qualified.qualification.eligible) disqualifiedExisting += 1;
  }

  const clustersWithOpportunity = new Set(
    existing
      .map((opportunity) => opportunity.clusterId)
      .filter((value): value is string => Boolean(value)),
  );

  const candidates = clusters
    .filter(
      (cluster) =>
        !clustersWithOpportunity.has(cluster.id) &&
        cluster.uniqueEvidenceCount >= DEFAULT_CLUSTERING.minUniqueEvidence &&
        cluster.independentSourceCount >= DEFAULT_CLUSTERING.minIndependentSources,
    )
    .sort(
      (a, b) =>
        b.confidence - a.confidence ||
        b.independentSourceCount - a.independentSourceCount ||
        b.uniqueEvidenceCount - a.uniqueEvidenceCount ||
        b.lastEvidenceAt.getTime() - a.lastEvidenceAt.getTime(),
    );

  const qualifiedClusters: QualifiedCluster[] = [];
  let blocked = 0;
  for (const cluster of candidates) {
    const qualified = await qualifyCluster(deps, ctx, cluster);
    if (!qualified.qualification.eligible) {
      blocked += 1;
      continue;
    }
    qualifiedClusters.push(qualified);
    if (qualifiedClusters.length >= (options.maxOpportunities ?? 5)) break;
  }

  const createdOpportunityIds: string[] = [];

  for (const qualified of qualifiedClusters) {
    const { cluster, evidenceUnitIds, qualification, opening } = qualified;
    const audience = cluster.targetCustomer ? ` for ${cluster.targetCustomer}` : '';
    const opportunity = await createOpportunity(deps, ctx, {
      title: cluster.title,
      thesis:
        `${opening}${audience}. ` +
        `This was promoted because ${qualification.problemProofCount} problem evidence unit(s) ` +
        `from ${qualification.independentOrigins} independent origin(s) include ` +
        `${qualification.commercialProofCount} concrete commercial signal(s).`,
      typeKey: 'new_product',
      clusterId: cluster.id,
      targetCustomer: cluster.targetCustomer,
      problemStatement: cluster.problemStatement,
      whyNow:
        `${qualification.reason} The cluster has ${cluster.uniqueEvidenceCount} distinct evidence unit(s), ` +
        `${cluster.independentSourceCount} independent source(s), and ` +
        `${Math.round(cluster.confidence * 100)}% pattern confidence.`,
      evidenceUnitIds,
    });

    await deps.repos.opportunities.update(
      ctx.workspaceId,
      opportunity.id,
      {
        notes: {
          ...opportunity.notes,
          autoFraming: {
            version: 2,
            provisionalType: true,
            sourceClusterId: cluster.id,
            uniqueEvidenceCount: cluster.uniqueEvidenceCount,
            independentSourceCount: cluster.independentSourceCount,
            clusterConfidence: cluster.confidence,
          },
          commercialQualification: qualificationNote(qualified, deps.clock.now()),
        },
      },
      deps.clock.now(),
    );
    await deps.repos.clusters.setStatus(cluster.id, 'promoted');
    createdOpportunityIds.push(opportunity.id);
  }

  return {
    considered: clusters.length,
    ready: candidates.length,
    commerciallyQualified: qualifiedClusters.length,
    blocked,
    created: createdOpportunityIds.length,
    createdOpportunityIds,
    requalifiedExisting,
    disqualifiedExisting,
  };
}
