import { EVIDENCE_CLASSES, type EvidenceClass } from '../taxonomy/evidence-class';
import { SIGNAL_TYPES, type DecayMode, type SignalTypeKey } from '../taxonomy/signal-types';

/**
 * Evidence decay.
 *
 * Not everything goes stale at the same rate, and a single expiry for all of it
 * would be wrong in both directions: a two-year-old customer complaint is
 * usually still true, while a two-year-old inference price is worthless. Some
 * evidence does not decay with time at all -- regulation changes when it is
 * amended, and an internal capability changes when the code does.
 */

export interface DecayInput {
  signalType: SignalTypeKey;
  evidenceClass: EvidenceClass;
  observedAt: Date;
  now: Date;
  /** Overrides the type default, for a signal known to age differently. */
  halfLifeDaysOverride?: number | null;
  /**
   * For event-driven evidence: whether the event that would invalidate it has
   * happened. Until it does, the evidence holds at full strength.
   */
  supersededAt?: Date | null;
  /** Set when the underlying repository or asset changed, for internal evidence. */
  underlyingChangedAt?: Date | null;
}

export interface DecayResult {
  /** Strength before age is taken into account. */
  baseStrength: number;
  /** Strength after decay. This is what scoring consumes. */
  effectiveStrength: number;
  ageDays: number;
  halfLifeDays: number;
  mode: DecayMode;
  /** Plain-language account of why the number is what it is. */
  explanation: string;
  /** True when the evidence needs re-verifying before it is leaned on. */
  stale: boolean;
}

/**
 * Floor for time-decayed evidence. Old evidence weakens but never becomes
 * literally worthless, because "this was true two years ago" is still a fact.
 */
const STRENGTH_FLOOR = 0.05;

/** Where event-driven evidence drops to once its underpinning has moved. */
const UNVERIFIED_FLOOR = 0.2;

const STALE_BELOW = 0.35;

export function resolveHalfLife(input: {
  signalType: SignalTypeKey;
  evidenceClass: EvidenceClass;
  halfLifeDaysOverride?: number | null;
}): number {
  // Most specific wins: an explicit override, then the signal type, then the
  // broad default for the class of evidence.
  if (input.halfLifeDaysOverride && input.halfLifeDaysOverride > 0) {
    return input.halfLifeDaysOverride;
  }
  const byType = SIGNAL_TYPES[input.signalType]?.halfLifeDays;
  if (byType) return byType;
  return EVIDENCE_CLASSES[input.evidenceClass].halfLifeDays;
}

export function computeDecay(input: DecayInput): DecayResult {
  const definition = SIGNAL_TYPES[input.signalType];
  const evidence = EVIDENCE_CLASSES[input.evidenceClass];
  const baseStrength = definition.baseStrength * evidence.weight;

  const ageDays = Math.max(0, (input.now.getTime() - input.observedAt.getTime()) / 86_400_000);
  const halfLifeDays = resolveHalfLife(input);
  const mode = definition.decayMode;

  if (mode === 'event') {
    if (input.supersededAt) {
      return {
        baseStrength,
        effectiveStrength: 0,
        ageDays,
        halfLifeDays,
        mode,
        explanation: `Superseded on ${input.supersededAt.toISOString().slice(0, 10)}, so it no longer describes the current position.`,
        stale: true,
      };
    }

    if (input.underlyingChangedAt && input.underlyingChangedAt > input.observedAt) {
      return {
        baseStrength,
        effectiveStrength: Math.min(baseStrength, UNVERIFIED_FLOOR),
        ageDays,
        halfLifeDays,
        mode,
        explanation:
          'What this was based on has changed since it was recorded, so it is held at a reduced weight until it is re-checked.',
        stale: true,
      };
    }

    return {
      baseStrength,
      effectiveStrength: baseStrength,
      ageDays,
      halfLifeDays,
      mode,
      explanation:
        'This kind of evidence does not weaken with time; it holds until something changes it.',
      stale: false,
    };
  }

  const decayed = baseStrength * Math.pow(2, -ageDays / halfLifeDays);
  const effectiveStrength = Math.max(baseStrength * STRENGTH_FLOOR, decayed);
  const retained = baseStrength > 0 ? effectiveStrength / baseStrength : 0;

  return {
    baseStrength,
    effectiveStrength,
    ageDays,
    halfLifeDays,
    mode,
    explanation:
      ageDays < 1
        ? 'Observed today, so it is at full strength.'
        : `${Math.round(ageDays)} days old against a ${halfLifeDays}-day half-life, so ${Math.round(retained * 100)}% of its original weight remains.`,
    stale: retained < STALE_BELOW,
  };
}

export interface FreshnessSummary {
  /** Share of total possible strength still present, 0-1. */
  freshness: number;
  staleCount: number;
  totalCount: number;
  oldestObservedAt: Date | null;
  newestObservedAt: Date | null;
}

export function summariseFreshness(results: readonly (DecayResult & { observedAt: Date })[]): FreshnessSummary {
  if (results.length === 0) {
    return { freshness: 0, staleCount: 0, totalCount: 0, oldestObservedAt: null, newestObservedAt: null };
  }

  let base = 0;
  let effective = 0;
  let stale = 0;
  let oldest = results[0]!.observedAt;
  let newest = results[0]!.observedAt;

  for (const result of results) {
    base += result.baseStrength;
    effective += result.effectiveStrength;
    if (result.stale) stale += 1;
    if (result.observedAt < oldest) oldest = result.observedAt;
    if (result.observedAt > newest) newest = result.observedAt;
  }

  return {
    freshness: base > 0 ? effective / base : 0,
    staleCount: stale,
    totalCount: results.length,
    oldestObservedAt: oldest,
    newestObservedAt: newest,
  };
}

/**
 * Whether a refresh is worth doing. Recomputing every night regardless would
 * churn scores for no reason, so work happens on threshold crossings only.
 */
export function crossedThreshold(previous: number, current: number, thresholds = [0.75, 0.5, 0.35, 0.2]): boolean {
  return thresholds.some(
    (threshold) => (previous >= threshold && current < threshold) || (previous < threshold && current >= threshold),
  );
}
