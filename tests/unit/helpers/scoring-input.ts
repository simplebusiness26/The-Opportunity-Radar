import type { ScoringInput } from '../../../src/domain/scoring/types';

/** A neutral, mostly-unknown opportunity. Tests add only what they are about. */
export function scoringInput(over: Partial<ScoringInput> = {}): ScoringInput {
  return {
    opportunityId: over.opportunityId ?? 'opp-1',
    opportunityType: over.opportunityType ?? 'new_product',
    evidence: {
      rawMentions: 0,
      uniqueEvidence: 0,
      independentSources: 0,
      sourceDiversity: 0,
      aiDerivedMentions: 0,
      strengthByType: {},
      countByClass: {},
      freshness: 1,
      counterEvidenceCount: 0,
      counterEvidenceStrength: 0,
      ...over.evidence,
    },
    market: {
      competitorCount: null,
      freeAlternativeCount: null,
      competitorWeaknessCount: 0,
      observedMonthlySpend: [],
      momentum30d: null,
      ...over.market,
    },
    internal: {
      capabilityCoverage: null,
      requiredCapabilityCount: 0,
      missingCapabilityCount: 0,
      reusableAssetCount: 0,
      hasDistribution: null,
      hasDomainExperience: null,
      priorRelatedOutcomes: { successes: 0, failures: 0 },
      ...over.internal,
    },
    economics: {
      estimatedMvpDaysGreenfield: null,
      estimatedMvpDaysLeveraged: null,
      estimatedValidationCost: null,
      estimatedValidationDays: null,
      availableBudget: null,
      availableDays: null,
      ...over.economics,
    },
    uncertainty: {
      criticalUnknownCount: 0,
      resolvedUnknownCount: 0,
      assumptionCount: 0,
      ...over.uncertainty,
    },
    timing: {
      technologyUnlockStrength: 0,
      regulatoryDeadlineDays: null,
      competitorMoving: null,
      ...over.timing,
    },
    validation: {
      concludedExperiments: 0,
      validatedCount: 0,
      partiallyValidatedCount: 0,
      inconclusiveCount: 0,
      rejectedCount: 0,
      ...over.validation,
    },
    calibration: {
      sampleSize: 0,
      confidenceBias: null,
      buildEstimateRatio: null,
      ...over.calibration,
    },
  };
}
