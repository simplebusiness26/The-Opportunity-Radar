/**
 * Resource allocation: what deserves the next unit of effort.
 *
 * This is the question the product exists to answer, and it is not the same as
 * "which opportunity scores highest". Validating a strong idea, productising a
 * component that already exists, and improving a product that already has
 * customers all compete for the same week — and the answer is frequently that
 * none of them is worth starting, which this engine is able to say.
 *
 * Deterministic by construction. AI may later describe the result, but it never
 * produces the ordering.
 */

export type CandidateKind =
  | 'validate'
  | 'build'
  | 'improve_existing'
  | 'productise'
  | 'distribute'
  | 'acquire_capability'
  | 'reduce_cost'
  | 'wait';

export type CapitalRequirementCategory =
  | 'validation'
  | 'infrastructure'
  | 'data'
  | 'distribution'
  | 'compliance'
  | 'inventory'
  | 'contractor'
  | 'software'
  | 'other';

export interface CapitalRequirement {
  category: CapitalRequirementCategory;
  label: string;
  amount: number;
  note?: string | null;
  evidenceRefs?: string[];
}

export interface AllocationCandidate {
  id: string;
  subjectType: 'opportunity' | 'experiment' | 'project' | 'capability';
  subjectId: string | null;
  kind: CandidateKind;
  title: string;
  /** 0-100 how good this looks in itself. */
  attractiveness: number;
  /** 0-100 how well it suits this team. */
  fit: number;
  /** 0-1 how sure we are of the above. */
  confidence: number;
  /** Effort, in days. */
  costDays: number;
  /** Cash required in the workspace currency. */
  costMoney: number;
  /**
   * `false` means the cash requirement has not been evidenced yet. Undefined
   * preserves backwards compatibility for older deterministic candidates, where
   * costMoney is already an explicit input.
   */
  capitalCostKnown?: boolean;
  /** Evidence-backed explanation of what the cash would be spent on. */
  capitalRequirements?: CapitalRequirement[];
  /** 0-1 how much it advances the stated goal. */
  goalAlignment: number | null;
  /** 0-1 chance of getting stuck. */
  executionRisk: number;
  /**
   * 0-1 how much is learned regardless of the outcome. Cheap experiments score
   * highly here even when the thesis is weak, which is what stops the engine
   * always recommending the biggest idea.
   */
  learningValue: number;
  /** What must be done first, if anything. */
  dependsOn?: string[];
}

export interface AvailableResources {
  days: number | null;
  money: number | null;
}

export interface RankedCandidate extends AllocationCandidate {
  /** Expected value per day of effort. */
  expectedReturn: number;
  affordable: boolean;
  rank: number;
  rationale: string;
  blockedBy: string[];
}

export interface AllocationResult {
  horizonDays: number;
  resources: AvailableResources;
  ranked: RankedCandidate[];
  /** The single recommendation, or null when none is warranted. */
  recommendation: RankedCandidate | null;
  /** Why nothing is recommended, when nothing is. */
  noActionReason: string | null;
  /** Things explicitly not worth doing yet, and why. */
  notYet: Array<{ title: string; reason: string }>;
  explanation: string;
}

/**
 * Confidence enters as a multiplier rather than as a component of the score.
 *
 * A thesis scoring 95 that we are 20% sure of is worth less than one scoring 70
 * we are 80% sure of, and multiplying is what encodes that. Averaging them
 * would let a spectacular guess outrank a solid fact.
 */
export function expectedValue(candidate: AllocationCandidate): number {
  const merit = 0.5 * candidate.attractiveness + 0.5 * candidate.fit;
  const goal = candidate.goalAlignment ?? 0.5;

  // Learning is banked whatever happens, so it is not discounted by confidence.
  const contingent = merit * candidate.confidence * (1 - 0.4 * candidate.executionRisk);
  const guaranteed = 100 * candidate.learningValue * 0.35;

  return (0.75 + 0.5 * goal) * (contingent + guaranteed);
}

/** Value per day. A cheap test that resolves a big unknown beats a big build. */
export function returnPerDay(candidate: AllocationCandidate): number {
  return expectedValue(candidate) / Math.max(0.5, candidate.costDays);
}

export interface AllocationPolicy {
  /** Below this expected return per day, doing nothing is better. */
  minimumReturnPerDay: number;
  /** Below this confidence, building is refused however attractive it looks. */
  minimumConfidenceToBuild: number;
}

export const DEFAULT_POLICY: AllocationPolicy = {
  minimumReturnPerDay: 4,
  minimumConfidenceToBuild: 0.5,
};

/**
 * Ranks competing uses of the next stretch of effort.
 *
 * Returning no recommendation is a legitimate and common outcome: with weak
 * evidence, the correct advice is to gather more, not to pick the least bad
 * option from a bad list.
 */
export function allocate(
  candidates: readonly AllocationCandidate[],
  resources: AvailableResources,
  horizonDays: number,
  policy: AllocationPolicy = DEFAULT_POLICY,
): AllocationResult {
  const completed = new Set<string>();

  const ranked: RankedCandidate[] = candidates
    .map((candidate) => {
      const affordableByTime =
        resources.days === null || candidate.costDays <= Math.min(resources.days, horizonDays);
      const capitalKnown = candidate.capitalCostKnown !== false;
      // If the user has stated a finite budget, an unknown cash requirement is
      // not allowed to masquerade as £0. With no budget recorded yet we preserve
      // the old behaviour so onboarding can still inspect the candidate list.
      const affordableByMoney =
        resources.money === null || (capitalKnown && candidate.costMoney <= resources.money);
      const blockedBy = (candidate.dependsOn ?? []).filter((id) => !completed.has(id));

      return {
        ...candidate,
        expectedReturn: returnPerDay(candidate),
        affordable: affordableByTime && affordableByMoney,
        rank: 0,
        blockedBy,
        rationale: '',
      };
    })
    .sort((a, b) => b.expectedReturn - a.expectedReturn)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  for (const candidate of ranked) {
    candidate.rationale = explainCandidate(candidate, resources, horizonDays, policy);
  }

  const eligible = ranked.filter(
    (candidate) =>
      candidate.affordable &&
      candidate.blockedBy.length === 0 &&
      candidate.expectedReturn >= policy.minimumReturnPerDay &&
      // Building on thin evidence is the specific mistake this product exists to
      // prevent, so it is refused rather than merely ranked low.
      !(candidate.kind === 'build' && candidate.confidence < policy.minimumConfidenceToBuild),
  );

  const recommendation = eligible[0] ?? null;

  const notYet = ranked
    .filter((candidate) => candidate !== recommendation)
    .filter(
      (candidate) =>
        candidate.kind === 'build' && candidate.confidence < policy.minimumConfidenceToBuild,
    )
    .map((candidate) => ({
      title: candidate.title,
      reason: `Confidence is ${Math.round(candidate.confidence * 100)}%. Reduce the uncertainty before building anything.`,
    }));

  return {
    horizonDays,
    resources,
    ranked,
    recommendation,
    noActionReason: recommendation ? null : noActionReason(ranked, resources, policy),
    notYet,
    explanation: explainAllocation(recommendation, ranked, horizonDays),
  };
}

function noActionReason(
  ranked: readonly RankedCandidate[],
  resources: AvailableResources,
  policy: AllocationPolicy,
): string {
  if (ranked.length === 0) {
    return 'Nothing has been scored yet, so there is nothing to compare.';
  }

  if (
    resources.money !== null &&
    ranked.some((candidate) => candidate.capitalCostKnown === false) &&
    ranked.every((candidate) => !candidate.affordable)
  ) {
    return 'The cash requirement for the strongest options is not evidenced yet. Research the capital plan before treating them as affordable or unaffordable.';
  }

  const unaffordable = ranked.filter((candidate) => !candidate.affordable);
  if (unaffordable.length === ranked.length) {
    return `Everything on the list costs more than the ${resources.days ?? 0} days or ${resources.money ?? 0} available.`;
  }

  const thin = ranked.filter(
    (candidate) => candidate.kind === 'build' && candidate.confidence < policy.minimumConfidenceToBuild,
  );
  if (thin.length > 0) {
    return 'NO HIGH-CONFIDENCE OPPORTUNITY CURRENTLY WARRANTS ACTION. The strongest candidates rest on evidence too thin to build against — the useful next move is to gather evidence, not to start.';
  }

  return 'Nothing clears the threshold where acting beats waiting. Continue monitoring.';
}

function explainCandidate(
  candidate: RankedCandidate,
  resources: AvailableResources,
  horizonDays: number,
  policy: AllocationPolicy,
): string {
  if (resources.money !== null && candidate.capitalCostKnown === false) {
    return `Needs about ${candidate.costDays} day(s), but its cash requirement has not been evidenced yet. Research the capital plan before committing.`;
  }
  if (!candidate.affordable) {
    return `Costs ${candidate.costDays} days and ${candidate.costMoney}; more than the ${resources.days ?? horizonDays} days or ${resources.money ?? 0} available.`;
  }
  if (candidate.blockedBy.length > 0) {
    return `Waiting on ${candidate.blockedBy.length} earlier piece(s) of work.`;
  }
  if (candidate.kind === 'build' && candidate.confidence < policy.minimumConfidenceToBuild) {
    return `Scores ${Math.round(candidate.attractiveness)} but confidence is only ${Math.round(candidate.confidence * 100)}%. Test it before building it.`;
  }

  const per = candidate.expectedReturn.toFixed(1);
  const capital = candidate.capitalCostKnown === false
    ? 'cash requirement unknown'
    : `cash ${candidate.costMoney}`;
  return `Expected return ${per} per day over ${candidate.costDays} day(s), ${capital}, fit ${Math.round(candidate.fit)}, confidence ${Math.round(candidate.confidence * 100)}%.`;
}

function explainAllocation(
  recommendation: RankedCandidate | null,
  ranked: readonly RankedCandidate[],
  horizonDays: number,
): string {
  if (!recommendation) {
    return `Across ${ranked.length} candidate(s), nothing justifies committing the next ${horizonDays} days.`;
  }

  const runnerUp = ranked.find((candidate) => candidate.id !== recommendation.id);
  const margin = runnerUp
    ? ` It beats ${runnerUp.title} on expected return per day (${recommendation.expectedReturn.toFixed(1)} against ${runnerUp.expectedReturn.toFixed(1)}).`
    : '';

  return `Best use of the next ${horizonDays} days: ${recommendation.title}.${margin}`;
}
