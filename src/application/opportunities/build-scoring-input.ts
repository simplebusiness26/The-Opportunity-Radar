import { computeEvidenceCounts } from '../../domain/dedupe/cascade';
import { computeDecay, summariseFreshness } from '../../domain/decay/index';
import type { EvidenceClass } from '../../domain/taxonomy/evidence-class';
import type { SignalTypeKey } from '../../domain/taxonomy/signal-types';
import type { ScoringInput } from '../../domain/scoring/types';
import { computeCalibration } from '../../domain/calibration/index';
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
  [K in 'market' | 'internal' | 'economics' | 'uncertainty' | 'timing' | 'calibration']?: Partial<
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
      competitorCount: null,
      freeAlternativeCount: null,
      competitorWeaknessCount: Math.round(strengthByType.competitor_weakness ?? 0),
      observedMonthlySpend,
      momentum30d: null,
      ...context.market,
    },
    internal: {
      capabilityCoverage: null,
      requiredCapabilityCount: 0,
      missingCapabilityCount: 0,
      reusableAssetCount: 0,
      hasDistribution: null,
      hasDomainExperience: null,
      priorRelatedOutcomes: { successes: 0, failures: 0 },
      ...context.internal,
    },
    economics: {
      estimatedMvpDaysGreenfield: null,
      estimatedMvpDaysLeveraged: null,
      estimatedValidationCost: null,
      estimatedValidationDays: null,
      availableBudget: null,
      availableDays: null,
      ...context.economics,
    },
    uncertainty: {
      criticalUnknownCount: 0,
      resolvedUnknownCount: 0,
      assumptionCount: 0,
      ...context.uncertainty,
    },
    timing: {
      technologyUnlockStrength: strengthByType.technology_unlock ?? 0,
      regulatoryDeadlineDays: null,
      competitorMoving: null,
      ...context.timing,
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
