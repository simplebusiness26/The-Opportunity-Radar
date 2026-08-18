import {
  capabilityAncestors,
  capabilityLabel,
  typicalBuildDays,
} from '../taxonomy/capabilities';

/**
 * Build leverage: how much of an opportunity already exists internally.
 *
 * The output is deliberately a range, not a number. Estimating build time is
 * genuinely uncertain, and presenting "6 days" where the honest answer is
 * "4 to 11 days" would be false precision -- the kind that gets a weekend
 * committed to a fortnight's work.
 */

export type Maturity = 'experimental' | 'working' | 'production' | 'battle_tested';
export type ReuseReadiness = 'concept' | 'needs_work' | 'lift_and_shift' | 'drop_in';

export interface OwnedCapability {
  taxonomyKey: string;
  maturity: Maturity;
  /** How well supported the claim to have this is, 0-1. */
  evidenceStrength: number;
  /** Names of the assets that provide it, for the explanation. */
  assetNames: string[];
  /**
   * How ready the best providing asset is to be reused. A capability backed
   * only by a concept is not the same as one backed by a drop-in component,
   * even at the same maturity.
   */
  reuseReadiness?: ReuseReadiness;
}

export interface RequiredCapability {
  taxonomyKey: string | null;
  /** The original wording, kept so an unresolved requirement can be shown. */
  label: string;
  criticality: 'nice_to_have' | 'important' | 'essential';
}

/**
 * How much credit a capability earns depends on how proven it is. A working
 * prototype is not the same as something that has survived production.
 */
const MATURITY_CREDIT: Record<Maturity, number> = {
  experimental: 0.35,
  working: 0.7,
  production: 0.95,
  battle_tested: 1,
};

const READINESS_CREDIT: Record<ReuseReadiness, number> = {
  concept: 0.2,
  needs_work: 0.5,
  lift_and_shift: 0.85,
  drop_in: 1,
};

const CRITICALITY_WEIGHT: Record<RequiredCapability['criticality'], number> = {
  nice_to_have: 0.4,
  important: 1,
  essential: 1.8,
};

export interface CapabilityMatch {
  required: RequiredCapability;
  /** The owned capability that satisfies it, if any. */
  matched: OwnedCapability | null;
  /** 0-1. Partial credit for a related capability rather than an exact one. */
  coverage: number;
  matchKind: 'exact' | 'related' | 'missing' | 'unresolved';
  note: string;
}

/**
 * Matches what an opportunity needs against what the team has.
 *
 * An exact key match earns credit scaled by maturity. A capability under the
 * same parent earns partial credit, because having built payments makes
 * building subscriptions easier without making it free. Anything that will not
 * resolve to a taxonomy key is reported as unresolved rather than assumed
 * missing or assumed present.
 */
export function matchCapabilities(
  required: readonly RequiredCapability[],
  owned: readonly OwnedCapability[],
): CapabilityMatch[] {
  const ownedByKey = new Map(owned.map((capability) => [capability.taxonomyKey, capability]));

  return required.map((requirement): CapabilityMatch => {
    if (!requirement.taxonomyKey) {
      return {
        required: requirement,
        matched: null,
        coverage: 0,
        matchKind: 'unresolved',
        note: `"${requirement.label}" could not be matched to a known capability, so it is counted as a gap rather than guessed at.`,
      };
    }

    const exact = ownedByKey.get(requirement.taxonomyKey);
    if (exact) {
      const coverage = capabilityCredit(exact);
      return {
        required: requirement,
        matched: exact,
        coverage,
        matchKind: 'exact',
        note: exact.assetNames.length
          ? `Already built: ${exact.assetNames.slice(0, 3).join(', ')}.`
          : `Already have ${capabilityLabel(requirement.taxonomyKey)} at ${exact.maturity} maturity.`,
      };
    }

    // Sibling capabilities: having built one thing under a parent makes the
    // next one cheaper, but not free.
    const ancestors = capabilityAncestors(requirement.taxonomyKey);
    const related = owned.find((capability) =>
      capabilityAncestors(capability.taxonomyKey).some((ancestor) => ancestors.includes(ancestor)),
    );

    if (related) {
      const coverage = 0.35 * capabilityCredit(related);
      return {
        required: requirement,
        matched: related,
        coverage,
        matchKind: 'related',
        note: `Not built, but ${capabilityLabel(related.taxonomyKey)} is closely related and would make it faster.`,
      };
    }

    return {
      required: requirement,
      matched: null,
      coverage: 0,
      matchKind: 'missing',
      note: `${capabilityLabel(requirement.taxonomyKey)} would have to be built from scratch.`,
    };
  });
}

export interface LeverageEstimate {
  /** Weighted fraction of what is needed that already exists, 0-1. */
  coverage: number;
  requiredCount: number;
  missingCount: number;
  unresolvedCount: number;
  matches: CapabilityMatch[];
  /** Days to build with nothing to start from. Always a range. */
  greenfieldDays: [number, number];
  /** Days to build using what already exists. Always a range. */
  leveragedDays: [number, number];
  /** 0-100, for display alongside the other scores. */
  leverageScore: number;
  /** Assets that would actually be reused, named. */
  reusableAssets: string[];
  missing: string[];
  explanation: string;
  /** Set when the estimate rests on so little that it should not be leaned on. */
  caveat: string | null;
}

/**
 * Turns the matches into an effort estimate.
 *
 * The ranges widen as confidence falls: an estimate built on unverified
 * capability claims is presented as wider, not as a different midpoint, because
 * the uncertainty is what the reader needs to see.
 */
export function estimateBuildLeverage(matches: readonly CapabilityMatch[]): LeverageEstimate {
  if (matches.length === 0) {
    return {
      coverage: 0,
      requiredCount: 0,
      missingCount: 0,
      unresolvedCount: 0,
      matches: [],
      greenfieldDays: [0, 0],
      leveragedDays: [0, 0],
      leverageScore: 0,
      reusableAssets: [],
      missing: [],
      explanation: 'No capability requirements have been recorded, so leverage cannot be estimated.',
      caveat: 'Add what this would need before relying on any build estimate.',
    };
  }

  let weightedCoverage = 0;
  let totalWeight = 0;
  let greenfieldDays = 0;
  let leveragedDays = 0;

  const reusableAssets = new Set<string>();
  const missing: string[] = [];
  let unresolvedCount = 0;

  for (const match of matches) {
    const weight = CRITICALITY_WEIGHT[match.required.criticality];
    totalWeight += weight;
    weightedCoverage += weight * match.coverage;

    const days = match.required.taxonomyKey ? typicalBuildDays(match.required.taxonomyKey) : 8;
    greenfieldDays += days;
    leveragedDays += days * (1 - match.coverage);

    if (match.matchKind === 'unresolved') unresolvedCount += 1;
    if (match.matchKind === 'missing' || match.matchKind === 'unresolved') {
      missing.push(match.required.label);
    }
    for (const asset of match.matched?.assetNames ?? []) reusableAssets.add(asset);
  }

  const coverage = totalWeight > 0 ? weightedCoverage / totalWeight : 0;

  // Integration is never free: assembling parts that already exist still costs
  // real days, so leveraged effort has a floor rather than trending to zero.
  const integrationFloor = Math.max(1, greenfieldDays * 0.15);
  const leveraged = Math.max(integrationFloor, leveragedDays);

  // The spread widens when much of the estimate rests on unresolved or
  // unverified requirements.
  const uncertainty = 0.35 + 0.4 * (unresolvedCount / matches.length);

  const estimate: LeverageEstimate = {
    coverage,
    requiredCount: matches.length,
    missingCount: missing.length,
    unresolvedCount,
    matches: [...matches],
    greenfieldDays: range(greenfieldDays, 0.3),
    leveragedDays: range(leveraged, uncertainty),
    leverageScore: Math.round(
      100 * (0.6 * coverage + 0.4 * (1 - leveraged / Math.max(greenfieldDays, 1))),
    ),
    reusableAssets: [...reusableAssets],
    missing,
    explanation: '',
    caveat: null,
  };

  estimate.explanation = explain(estimate);
  estimate.caveat =
    unresolvedCount > matches.length / 2
      ? 'Over half of what this needs could not be matched to a known capability, so treat the estimate as a rough shape rather than a plan.'
      : null;

  return estimate;
}

function explain(estimate: LeverageEstimate): string {
  const covered = estimate.requiredCount - estimate.missingCount;
  const percentage = Math.round(estimate.coverage * 100);

  const head = `${covered} of ${estimate.requiredCount} required capabilities already exist, giving roughly ${percentage}% coverage.`;
  const effort = `Building it from nothing would take an estimated ${estimate.greenfieldDays[0]}-${estimate.greenfieldDays[1]} days; using what is already here, ${estimate.leveragedDays[0]}-${estimate.leveragedDays[1]}.`;
  const gap = estimate.missing.length
    ? ` Still missing: ${estimate.missing.slice(0, 4).join(', ')}.`
    : ' Nothing material is missing.';

  return `${head} ${effort}${gap}`;
}

function range(days: number, spread: number): [number, number] {
  const low = Math.max(1, Math.round(days * (1 - spread)));
  const high = Math.max(low + 1, Math.round(days * (1 + spread)));
  return [low, high];
}

/**
 * How much of a requirement an owned capability actually covers.
 *
 * Three things have to be true for existing work to save time: it has to be
 * proven, we have to be confident we really have it, and it has to be in a
 * state where it can be reused rather than merely referred to.
 */
function capabilityCredit(capability: OwnedCapability): number {
  const readiness = capability.reuseReadiness
    ? READINESS_CREDIT[capability.reuseReadiness]
    : // Unrecorded readiness is treated as the middle of the range rather than
      // the best case, so an unfilled field cannot flatter the estimate.
      READINESS_CREDIT.needs_work;

  return MATURITY_CREDIT[capability.maturity] * clamp01(capability.evidenceStrength) * readiness;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
