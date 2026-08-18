import { createHash } from 'node:crypto';
import { computeConfidence, describeConfidenceBand, type ConfidenceResult } from './confidence';
import { DIMENSIONS } from './dimensions';
import type { CompositeKey, DimensionResult, ScoringInput } from './types';

/**
 * Aggregation.
 *
 * Dimensions produce 0-1 values; composites are weighted means over the ones
 * that could actually be computed. Weight belonging to a dimension with no
 * evidence is redistributed rather than counted as zero, so an unexamined
 * opportunity does not look like a bad one.
 */

export const ENGINE_VERSION = '1.0.0';

export interface DimensionOutcome extends DimensionResult {
  key: string;
  label: string;
  composite: CompositeKey;
  weight: number;
  /** Share of the composite this dimension actually contributed. */
  contribution: number;
}

export interface CompositeScore {
  key: CompositeKey;
  /** 0-100, or null when nothing in the composite could be computed. */
  value: number | null;
  /** Share of the composite's declared weight that had evidence behind it. */
  coverage: number;
  dimensions: DimensionOutcome[];
  gaps: string[];
}

export interface ScoreResult {
  engineVersion: string;
  inputsDigest: string;
  composites: Record<CompositeKey, CompositeScore>;
  confidence: ConfidenceResult;
  confidenceBand: { label: string; meaning: string };
  dimensions: DimensionOutcome[];
  /** Every dimension that could not be computed, and why. */
  gaps: Array<{ key: string; label: string; reason: string }>;
  /** The headline pair, kept separate on purpose. */
  headline: { attractiveness: number | null; fit: number | null; confidence: number };
}

export type WeightOverrides = Partial<Record<string, number>>;

/**
 * Canonical digest of the inputs. Identical inputs produce an identical digest,
 * which makes recomputation idempotent and lets a score change be traced to a
 * specific change in evidence rather than to drift.
 */
export function digestInput(input: ScoringInput): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function scoreOpportunity(input: ScoringInput, weights: WeightOverrides = {}): ScoreResult {
  const outcomes: DimensionOutcome[] = DIMENSIONS.map((definition) => {
    const result = definition.compute(input);
    return {
      ...result,
      key: definition.key,
      label: definition.label,
      composite: definition.composite,
      weight: weights[definition.key] ?? definition.defaultWeight,
      contribution: 0,
    };
  });

  const composites = {} as Record<CompositeKey, CompositeScore>;
  const compositeKeys: CompositeKey[] = [
    'attractiveness',
    'fit',
    'confidence',
    'leverage',
    'timing',
    'validation_efficiency',
    'strategic_value',
    'execution_risk',
  ];

  for (const key of compositeKeys) {
    const members = outcomes.filter((outcome) => outcome.composite === key);
    const usable = members.filter((outcome) => outcome.status === 'ok' && outcome.normalised !== null);

    const declaredWeight = members.reduce((sum, outcome) => sum + outcome.weight, 0);
    const usableWeight = usable.reduce((sum, outcome) => sum + outcome.weight, 0);

    if (usable.length === 0 || usableWeight === 0) {
      composites[key] = {
        key,
        value: null,
        coverage: 0,
        dimensions: members,
        gaps: members.map((outcome) => outcome.explanation),
      };
      continue;
    }

    let total = 0;
    for (const outcome of usable) {
      // Weight is redistributed across what could be measured, so a missing
      // dimension dilutes certainty rather than dragging the score to zero.
      const share = outcome.weight / usableWeight;
      outcome.contribution = share * (outcome.normalised ?? 0);
      total += outcome.contribution;
    }

    composites[key] = {
      key,
      value: Math.round(total * 100),
      coverage: declaredWeight === 0 ? 0 : usableWeight / declaredWeight,
      dimensions: members,
      gaps: members
        .filter((outcome) => outcome.status !== 'ok')
        .map((outcome) => outcome.explanation),
    };
  }

  // Confidence is told which dimensions had nothing behind them, so an
  // unexamined decisive factor lowers certainty rather than passing unnoticed.
  const confidence = computeConfidence(input, {
    unmeasuredDimensions: outcomes
      .filter((outcome) => outcome.status !== 'ok')
      .map((outcome) => outcome.key),
  });
  // The confidence composite is informational; the authoritative value is the
  // one computed by its own engine, never a weighted average of dimensions.
  composites.confidence = {
    key: 'confidence',
    value: Math.round(confidence.value * 100),
    coverage: 1,
    dimensions: [],
    gaps: [],
  };

  return {
    engineVersion: ENGINE_VERSION,
    inputsDigest: digestInput(input),
    composites,
    confidence,
    confidenceBand: describeConfidenceBand(confidence.value),
    dimensions: outcomes,
    gaps: outcomes
      .filter((outcome) => outcome.status === 'insufficient_evidence')
      .map((outcome) => ({ key: outcome.key, label: outcome.label, reason: outcome.explanation })),
    headline: {
      attractiveness: composites.attractiveness.value,
      fit: composites.fit.value,
      confidence: confidence.value,
    },
  };
}

export interface ScoreDelta {
  composite: CompositeKey;
  from: number | null;
  to: number | null;
  delta: number;
  topDrivers: Array<{ key: string; label: string; change: number; explanation: string }>;
}

/**
 * Explains a movement by diffing dimension contributions.
 *
 * This is what lets the daily brief say why something moved without asking a
 * model: the arithmetic already knows.
 */
export function diffScores(previous: ScoreResult, current: ScoreResult): ScoreDelta[] {
  const deltas: ScoreDelta[] = [];

  for (const key of Object.keys(current.composites) as CompositeKey[]) {
    const before = previous.composites[key]?.value ?? null;
    const after = current.composites[key]?.value ?? null;
    if (before === after) continue;

    const drivers = current.dimensions
      .filter((outcome) => outcome.composite === key)
      .map((outcome) => {
        const prior = previous.dimensions.find((d) => d.key === outcome.key);
        return {
          key: outcome.key,
          label: outcome.label,
          change: outcome.contribution - (prior?.contribution ?? 0),
          explanation: outcome.explanation,
        };
      })
      .filter((driver) => Math.abs(driver.change) > 0.001)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 3);

    deltas.push({
      composite: key,
      from: before,
      to: after,
      delta: (after ?? 0) - (before ?? 0),
      topDrivers: drivers,
    });
  }

  return deltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}
