import type { EvidenceClass } from '../taxonomy/evidence-class';
import type { OpportunityTypeKey } from '../taxonomy/opportunity-types';
import type { SignalTypeKey } from '../taxonomy/signal-types';

/**
 * Everything scoring is allowed to see. Freezing it into a snapshot means a
 * score can be recomputed identically later, and any change in the result is
 * provably a change in the inputs rather than in the weather.
 */
export interface ScoringInput {
  opportunityId: string;
  opportunityType: OpportunityTypeKey;

  evidence: {
    rawMentions: number;
    uniqueEvidence: number;
    independentSources: number;
    sourceDiversity: number;
    aiDerivedMentions: number;
    /** Effective strength after decay, summed by signal type. */
    strengthByType: Partial<Record<SignalTypeKey, number>>;
    /** Count of unique evidence by class. */
    countByClass: Partial<Record<EvidenceClass, number>>;
    freshness: number;
    /** Evidence explicitly recorded as arguing against the thesis. */
    counterEvidenceCount: number;
    counterEvidenceStrength: number;
  };

  market: {
    /** Named alternatives customers already use, including free ones. */
    competitorCount: number | null;
    freeAlternativeCount: number | null;
    /** Recorded complaints about existing solutions. */
    competitorWeaknessCount: number;
    /** Observed prices being paid, in the workspace currency. */
    observedMonthlySpend: number[];
    momentum30d: number | null;
  };

  internal: {
    /** Fraction of required capabilities we already have, 0-1. */
    capabilityCoverage: number | null;
    requiredCapabilityCount: number;
    missingCapabilityCount: number;
    reusableAssetCount: number;
    /** Whether we can already reach these customers. */
    hasDistribution: boolean | null;
    hasDomainExperience: boolean | null;
    priorRelatedOutcomes: { successes: number; failures: number };
  };

  economics: {
    estimatedMvpDaysGreenfield: [number, number] | null;
    estimatedMvpDaysLeveraged: [number, number] | null;
    estimatedValidationCost: number | null;
    estimatedValidationDays: number | null;
    availableBudget: number | null;
    availableDays: number | null;
  };

  uncertainty: {
    criticalUnknownCount: number;
    resolvedUnknownCount: number;
    assumptionCount: number;
  };

  timing: {
    technologyUnlockStrength: number;
    regulatoryDeadlineDays: number | null;
    /** Whether a competitor is visibly moving on the same problem. */
    competitorMoving: boolean | null;
  };

  /**
   * What happened when the thesis met real people.
   *
   * Separate from evidence collected by reading, because an experiment result
   * is the strongest thing this system can know and must not be averaged in
   * with forum posts.
   */
  validation: {
    concludedExperiments: number;
    validatedCount: number;
    partiallyValidatedCount: number;
    inconclusiveCount: number;
    rejectedCount: number;
  };

  /** Calibration from real outcomes. Absent until enough history exists. */
  calibration: {
    sampleSize: number;
    confidenceBias: number | null;
    buildEstimateRatio: number | null;
  };
}

export type DimensionStatus = 'ok' | 'insufficient_evidence' | 'not_applicable';

export interface DimensionFactor {
  key: string;
  label: string;
  rawValue: number | string | null;
  note?: string;
}

export interface DimensionResult {
  status: DimensionStatus;
  /** Raw measurement in its own units, before normalisation. */
  raw: number | null;
  /** Normalised to 0-1. Null when the dimension could not be computed. */
  normalised: number | null;
  factors: DimensionFactor[];
  /** One sentence a person can check against the evidence. */
  explanation: string;
}

export type CompositeKey =
  | 'attractiveness'
  | 'fit'
  | 'confidence'
  | 'leverage'
  | 'timing'
  | 'validation_efficiency'
  | 'strategic_value'
  | 'execution_risk';

export interface DimensionDefinition {
  key: string;
  label: string;
  composite: CompositeKey;
  description: string;
  /** Whether a higher normalised value is better for the opportunity. */
  direction: 'higher_is_better' | 'lower_is_better';
  defaultWeight: number;
  compute(input: ScoringInput): DimensionResult;
}
