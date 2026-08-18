import { computeEvidenceCounts } from '../../domain/dedupe/cascade';
import { computeDecay, summariseFreshness } from '../../domain/decay/index';
import type { EvidenceClass } from '../../domain/taxonomy/evidence-class';
import type { SignalTypeKey } from '../../domain/taxonomy/signal-types';
import type { ScoringInput } from '../../domain/scoring/types';
import { computeCalibration } from '../../domain/calibration/index';
import { estimateBuildLeverage, matchCapabilities } from '../../domain/leverage/index';
import { readOwnedCapabilities } from '../intelligence/capability-profile';
import type { Repositories } from '../../ports/repositories/index';
import type { OpportunityRow } from '../../ports/repositories/opportunities';

/**
 * Assembles the frozen snapshot the scoring engine consumes.
 *
 * Everything here comes from stored evidence rather than from anybody's
 * judgement, so a score can be traced back to the rows that produced it. Fields
 * that nothing has established are left null on purpose: the engine treats an
 * unknown as an unknown, and filling in a plausible default here would quietly
 * destroy that distinction.
 */
/**
 * Context a caller can supply on top of what the evidence itself establishes:
 * capability coverage from the intelligence graph, competitor counts from an
 * investigation, and so on. Partial at every level, because a caller that knows
 * one field should not have to invent the rest.
 */
export type ScoringContext = {
  [K in
    | 'market'
    | 'internal'
    | 'economics'
    | 'uncertainty'
    | 'timing'
    | 'validation'
    | 'calibration']?: Partial<
    ScoringInput[K]
  >;
};

export async function buildScoringInput(
  repos: Repositories,
  workspaceId: string,
  opportunity: OpportunityRow,
  now: Date,
  context: ScoringContext = {},
): Promise<ScoringInput> {
  const attached = await repos.opportunities.evidenceFor(opportunity.id);
  const forIds = attached.filter((row) => row.stance === 'for').map((row) => row.evidenceUnitId);
  const againstIds = attached.filter((row) => row.stance === 'against').map((row) => row.evidenceUnitId);

  const [supporting, opposing] = await Promise.all([
    repos.evidence.listByIds(workspaceId, forIds),
    repos.evidence.listByIds(workspaceId, againstIds),
  ]);

  const [mentions, affiliations] = await Promise.all([
    repos.evidence.mentionsFor(forIds),
    repos.evidence.affiliations(workspaceId),
  ]);
  const counts = computeEvidenceCounts(mentions, affiliations);

  const strengthByType: Partial<Record<SignalTypeKey, number>> = {};
  const countByClass: Partial<Record<EvidenceClass, number>> = {};
  const decayResults: Array<ReturnType<typeof computeDecay> & { observedAt: Date }> = [];

  for (const unit of supporting) {
    const decay = computeDecay({
      signalType: unit.signalTypeKey,
      evidenceClass: unit.evidenceClass,
      observedAt: unit.lastSeenAt,
      now,
    });
    decayResults.push({ ...decay, observedAt: unit.lastSeenAt });

    strengthByType[unit.signalTypeKey] =
      (strengthByType[unit.signalTypeKey] ?? 0) + decay.effectiveStrength;
    countByClass[unit.evidenceClass] = (countByClass[unit.evidenceClass] ?? 0) + 1;
  }

  const counterStrength = opposing.reduce((sum, unit) => {
    const decay = computeDecay({
      signalType: unit.signalTypeKey,
      evidenceClass: unit.evidenceClass,
      observedAt: unit.lastSeenAt,
      now,
    });
    return sum + decay.effectiveStrength;
  }, 0);

  const freshness = summariseFreshness(decayResults);

  const calibration = computeCalibration(await repos.executionHistory.list(workspaceId, 500));

  const experiments = await repos.validation.listExperiments(workspaceId, {
    opportunityId: opportunity.id,
  });
  const concluded = experiments.filter((experiment) => experiment.verdict !== null);

  /*
   * Read from stored records rather than accepted from whoever called.
   *
   * These facts live in the investigation outputs, the uncertainty table and
   * the validation plan, so reading them here is what makes a score the same
   * number no matter which code path recomputed it. Passing them in as context
   * meant a rescore triggered by an experiment produced a different answer from
   * one triggered by the investigation runner, which is indefensible in a
   * system whose whole claim is that its numbers are checkable.
   */
  const outputs = await repos.investigations.outputsFor(workspaceId, 'opportunity', opportunity.id);
  const competitors = latestPayload(outputs, 'investigation.competitors');
  const unknowns = await repos.uncertainty.listFor(workspaceId, opportunity.id, { openOnly: true });
  const plan = await repos.validation.latestPlan(workspaceId, opportunity.id);

  // Leverage is recomputed from the live graph rather than stored, because the
  // answer legitimately changes when the team's capabilities do: shipping
  // something new should make related opportunities cheaper, and the score
  // should say so without anyone re-entering anything.
  const [requirements, owned] = await Promise.all([
    repos.opportunities.capabilityRequirements(opportunity.id),
    readOwnedCapabilities(repos, workspaceId),
  ]);
  const leverage = estimateBuildLeverage(
    matchCapabilities(
      requirements.map((requirement) => ({
        taxonomyKey: requirement.taxonomyKey,
        label: requirement.label,
        criticality: requirement.criticality,
      })),
      owned,
    ),
  );
  const resources = await repos.graph.listResources(workspaceId);
  const budget = resources.find((resource) => resource.resourceKind === 'budget');
  const time = resources.find((resource) => resource.resourceKind === 'time');

  // Prices come from the evidence itself, so "people pay about this much" is a
  // claim backed by specific rows rather than an estimate.
  const observedMonthlySpend = await collectObservedSpend(repos, workspaceId, forIds);

  return {
    opportunityId: opportunity.id,
    opportunityType: opportunity.typeKey,
    evidence: {
      rawMentions: counts.rawMentions,
      uniqueEvidence: counts.uniqueEvidence,
      independentSources: counts.independentSources,
      sourceDiversity: counts.sourceDiversity,
      aiDerivedMentions: counts.aiDerivedMentions,
      strengthByType,
      countByClass,
      freshness: freshness.freshness,
      counterEvidenceCount: opposing.length,
      counterEvidenceStrength: counterStrength,
    },
    market: {
      competitorCount: countOf(competitors?.competitors),
      freeAlternativeCount: countOf(competitors?.freeAlternatives),
      competitorWeaknessCount: Math.round(strengthByType.competitor_weakness ?? 0),
      observedMonthlySpend,
      momentum30d: null,
      ...context.market,
    },
    internal: {
      capabilityCoverage: requirements.length > 0 ? leverage.coverage : null,
      requiredCapabilityCount: leverage.requiredCount,
      missingCapabilityCount: leverage.missingCount,
      reusableAssetCount: leverage.reusableAssets.length,
      hasDistribution: null,
      hasDomainExperience: null,
      priorRelatedOutcomes: { successes: 0, failures: 0 },
      ...context.internal,
    },
    economics: {
      estimatedMvpDaysGreenfield: requirements.length > 0 ? leverage.greenfieldDays : null,
      estimatedMvpDaysLeveraged: requirements.length > 0 ? leverage.leveragedDays : null,
      estimatedValidationCost: plan?.estimatedCost ?? null,
      estimatedValidationDays: plan?.estimatedDays ?? null,
      availableBudget: budget ? Math.max(0, budget.amount - budget.committed) : null,
      availableDays: time ? Math.max(0, time.amount - time.committed) : null,
      ...context.economics,
    },
    uncertainty: {
      criticalUnknownCount: unknowns.filter((item) => item.kind === 'critical_unknown').length,
      resolvedUnknownCount: unknowns.filter((item) => item.status === 'resolved').length,
      assumptionCount: unknowns.filter((item) => item.kind === 'assumption').length,
      ...context.uncertainty,
    },
    timing: {
      technologyUnlockStrength: strengthByType.technology_unlock ?? 0,
      regulatoryDeadlineDays: null,
      competitorMoving: null,
      ...context.timing,
    },
    // Real-world results, kept apart from evidence collected by reading. An
    // experiment against real people is the strongest thing Radar can know.
    validation: {
      concludedExperiments: concluded.length,
      validatedCount: concluded.filter((experiment) => experiment.verdict === 'validated').length,
      partiallyValidatedCount: concluded.filter(
        (experiment) => experiment.verdict === 'partially_validated',
      ).length,
      inconclusiveCount: concluded.filter((experiment) => experiment.verdict === 'inconclusive').length,
      rejectedCount: concluded.filter((experiment) => experiment.verdict === 'rejected').length,
      ...context.validation,
    },

    // Read from this team's own completed work. Below the minimum sample the
    // domain refuses to produce a ratio at all, so an early workspace scores
    // with unadjusted estimates rather than a correction drawn from noise.
    calibration: {
      sampleSize: calibration.sampleSize,
      confidenceBias: calibration.confidenceBias,
      buildEstimateRatio: calibration.buildEstimateRatio,
      ...context.calibration,
    },
  };
}

async function collectObservedSpend(
  repos: Repositories,
  workspaceId: string,
  evidenceUnitIds: string[],
): Promise<number[]> {
  if (evidenceUnitIds.length === 0) return [];

  const units = await repos.evidence.listByIds(workspaceId, evidenceUnitIds);
  const representatives = units
    .map((unit) => unit.representativeSignalId)
    .filter((id): id is string => id !== null);

  const amounts: number[] = [];
  for (const signalId of representatives) {
    const signal = await repos.signals.findById(workspaceId, signalId);
    const monthly = signal?.monetaryEvidence?.monthlyAmount;
    if (typeof monthly === 'number' && monthly > 0) amounts.push(monthly);
  }
  return amounts;
}

/** The most recent output a role produced, or null if it never ran. */
function latestPayload(
  outputs: Array<{ schemaKey: string; payload: Record<string, unknown> }>,
  schemaKey: string,
): Record<string, unknown> | null {
  const matching = outputs.filter((output) => output.schemaKey === schemaKey);
  return matching.length > 0 ? (matching[matching.length - 1]!.payload ?? null) : null;
}

/** A count from a stored array, or null when the role that fills it never ran. */
function countOf(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}
