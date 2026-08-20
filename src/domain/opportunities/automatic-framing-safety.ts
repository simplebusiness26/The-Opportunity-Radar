import type { SignalTypeKey } from '../taxonomy/signal-types';

const EXCLUDED_AUTOMATIC_OPPORTUNITY_PATTERNS: readonly RegExp[] = [
  /\b(?:casino|sports betting|bookmaker|online betting|prediction market)\b/i,
  /\b(?:firearm|firearms|gun|guns|ammunition|silencer|switchblade|taser)\b/i,
  /\b(?:cannabis|marijuana|thc|cocaine|heroin|methamphetamine|psychedelic|magic mushrooms)\b/i,
  /\b(?:vape|vaping|nicotine|cigarette|tobacco)\b/i,
  /\b(?:beer|wine|liquor|spirits|alcohol delivery|alcohol subscription)\b/i,
  /\b(?:pornography|pornographic|adult content|adult entertainment)\b/i,
  /\b(?:dangerous challenge|stunt challenge|extreme stunt)\b/i,
];

/** Product/news activity is useful market intelligence, but it is not customer pain. */
const SOURCE_ACTIVITY_ONLY_PATTERNS: readonly RegExp[] = [
  /^\s*(?:show|launch|tell)\s+hn\s*:/i,
  /^\s*(?:introducing|announcing|released?|launching|open[- ]sourcing)\b/i,
  /^\s*(?:github|gitlab)\s*:\s*/i,
  /\b(?:new release|release notes|changelog|version\s+\d+(?:\.\d+)*)\b/i,
];

const EXPLICIT_PAIN_PATTERNS: readonly RegExp[] = [
  /\b(?:losing|we lose|lost|wastes?|wasting|frustrating|nightmare|struggl(?:e|ing)|broken|keeps? failing)\b/i,
  /\b(?:too slow|too expensive|takes? hours|takes? days|manual(?:ly)?|by hand|miss(?:ing|ed)?|cannot|can't|unable to)\b/i,
  /\b(?:pain point|problem|complaint|hate|annoying|difficult|hard to|fails? to)\b/i,
];

export const PROBLEM_PROOF_SIGNAL_TYPES: ReadonlySet<SignalTypeKey> = new Set([
  'pain',
  'demand',
  'spending',
  'workaround',
  'labour',
  'competitor_weakness',
  'supply_gap',
  'regulation',
]);

export const COMMERCIAL_PROOF_SIGNAL_TYPES: ReadonlySet<SignalTypeKey> = new Set([
  'demand',
  'spending',
  'workaround',
  'labour',
  'competitor_weakness',
  'supply_gap',
]);

export const ECONOMIC_PROOF_SIGNAL_TYPES: ReadonlySet<SignalTypeKey> = new Set([
  'spending',
  'labour',
  'supply_gap',
]);

/**
 * Automatic framing is intentionally narrower than passive evidence storage.
 *
 * Radar may observe public discussion for many reasons, but the autonomous
 * system must not convert age-restricted or inherently dangerous material into
 * a business recommendation. This gate runs before a problem cluster can be
 * promoted automatically. Manual moderation can evolve independently without
 * weakening the autonomous boundary.
 */
export function isEligibleForAutomaticOpportunityFraming(text: string): boolean {
  return !EXCLUDED_AUTOMATIC_OPPORTUNITY_PATTERNS.some((pattern) => pattern.test(text));
}

export function looksLikeSourceActivityOnly(text: string): boolean {
  return SOURCE_ACTIVITY_ONLY_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

/**
 * A problem cluster must be made from actual problem evidence, not merely
 * discussion volume. Legacy rows classified as `pain` are re-checked against
 * explicit problem language so old product-launch false positives cannot leak
 * through after this rule ships.
 */
export function isEligibleForAutomaticProblemClustering(
  text: string,
  signalTypeKey: SignalTypeKey,
): boolean {
  if (!isEligibleForAutomaticOpportunityFraming(text)) return false;
  if (looksLikeSourceActivityOnly(text)) return false;
  if (!PROBLEM_PROOF_SIGNAL_TYPES.has(signalTypeKey)) return false;
  if (signalTypeKey === 'pain' && !EXPLICIT_PAIN_PATTERNS.some((pattern) => pattern.test(text))) {
    return false;
  }
  return true;
}

export interface CommercialEvidenceLike {
  signalTypeKey: SignalTypeKey;
  claimText: string;
  bodyText: string;
  originKeys: string[];
}

export interface CommercialQualification {
  eligible: boolean;
  reason: string;
  problemProofCount: number;
  commercialProofCount: number;
  economicProofCount: number;
  independentOrigins: number;
  strongestSignalType: SignalTypeKey | null;
}

const SIGNAL_PRIORITY: readonly SignalTypeKey[] = [
  'spending',
  'labour',
  'supply_gap',
  'workaround',
  'demand',
  'competitor_weakness',
  'regulation',
  'pain',
];

/**
 * The opportunity feed is deliberately stricter than the problem feed.
 *
 * Two independent pieces of genuine problem evidence are necessary, and at
 * least one must show a commercial mechanism: active demand, money/labour,
 * a workaround, a supply gap, or a repeated weakness in something people use.
 * Pure trends and product chatter can never satisfy this gate.
 */
export function qualifyCommercialOpportunity(
  evidence: readonly CommercialEvidenceLike[],
): CommercialQualification {
  const usable = evidence.filter((row) =>
    isEligibleForAutomaticProblemClustering(
      `${row.claimText} ${row.bodyText}`,
      row.signalTypeKey,
    ),
  );
  const problemProofCount = usable.length;
  const commercialProof = usable.filter((row) => COMMERCIAL_PROOF_SIGNAL_TYPES.has(row.signalTypeKey));
  const economicProof = usable.filter((row) => ECONOMIC_PROOF_SIGNAL_TYPES.has(row.signalTypeKey));
  const origins = new Set(usable.flatMap((row) => row.originKeys).filter(Boolean));
  const strongestSignalType =
    SIGNAL_PRIORITY.find((type) => usable.some((row) => row.signalTypeKey === type)) ?? null;

  if (problemProofCount < 2) {
    return {
      eligible: false,
      reason: 'Fewer than two pieces of evidence describe a real problem.',
      problemProofCount,
      commercialProofCount: commercialProof.length,
      economicProofCount: economicProof.length,
      independentOrigins: origins.size,
      strongestSignalType,
    };
  }
  if (origins.size < 2) {
    return {
      eligible: false,
      reason: 'The problem has not been corroborated by two independent origins.',
      problemProofCount,
      commercialProofCount: commercialProof.length,
      economicProofCount: economicProof.length,
      independentOrigins: origins.size,
      strongestSignalType,
    };
  }
  if (commercialProof.length < 1) {
    return {
      eligible: false,
      reason: 'There is repeated pain, but no evidence yet of demand, spending, a workaround, paid labour, a supply gap, or a weak incumbent.',
      problemProofCount,
      commercialProofCount: 0,
      economicProofCount: economicProof.length,
      independentOrigins: origins.size,
      strongestSignalType,
    };
  }

  return {
    eligible: true,
    reason: economicProof.length > 0
      ? 'The problem is independently corroborated and has an economic signal.'
      : 'The problem is independently corroborated and has a concrete commercial-behaviour signal.',
    problemProofCount,
    commercialProofCount: commercialProof.length,
    economicProofCount: economicProof.length,
    independentOrigins: origins.size,
    strongestSignalType,
  };
}

export function describeCommercialOpening(problemStatement: string, signalType: SignalTypeKey | null): string {
  const problem = problemStatement.replace(/^Repeated independent evidence indicates this problem:\s*/i, '').trim();
  const prefix = (() => {
    switch (signalType) {
      case 'spending':
        return 'Compete for money already being spent by solving this specific problem better, more simply, or at lower cost';
      case 'labour':
        return 'Turn the paid manual work behind this problem into a focused automated or productised workflow';
      case 'supply_gap':
        return 'Provide the missing capacity or service that current supply is failing to meet';
      case 'workaround':
        return 'Replace the existing manual or stitched-together workaround with one focused workflow';
      case 'demand':
        return 'Test a focused product or service that directly answers the demand being expressed';
      case 'competitor_weakness':
        return 'Build an add-on or alternative that removes the repeated weakness in the current solution';
      case 'regulation':
        return 'Offer a focused way to satisfy the new requirement with less time, risk, or admin';
      default:
        return 'Test a focused product or service against this repeated problem';
    }
  })();
  return `${prefix}: ${problem}`.slice(0, 2000);
}
