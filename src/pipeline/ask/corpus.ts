import type { RetrievableRecord } from '../../domain/ask/retrieval';
import { OPPORTUNITY_STATES } from '../../domain/state/opportunity-state';
import type { Repositories } from '../../ports/repositories/index';

/**
 * Everything Ask Radar is allowed to see.
 *
 * The whole corpus is this workspace's own records. There is no external
 * retrieval, no general knowledge, and no route by which a question can be
 * answered from anything except what has been recorded here -- which is what
 * makes "cite the record or say you cannot" enforceable rather than aspirational.
 */

export interface CorpusOptions {
  /** Caps the size sent for ranking. Ordering is by recency within each kind. */
  perKindLimit?: number;
  includeDemo?: boolean;
}

export async function buildCorpus(
  repos: Repositories,
  workspaceId: string,
  options: CorpusOptions = {},
): Promise<RetrievableRecord[]> {
  const limit = options.perKindLimit ?? 200;
  const records: RetrievableRecord[] = [];

  const opportunities = await repos.opportunities.list(workspaceId, {
    limit,
    includeDemo: options.includeDemo ?? true,
  });

  for (const opportunity of opportunities) {
    records.push({
      id: `opportunity:${opportunity.id}`,
      kind: 'opportunity',
      title: `#${opportunity.reference} ${opportunity.title}`,
      text: [
        `State: ${OPPORTUNITY_STATES[opportunity.state]?.label ?? opportunity.state}`,
        opportunity.thesis,
        opportunity.problemStatement ?? '',
        opportunity.targetCustomer ? `Customer: ${opportunity.targetCustomer}` : '',
        opportunity.whyNow ? `Why now: ${opportunity.whyNow}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      href: `/opportunities/${opportunity.id}`,
      occurredAt: opportunity.updatedAt,
      // An opportunity is a thesis we hold, not evidence about the world.
      isEvidence: false,
    });
  }

  const clusters = await repos.clusters.list(workspaceId, { limit, includeDemo: true });
  for (const cluster of clusters) {
    records.push({
      id: `cluster:${cluster.id}`,
      kind: 'cluster',
      title: cluster.title,
      text: [
        cluster.problemStatement,
        cluster.targetCustomer ? `Customer: ${cluster.targetCustomer}` : '',
        `${cluster.rawMentions} mentions, ${cluster.uniqueEvidenceCount} unique evidence, ${cluster.independentSourceCount} independent sources.`,
      ]
        .filter(Boolean)
        .join('\n'),
      href: `/clusters/${cluster.id}`,
      occurredAt: cluster.lastEvidenceAt,
      isEvidence: false,
    });
  }

  const evidence = await repos.evidence.listClusterable(workspaceId, { limit });
  for (const unit of evidence) {
    records.push({
      id: `evidence:${unit.id}`,
      kind: 'evidence',
      title: unit.claimText,
      text: [
        unit.claimText,
        unit.bodyText.slice(0, 2_000),
        `Evidence class: ${unit.evidenceClass}. Signal type: ${unit.signalTypeKey}. ${unit.mentionCount} mention(s).`,
      ].join('\n'),
      href: '/signals',
      occurredAt: unit.lastSeenAt,
      isEvidence: true,
    });
  }

  for (const opportunity of opportunities) {
    const outputs = await repos.investigations.outputsFor(workspaceId, 'opportunity', opportunity.id);
    for (const output of outputs) {
      records.push({
        id: `investigation:${output.id}`,
        kind: 'investigation',
        title: `${output.schemaKey.replace('investigation.', '')} findings on ${opportunity.title}`,
        text: JSON.stringify(output.payload).slice(0, 3_000),
        href: `/opportunities/${opportunity.id}`,
        occurredAt: output.createdAt,
        // Derived from evidence rather than being evidence, and marked so, or
        // the system would be able to corroborate itself.
        isEvidence: false,
      });
    }
  }

  const decisions = await repos.decisions.list(workspaceId, limit);
  for (const decision of decisions) {
    records.push({
      id: `decision:${decision.subjectId ?? 'none'}:${decision.createdAt.toISOString()}`,
      kind: 'decision',
      title: `Decision: ${decision.decision}`,
      text: [
        decision.rationale,
        decision.radarRecommendation ? `Radar recommended: ${decision.radarRecommendation}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      href: decision.subjectId ? `/opportunities/${decision.subjectId}` : '/decisions',
      occurredAt: decision.createdAt,
      isEvidence: false,
    });
  }

  const experiments = await repos.validation.listExperiments(workspaceId, { limit });
  for (const experiment of experiments) {
    records.push({
      id: `experiment:${experiment.id}`,
      kind: 'experiment',
      title: experiment.name,
      text: [
        `State: ${experiment.state}.`,
        experiment.verdict ? `Verdict: ${experiment.verdict}.` : 'No verdict yet.',
        experiment.conclusion ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
      href: `/opportunities/${experiment.opportunityId}`,
      occurredAt: experiment.stateSince,
      // An experiment's result is real-world evidence, and the strongest kind.
      isEvidence: experiment.verdict !== null,
    });
  }

  const history = await repos.executionHistory.list(workspaceId, limit);
  for (const entry of history) {
    records.push({
      id: `execution:${entry.id}`,
      kind: 'execution',
      title: `Outcome: ${entry.outcome.replace(/_/g, ' ')}`,
      text: [
        entry.reason ?? '',
        entry.notes ?? '',
        entry.predictedBuildDays !== null && entry.actualBuildDays !== null
          ? `Predicted ${entry.predictedBuildDays} days, took ${entry.actualBuildDays}.`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      href: '/intelligence',
      occurredAt: entry.recordedAt,
      isEvidence: true,
    });
  }

  const capabilities = await repos.graph.listCapabilities(workspaceId);
  for (const capability of capabilities) {
    records.push({
      id: `capability:${capability.nodeId}`,
      kind: 'capability',
      title: capability.name,
      text: [
        `Maturity: ${capability.maturity}.`,
        capability.assetNames.length > 0 ? `Provided by: ${capability.assetNames.join(', ')}.` : '',
        capability.notes ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
      href: '/intelligence',
      occurredAt: capability.lastVerifiedAt,
      isEvidence: false,
    });
  }

  const assets = await repos.graph.listAssets(workspaceId);
  for (const asset of assets) {
    records.push({
      id: `asset:${asset.nodeId}`,
      kind: 'asset',
      title: asset.name,
      text: [
        `${asset.assetKind}, reuse readiness ${asset.reuseReadiness}.`,
        asset.licence ? `Licence: ${asset.licence}.` : '',
        asset.location ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
      href: '/intelligence',
      occurredAt: asset.lastChangeAt,
      isEvidence: false,
    });
  }

  return records;
}
