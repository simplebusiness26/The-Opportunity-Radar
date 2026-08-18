import { EVIDENCE_CLASSES, type EvidenceClass } from '../taxonomy/evidence-class';
import type { SignalTypeKey } from '../taxonomy/signal-types';

/**
 * What would make us look at a rejected idea again.
 *
 * A rejection is a conclusion drawn from the evidence available at the time,
 * and evidence changes. Without this, a rejected opportunity is simply
 * forgotten, and the same idea gets re-discovered from scratch a year later
 * with the same reasoning and the same outcome.
 *
 * The predicate is evaluated deterministically against each new piece of
 * evidence -- no model decides whether a trigger fired -- so a reopening can
 * always be traced to the exact signal that caused it.
 */

export interface TriggerPredicate {
  signalTypes?: SignalTypeKey[];
  evidenceClasses?: EvidenceClass[];
  /** Every phrase must appear. */
  allOf?: string[];
  /** At least one phrase must appear. */
  anyOf?: string[];
  /** None of these may appear. */
  noneOf?: string[];
  /** Observed spending at or above this monthly amount. */
  minMonthlyAmount?: number;
  /** Only evidence that may stand as an independent source counts. */
  requireIndependent?: boolean;
}

export interface TriggerCandidate {
  title: string;
  bodyText: string;
  signalTypeKey: SignalTypeKey;
  evidenceClass: EvidenceClass;
  monthlyAmount: number | null;
}

export type TriggerVerdict =
  | { fires: true; reason: string }
  | { fires: false; reason: string };

/**
 * Whether this piece of evidence satisfies the trigger.
 *
 * An empty predicate never fires. That is the single most important rule here:
 * a trigger that matches everything would reopen every rejected opportunity on
 * the first scan, and the failure would look like the feature working.
 */
export function evaluateTrigger(
  predicate: TriggerPredicate,
  candidate: TriggerCandidate,
): TriggerVerdict {
  if (!hasAnyCondition(predicate)) {
    return { fires: false, reason: 'The trigger has no conditions, so nothing can satisfy it.' };
  }

  const haystack = `${candidate.title}\n${candidate.bodyText}`.toLowerCase();
  const met: string[] = [];

  if (predicate.signalTypes?.length) {
    if (!predicate.signalTypes.includes(candidate.signalTypeKey)) {
      return {
        fires: false,
        reason: `The evidence is a ${candidate.signalTypeKey} signal, and the trigger watches for ${predicate.signalTypes.join(' or ')}.`,
      };
    }
    met.push(`it is a ${candidate.signalTypeKey} signal`);
  }

  if (predicate.evidenceClasses?.length) {
    if (!predicate.evidenceClasses.includes(candidate.evidenceClass)) {
      return {
        fires: false,
        reason: `The evidence is ${candidate.evidenceClass}, and the trigger requires ${predicate.evidenceClasses.join(' or ')}.`,
      };
    }
    met.push(`it is ${candidate.evidenceClass} evidence`);
  }

  if (predicate.requireIndependent && !EVIDENCE_CLASSES[candidate.evidenceClass]?.countsAsIndependent) {
    return {
      fires: false,
      reason: 'The trigger requires evidence that can stand as an independent source, and this cannot.',
    };
  }

  for (const phrase of predicate.noneOf ?? []) {
    if (haystack.includes(phrase.toLowerCase())) {
      return { fires: false, reason: `The evidence mentions "${phrase}", which the trigger excludes.` };
    }
  }

  const missing = (predicate.allOf ?? []).filter((phrase) => !haystack.includes(phrase.toLowerCase()));
  if (missing.length > 0) {
    return { fires: false, reason: `The evidence does not mention ${missing.map(quote).join(' or ')}.` };
  }
  if (predicate.allOf?.length) met.push(`it mentions ${predicate.allOf.map(quote).join(' and ')}`);

  if (predicate.anyOf?.length) {
    const matched = predicate.anyOf.filter((phrase) => haystack.includes(phrase.toLowerCase()));
    if (matched.length === 0) {
      return {
        fires: false,
        reason: `The evidence mentions none of ${predicate.anyOf.map(quote).join(', ')}.`,
      };
    }
    met.push(`it mentions ${matched.map(quote).join(' and ')}`);
  }

  if (typeof predicate.minMonthlyAmount === 'number') {
    if (candidate.monthlyAmount === null || candidate.monthlyAmount < predicate.minMonthlyAmount) {
      return {
        fires: false,
        reason:
          candidate.monthlyAmount === null
            ? 'The trigger waits for observed spending, and this evidence records none.'
            : `Observed spending of ${candidate.monthlyAmount} is below the ${predicate.minMonthlyAmount} the trigger waits for.`,
      };
    }
    met.push(`observed spending of ${candidate.monthlyAmount} meets the ${predicate.minMonthlyAmount} threshold`);
  }

  return { fires: true, reason: `Fired because ${met.join(', and ')}.` };
}

export function hasAnyCondition(predicate: TriggerPredicate): boolean {
  return Boolean(
    predicate.signalTypes?.length ||
      predicate.evidenceClasses?.length ||
      predicate.allOf?.length ||
      predicate.anyOf?.length ||
      predicate.requireIndependent ||
      typeof predicate.minMonthlyAmount === 'number',
  );
}

/** A sentence describing what the trigger is waiting for, for the interface. */
export function describeTrigger(predicate: TriggerPredicate): string {
  if (!hasAnyCondition(predicate)) return 'Nothing: this trigger has no conditions and will never fire.';

  const parts: string[] = [];
  if (predicate.signalTypes?.length) parts.push(`a ${predicate.signalTypes.join(' or ')} signal`);
  if (predicate.evidenceClasses?.length) parts.push(`from ${predicate.evidenceClasses.join(' or ')}`);
  if (predicate.requireIndependent) parts.push('that can stand as an independent source');
  if (predicate.allOf?.length) parts.push(`mentioning ${predicate.allOf.map(quote).join(' and ')}`);
  if (predicate.anyOf?.length) parts.push(`mentioning any of ${predicate.anyOf.map(quote).join(', ')}`);
  if (predicate.noneOf?.length) parts.push(`not mentioning ${predicate.noneOf.map(quote).join(' or ')}`);
  if (typeof predicate.minMonthlyAmount === 'number') {
    parts.push(`recording spending of at least ${predicate.minMonthlyAmount} a month`);
  }

  return parts.join(', ');
}

function quote(value: string): string {
  return `"${value}"`;
}

/**
 * The triggers a rejection implies, derived from why it was rejected.
 *
 * Deterministic on purpose. The reasons Radar rejects things are its own, so
 * the conditions that would undo them are known without asking a model, and a
 * trigger derived this way can be explained in one sentence.
 */
export interface ProposedTrigger {
  kind: string;
  description: string;
  predicate: TriggerPredicate;
}

export function triggersForRejection(input: {
  willingnessToPay: string | null;
  hasFreeAlternative: boolean;
  objectionCategories: readonly string[];
  /** Words that identify this problem, for the phrase conditions. */
  keywords: readonly string[];
}): ProposedTrigger[] {
  const proposed: ProposedTrigger[] = [];
  const keywords = input.keywords.filter((word) => word.length > 3).slice(0, 4);
  if (keywords.length === 0) return proposed;

  if (input.willingnessToPay === 'absent' || input.willingnessToPay === 'contradicted') {
    proposed.push({
      kind: 'spending_observed',
      description: 'Someone is observed paying for this after all.',
      predicate: {
        signalTypes: ['spending'],
        anyOf: [...keywords],
        requireIndependent: true,
        minMonthlyAmount: 1,
      },
    });
  }

  if (input.hasFreeAlternative || input.objectionCategories.includes('free_substitute')) {
    proposed.push({
      kind: 'free_alternative_withdrawn',
      description: 'The free alternative starts charging, closes, or becomes unavailable.',
      predicate: {
        signalTypes: ['cost_collapse', 'competitor_weakness'],
        anyOf: [...keywords],
        requireIndependent: true,
      },
    });
  }

  if (input.objectionCategories.includes('regulatory_barrier')) {
    proposed.push({
      kind: 'regulation_changed',
      description: 'The rule that blocked this changes.',
      predicate: { signalTypes: ['regulation'], anyOf: [...keywords], requireIndependent: true },
    });
  }

  if (input.objectionCategories.includes('technical_barrier')) {
    proposed.push({
      kind: 'technology_unlocked',
      description: 'The technical obstacle stops being one.',
      predicate: { signalTypes: ['technology_unlock'], anyOf: [...keywords], requireIndependent: true },
    });
  }

  return proposed;
}
