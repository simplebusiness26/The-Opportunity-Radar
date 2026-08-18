import type { LeverageEstimate } from '../leverage/index';

/**
 * Fit: how good this opportunity is *for us*.
 *
 * Kept rigorously apart from attractiveness. A market can be excellent and
 * still be a poor use of this particular team's next month, and the product is
 * only useful if it can say so. Conflating the two produces the failure mode
 * every generic opportunity finder has: a ranked list of things somebody else
 * should build.
 */

export interface FitInput {
  leverage: LeverageEstimate;
  /** Do we already know this customer's world? */
  domainExperience: 'none' | 'adjacent' | 'direct' | null;
  /** Can we reach these customers without buying access? */
  customerAccess: 'none' | 'weak' | 'strong' | null;
  hasDistribution: boolean | null;
  /** Capital available against what this needs. */
  capitalFit: { available: number | null; required: number | null };
  /** Days available against the leveraged estimate. */
  timeFit: { availableDays: number | null; requiredDays: number | null };
  /** How well it serves what the team said it is trying to do, 0-1. */
  strategicAlignment: number | null;
  /** The owner's own appetite, 0-1. Recorded, never inferred. */
  motivation: number | null;
  priorOutcomes: { successes: number; failures: number };
}

export interface FitFactor {
  key: string;
  label: string;
  /** 0-1, or null when it has not been recorded. */
  value: number | null;
  weight: number;
  note: string;
}

export interface FitResult {
  /** 0-100. */
  score: number;
  /** 0-1: how much of the picture was actually known. */
  confidence: number;
  factors: FitFactor[];
  advantages: string[];
  weaknesses: string[];
  /** What would have to be true, that has not been recorded. */
  unknowns: string[];
  explanation: string;
}

const WEIGHTS = {
  buildLeverage: 1.4,
  domainExperience: 1.2,
  customerAccess: 1.5,
  distribution: 1.3,
  capitalFit: 1,
  timeFit: 1,
  strategicAlignment: 1.1,
  motivation: 0.8,
  trackRecord: 0.7,
} as const;

/**
 * Scores fit from what has been recorded, and says plainly what it did not know.
 *
 * Unrecorded factors are excluded and their weight redistributed rather than
 * scored as zero. Scoring absence as a negative would mean a team that has
 * simply not filled in a profile appears unsuited to everything.
 */
export function computeFit(input: FitInput): FitResult {
  const factors: FitFactor[] = [
    {
      key: 'buildLeverage',
      label: 'How much already exists',
      value: input.leverage.requiredCount > 0 ? input.leverage.coverage : null,
      weight: WEIGHTS.buildLeverage,
      note:
        input.leverage.requiredCount > 0
          ? `${Math.round(input.leverage.coverage * 100)}% of what this needs is already built.`
          : 'No capability requirements recorded.',
    },
    {
      key: 'domainExperience',
      label: 'Domain understanding',
      value: mapScale(input.domainExperience, { none: 0.1, adjacent: 0.55, direct: 1 }),
      weight: WEIGHTS.domainExperience,
      note: describeDomain(input.domainExperience),
    },
    {
      key: 'customerAccess',
      label: 'Access to these customers',
      value: mapScale(input.customerAccess, { none: 0.05, weak: 0.45, strong: 1 }),
      weight: WEIGHTS.customerAccess,
      note: describeAccess(input.customerAccess),
    },
    {
      key: 'distribution',
      label: 'Existing distribution',
      value: input.hasDistribution === null ? null : input.hasDistribution ? 1 : 0.15,
      weight: WEIGHTS.distribution,
      note:
        input.hasDistribution === null
          ? 'Not recorded.'
          : input.hasDistribution
            ? 'There is an existing audience to launch into.'
            : 'Every customer would have to be found from cold.',
    },
    {
      key: 'capitalFit',
      label: 'Capital fit',
      value: ratioFit(input.capitalFit.available, input.capitalFit.required),
      weight: WEIGHTS.capitalFit,
      note: describeRatio(input.capitalFit.available, input.capitalFit.required, 'budget'),
    },
    {
      key: 'timeFit',
      label: 'Time fit',
      value: ratioFit(input.timeFit.availableDays, input.timeFit.requiredDays),
      weight: WEIGHTS.timeFit,
      note: describeRatio(input.timeFit.availableDays, input.timeFit.requiredDays, 'days'),
    },
    {
      key: 'strategicAlignment',
      label: 'Serves the stated goal',
      value: input.strategicAlignment,
      weight: WEIGHTS.strategicAlignment,
      note:
        input.strategicAlignment === null
          ? 'No strategic goals recorded to compare against.'
          : `${Math.round(input.strategicAlignment * 100)}% aligned with the current goal.`,
    },
    {
      key: 'motivation',
      label: 'Appetite for it',
      value: input.motivation,
      weight: WEIGHTS.motivation,
      note:
        input.motivation === null
          ? 'Not recorded. Radar does not guess at what someone wants to work on.'
          : `Recorded appetite ${Math.round(input.motivation * 100)}%.`,
    },
    {
      key: 'trackRecord',
      label: 'Track record on similar work',
      value: trackRecord(input.priorOutcomes),
      weight: WEIGHTS.trackRecord,
      note: describeTrackRecord(input.priorOutcomes),
    },
  ];

  const known = factors.filter((factor) => factor.value !== null);
  const totalWeight = known.reduce((sum, factor) => sum + factor.weight, 0);

  const score =
    totalWeight > 0
      ? known.reduce((sum, factor) => sum + factor.weight * (factor.value ?? 0), 0) / totalWeight
      : 0;

  // Confidence in the fit judgement is the share of the picture that was known,
  // weighted -- not the score itself.
  const allWeight = factors.reduce((sum, factor) => sum + factor.weight, 0);
  const confidence = allWeight > 0 ? totalWeight / allWeight : 0;

  const advantages = known
    .filter((factor) => (factor.value ?? 0) >= 0.7)
    .sort((a, b) => (b.value ?? 0) * b.weight - (a.value ?? 0) * a.weight)
    .map((factor) => factor.note);

  const weaknesses = known
    .filter((factor) => (factor.value ?? 0) <= 0.35)
    .sort((a, b) => a.weight * (a.value ?? 0) - b.weight * (b.value ?? 0))
    .map((factor) => factor.note);

  const unknowns = factors
    .filter((factor) => factor.value === null)
    .map((factor) => `${factor.label} has not been recorded.`);

  return {
    score: Math.round(score * 100),
    confidence,
    factors,
    advantages,
    weaknesses,
    unknowns,
    explanation: explainFit(Math.round(score * 100), confidence, advantages, weaknesses, unknowns),
  };
}

function explainFit(
  score: number,
  confidence: number,
  advantages: string[],
  weaknesses: string[],
  unknowns: string[],
): string {
  if (confidence < 0.35) {
    return `Fit scores ${score}, but too little about this team has been recorded for that to mean much. ${unknowns.length} factors are unknown.`;
  }

  const lead =
    score >= 70
      ? `This suits us unusually well (${score}/100).`
      : score >= 45
        ? `A reasonable but not obvious fit (${score}/100).`
        : `This is a poor fit for us specifically (${score}/100), whatever the market looks like.`;

  const because = advantages.length ? ` ${advantages[0]}` : '';
  const despite = weaknesses.length ? ` Against it: ${weaknesses[0]}` : '';

  return `${lead}${because}${despite}`;
}

function mapScale<K extends string>(value: K | null, scale: Record<K, number>): number | null {
  return value === null ? null : scale[value];
}

/** How comfortably what we have covers what is needed. */
function ratioFit(available: number | null, required: number | null): number | null {
  if (available === null || required === null) return null;
  if (required <= 0) return 1;
  const ratio = available / required;
  if (ratio >= 2) return 1;
  if (ratio >= 1) return 0.75 + 0.25 * (ratio - 1);
  return Math.max(0, ratio * 0.75);
}

function describeRatio(available: number | null, required: number | null, unit: string): string {
  if (available === null || required === null) return `Available ${unit} not recorded.`;
  if (required <= 0) return `Needs no meaningful ${unit}.`;
  return available >= required
    ? `Comfortably within the available ${unit} (${Math.round(available)} against ${Math.round(required)}).`
    : `Needs more ${unit} than are available (${Math.round(required)} against ${Math.round(available)}).`;
}

function describeDomain(value: FitInput['domainExperience']): string {
  if (value === null) return 'Domain experience not recorded.';
  return {
    none: 'No experience of this domain; expect to learn it at full price.',
    adjacent: 'Adjacent experience, which transfers partially.',
    direct: 'Direct experience of this domain.',
  }[value];
}

function describeAccess(value: FitInput['customerAccess']): string {
  if (value === null) return 'Customer access not recorded.';
  return {
    none: 'No route to these customers; they would all have to be found cold.',
    weak: 'Some route to these customers, but nothing dependable.',
    strong: 'We can already reach these customers directly.',
  }[value];
}

/**
 * Track record only counts once there is enough of it to mean anything. Two
 * outcomes is an anecdote, not a pattern.
 */
function trackRecord(outcomes: { successes: number; failures: number }): number | null {
  const total = outcomes.successes + outcomes.failures;
  if (total < 3) return null;
  return outcomes.successes / total;
}

function describeTrackRecord(outcomes: { successes: number; failures: number }): string {
  const total = outcomes.successes + outcomes.failures;
  if (total === 0) return 'No comparable work has been recorded yet.';
  if (total < 3) {
    return `Only ${total} comparable ${total === 1 ? 'outcome' : 'outcomes'} recorded — too few to read anything into.`;
  }
  return `${outcomes.successes} of ${total} comparable attempts worked out.`;
}
