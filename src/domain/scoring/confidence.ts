import { countsAsIndependent, type EvidenceClass } from '../taxonomy/evidence-class';
import { clamp, saturating } from './normalise';
import type { ScoringInput } from './types';

/**
 * Confidence is computed separately from every other score, and deliberately so.
 *
 * A thesis can be enormously attractive and almost entirely unsupported. If
 * uncertainty were folded into attractiveness the two would be impossible to
 * tell apart, and the product's most useful sentence -- "this looks excellent
 * and we have nowhere near enough evidence to act on it" -- could not be said.
 */

export interface ConfidenceResult {
  value: number;
  factors: Array<{ key: string; label: string; contribution: number; note: string }>;
  /** Set when a hard rule capped the value regardless of everything else. */
  cap: { applied: boolean; reason: string | null; ceiling: number | null };
  explanation: string;
}

/**
 * With no independent non-AI source, confidence cannot exceed this however
 * strong everything else looks. This one rule is what makes the system able to
 * refuse to act on volume alone.
 */
export const NO_INDEPENDENT_SOURCE_CEILING = 0.15;
export const SINGLE_SOURCE_CEILING = 0.45;
export const UNMEASURED_DECISIVE_CEILING = 0.5;

/**
 * No amount of evidence makes a forecast about the future certain.
 *
 * Without this the arithmetic can reach 100%, and a system whose entire claim
 * is calibrated honesty must never display that number. The residual is not
 * modesty; it is the part of the world nobody has observed yet.
 */
export const MAXIMUM_CONFIDENCE = 0.95;

/**
 * Dimensions a thesis cannot be confidently held without.
 *
 * Confidence is confidence in the *thesis*, not in the pile of evidence. Twelve
 * unrelated people complaining is strong support for "this problem exists" and
 * says nothing at all about "people would pay to fix it" -- and the second is
 * usually what is actually being claimed. Leaving one of these unmeasured caps
 * confidence, because the gap is the reason to be unsure.
 */
export const DECISIVE_DIMENSIONS = ['willingness_to_pay', 'competition_gap'] as const;

export interface ConfidenceContext {
  /** Dimension keys that could not be computed for want of evidence. */
  unmeasuredDimensions: string[];
}

export function computeConfidence(
  input: ScoringInput,
  context: ConfidenceContext = { unmeasuredDimensions: [] },
): ConfidenceResult {
  const factors: ConfidenceResult['factors'] = [];

  const independent = input.evidence.independentSources;
  const independence = saturating(independent, 3);
  factors.push({
    key: 'independent_sources',
    label: 'Independent sources',
    contribution: independence * 0.35,
    note: `${independent} unrelated ${independent === 1 ? 'source' : 'sources'} observed this.`,
  });

  const qualityScore = evidenceQuality(input.evidence.countByClass);
  factors.push({
    key: 'evidence_quality',
    label: 'Evidence quality',
    contribution: qualityScore * 0.25,
    note: describeQuality(input.evidence.countByClass),
  });

  const diversity = input.evidence.sourceDiversity;
  factors.push({
    key: 'source_diversity',
    label: 'Source diversity',
    contribution: diversity * 0.1,
    note:
      diversity > 0.7
        ? 'Evidence is spread across sources rather than dominated by one.'
        : 'Most of the evidence comes from a small number of sources.',
  });

  const freshness = input.evidence.freshness;
  factors.push({
    key: 'freshness',
    label: 'Freshness',
    contribution: freshness * 0.15,
    note: `${Math.round(freshness * 100)}% of the evidence weight survives decay.`,
  });

  // Evidence that argues against the thesis reduces confidence in it. This is
  // the mechanism by which red-teaming actually changes the numbers.
  const contradiction = contradictionRatio(input);
  factors.push({
    key: 'contradiction',
    label: 'Contradicting evidence',
    contribution: -contradiction * 0.25,
    note:
      input.evidence.counterEvidenceCount > 0
        ? `${input.evidence.counterEvidenceCount} pieces of evidence argue against this.`
        : 'No contradicting evidence has been found yet, though none has been looked for either.',
  });

  const unknowns = input.uncertainty.criticalUnknownCount;
  const unknownPenalty = saturating(unknowns, 3);
  factors.push({
    key: 'critical_unknowns',
    label: 'Critical unknowns',
    contribution: -unknownPenalty * 0.2,
    note:
      unknowns > 0
        ? `${unknowns} critical ${unknowns === 1 ? 'question is' : 'questions are'} still unanswered.`
        : 'No critical unknowns are outstanding.',
  });

  /*
   * Real-world results move confidence more than anything gathered by reading,
   * because they are the only input that observed behaviour rather than
   * reported it. An inconclusive experiment moves nothing: rewarding activity
   * over evidence is exactly what this product exists not to do.
   */
  const validation = input.validation;
  if (validation.concludedExperiments > 0) {
    const contribution =
      validation.rejectedCount > 0
        ? -0.35
        : validation.validatedCount > 0
          ? 0.25
          : validation.partiallyValidatedCount > 0
            ? 0.1
            : 0;

    factors.push({
      key: 'real_world_result',
      label: 'Tested against real people',
      contribution,
      note:
        validation.rejectedCount > 0
          ? `${validation.rejectedCount} experiment(s) came back negative.`
          : validation.validatedCount > 0
            ? `${validation.validatedCount} experiment(s) supported the thesis against real people.`
            : validation.partiallyValidatedCount > 0
              ? 'An experiment partly supported the thesis.'
              : 'The experiments run so far settled nothing, so confidence is unchanged by them.',
    });
  }

  let value = clamp(0.15 + factors.reduce((sum, factor) => sum + factor.contribution, 0));

  // Calibration only adjusts once there is enough history to mean anything.
  if (input.calibration.sampleSize >= 8 && input.calibration.confidenceBias !== null) {
    const correction = -input.calibration.confidenceBias * 0.5;
    factors.push({
      key: 'calibration',
      label: 'Calibration',
      contribution: correction,
      note:
        input.calibration.confidenceBias > 0
          ? `Past predictions ran optimistic across ${input.calibration.sampleSize} outcomes, so this is adjusted down.`
          : `Past predictions ran pessimistic across ${input.calibration.sampleSize} outcomes, so this is adjusted up.`,
    });
    value = clamp(value + correction);
  }

  const unmeasuredDecisive = DECISIVE_DIMENSIONS.filter((key) =>
    context.unmeasuredDimensions.includes(key),
  );

  if (unmeasuredDecisive.length > 0) {
    factors.push({
      key: 'unmeasured_decisive',
      label: 'Unmeasured decisive factors',
      contribution: 0,
      note: `Nothing establishes ${unmeasuredDecisive.map(describeDimension).join(' or ')} yet.`,
    });
  }

  const cap = applyCaps(input, value, unmeasuredDecisive);
  const capped = cap.ceiling !== null ? Math.min(value, cap.ceiling) : value;
  const finalValue = Math.min(capped, MAXIMUM_CONFIDENCE);

  return {
    value: finalValue,
    factors,
    cap,
    explanation: buildExplanation(input, finalValue, cap),
  };
}

function describeDimension(key: string): string {
  return key === 'willingness_to_pay'
    ? 'that anyone would pay'
    : key === 'competition_gap'
      ? 'what people already use instead'
      : key.replace(/_/g, ' ');
}

function applyCaps(
  input: ScoringInput,
  value: number,
  unmeasuredDecisive: readonly string[],
): ConfidenceResult['cap'] {
  if (input.evidence.independentSources === 0) {
    return {
      applied: value > NO_INDEPENDENT_SOURCE_CEILING,
      reason:
        input.evidence.aiDerivedMentions > 0
          ? 'Every piece of evidence here is AI-derived or from a single origin. Model output restates other evidence; it cannot corroborate it.'
          : 'No independent source has been recorded for this yet.',
      ceiling: NO_INDEPENDENT_SOURCE_CEILING,
    };
  }

  if (input.evidence.independentSources === 1) {
    return {
      applied: value > SINGLE_SOURCE_CEILING,
      reason: 'Everything known about this traces back to one source.',
      ceiling: SINGLE_SOURCE_CEILING,
    };
  }

  // Weight of complaint is not evidence of a market. However many people report
  // the problem, the thesis stays uncertain until someone has checked whether
  // they would pay and what they use instead.
  if (unmeasuredDecisive.length > 0) {
    return {
      applied: value > UNMEASURED_DECISIVE_CEILING,
      reason: `The evidence describes the problem well, but nothing establishes ${unmeasuredDecisive
        .map(describeDimension)
        .join(' or ')}.`,
      ceiling: UNMEASURED_DECISIVE_CEILING,
    };
  }

  return { applied: false, reason: null, ceiling: null };
}

function evidenceQuality(countByClass: Partial<Record<EvidenceClass, number>>): number {
  let weighted = 0;
  let total = 0;
  for (const [key, count] of Object.entries(countByClass) as Array<[EvidenceClass, number]>) {
    if (!countsAsIndependent(key)) continue;
    const rank =
      key === 'transaction' || key === 'direct_customer'
        ? 1
        : key === 'primary'
          ? 0.8
          : key === 'reliable_secondary'
            ? 0.6
            : key === 'community'
              ? 0.4
              : 0.2;
    weighted += rank * count;
    total += count;
  }
  return total === 0 ? 0 : weighted / total;
}

function describeQuality(countByClass: Partial<Record<EvidenceClass, number>>): string {
  const direct = (countByClass.direct_customer ?? 0) + (countByClass.transaction ?? 0);
  if (direct > 0) return `${direct} pieces of direct customer or transaction evidence.`;
  const primary = countByClass.primary ?? 0;
  if (primary > 0) return `${primary} primary sources, but nothing directly from a customer.`;
  return 'Evidence is second-hand: nothing comes directly from a customer or a transaction.';
}

function contradictionRatio(input: ScoringInput): number {
  const supporting = Object.values(input.evidence.strengthByType).reduce(
    (sum, value) => sum + (value ?? 0),
    0,
  );
  const against = input.evidence.counterEvidenceStrength;
  if (supporting + against === 0) return 0;
  return against / (supporting + against);
}

function buildExplanation(input: ScoringInput, value: number, cap: ConfidenceResult['cap']): string {
  if (cap.applied && cap.reason) {
    return `Confidence is held at ${Math.round(value * 100)}% because ${cap.reason.charAt(0).toLowerCase()}${cap.reason.slice(1)}`;
  }

  const parts: string[] = [
    `${input.evidence.independentSources} independent ${input.evidence.independentSources === 1 ? 'source' : 'sources'}`,
    `${input.evidence.uniqueEvidence} unique pieces of evidence`,
  ];
  if (input.evidence.counterEvidenceCount > 0) {
    parts.push(`${input.evidence.counterEvidenceCount} contradicting`);
  }
  if (input.uncertainty.criticalUnknownCount > 0) {
    parts.push(`${input.uncertainty.criticalUnknownCount} critical unknowns outstanding`);
  }
  return `${Math.round(value * 100)}% confidence from ${parts.join(', ')}.`;
}

export function describeConfidenceBand(value: number): { label: string; meaning: string } {
  if (value < 0.2) {
    return {
      label: 'Speculative',
      meaning: 'There is not enough evidence here to justify spending anything but a cheap test.',
    };
  }
  if (value < 0.45) {
    return { label: 'Weak', meaning: 'Worth investigating further, not worth building on.' };
  }
  if (value < 0.7) {
    return { label: 'Moderate', meaning: 'Enough to justify a real experiment with real people.' };
  }
  return { label: 'Strong', meaning: 'Well-evidenced. Remaining risk is mostly in execution.' };
}
