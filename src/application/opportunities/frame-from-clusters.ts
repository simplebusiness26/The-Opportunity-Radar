import { DEFAULT_CLUSTERING } from '../../domain/clustering/index';
import type { ActorCtx } from '../../domain/types/identity';
import type { LifecycleDeps } from './lifecycle';
import { createOpportunity } from './lifecycle';

export interface FrameOpportunitiesResult {
  considered: number;
  ready: number;
  created: number;
  createdOpportunityIds: string[];
}

/**
 * Turns evidence-backed problem clusters into provisional opportunity theses.
 *
 * This is intentionally conservative and intentionally non-decisive. A system
 * actor may frame a hypothesis, but the opportunity still begins at `detected`
 * and cannot enter execution without the normal owner-only decision gate.
 *
 * The opportunity type is provisionally `new_product` because no AI classifier
 * is required for this path. The thesis explicitly records that the type is a
 * placeholder to revisit during investigation; Radar must not pretend that a
 * lexical problem cluster can distinguish productisation, service, feature,
 * partnership, etc. by itself.
 */
export async function frameOpportunitiesFromReadyClusters(
  deps: LifecycleDeps,
  ctx: ActorCtx,
  options: { limit?: number; maxOpportunities?: number } = {},
): Promise<FrameOpportunitiesResult> {
  const [clusters, existing] = await Promise.all([
    deps.repos.clusters.list(ctx.workspaceId, {
      status: ['new', 'watching', 'investigating'],
      includeDemo: false,
      limit: options.limit ?? 100,
    }),
    deps.repos.opportunities.list(ctx.workspaceId, { includeDemo: false, limit: 250 }),
  ]);

  const clustersWithOpportunity = new Set(
    existing.map((opportunity) => opportunity.clusterId).filter((value): value is string => Boolean(value)),
  );

  const ready = clusters
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
    )
    .slice(0, options.maxOpportunities ?? 5);

  const createdOpportunityIds: string[] = [];

  for (const cluster of ready) {
    const evidenceUnitIds = (await deps.repos.clusters.memberEvidenceIds(cluster.id)).slice(0, 200);
    const audience = cluster.targetCustomer ? ` for ${cluster.targetCustomer}` : '';
    const opportunity = await createOpportunity(deps, ctx, {
      title: cluster.title,
      thesis:
        `There may be a commercially useful opportunity to address this recurring problem${audience}: ` +
        `${cluster.problemStatement} Radar framed this hypothesis automatically from ` +
        `${cluster.uniqueEvidenceCount} distinct evidence unit(s) across ` +
        `${cluster.independentSourceCount} independent source(s). The solution form is provisional ` +
        `and must be validated before execution.`,
      typeKey: 'new_product',
      clusterId: cluster.id,
      targetCustomer: cluster.targetCustomer,
      problemStatement: cluster.problemStatement,
      whyNow:
        `The problem cluster currently has ${cluster.uniqueEvidenceCount} distinct evidence unit(s), ` +
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
            version: 1,
            provisionalType: true,
            sourceClusterId: cluster.id,
            uniqueEvidenceCount: cluster.uniqueEvidenceCount,
            independentSourceCount: cluster.independentSourceCount,
            clusterConfidence: cluster.confidence,
          },
        },
      },
      deps.clock.now(),
    );
    await deps.repos.clusters.setStatus(cluster.id, 'promoted');
    createdOpportunityIds.push(opportunity.id);
  }

  return {
    considered: clusters.length,
    ready: ready.length,
    created: createdOpportunityIds.length,
    createdOpportunityIds,
  };
}
