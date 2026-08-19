import type { AllocationResult, CapitalRequirement, RankedCandidate } from './index';

export interface CapitalUnlock {
  candidateId: string;
  subjectId: string | null;
  title: string;
  kind: RankedCandidate['kind'];
  requiredBudget: number;
  additionalBudgetNeeded: number | null;
  timeNeededDays: number;
  confidence: number;
  expectedReturn: number;
  requirements: CapitalRequirement[];
  blockers: string[];
}

export interface UnknownCapitalCandidate {
  candidateId: string;
  subjectId: string | null;
  title: string;
  kind: RankedCandidate['kind'];
  timeNeededDays: number;
  confidence: number;
  expectedReturn: number;
  reason: string;
}

export interface CapitalUnlockReport {
  currentBudget: number | null;
  horizonDays: number;
  unlocks: CapitalUnlock[];
  unknownCapital: UnknownCapitalCandidate[];
}

function blockersFor(candidate: RankedCandidate, result: AllocationResult): string[] {
  const blockers: string[] = [];
  const availableDays = result.resources.days === null
    ? result.horizonDays
    : Math.min(result.resources.days, result.horizonDays);

  if (candidate.costDays > availableDays) {
    blockers.push(`Needs ${candidate.costDays} days; ${availableDays} are available in this horizon.`);
  }
  if (candidate.blockedBy.length > 0) {
    blockers.push(`Depends on ${candidate.blockedBy.length} earlier piece(s) of work.`);
  }
  if (candidate.kind === 'build' && candidate.confidence < 0.5) {
    blockers.push(`Confidence is ${Math.round(candidate.confidence * 100)}%; validate before building.`);
  }

  return blockers;
}

/**
 * Explains what additional capital would unlock using only recorded candidate
 * costs. Unknown cash requirements stay unknown; they are never coerced to £0.
 */
export function deriveCapitalUnlockReport(result: AllocationResult): CapitalUnlockReport {
  const currentBudget = result.resources.money;
  const baseline = currentBudget ?? 0;

  const unlocks = result.ranked
    .filter((candidate) => candidate.capitalCostKnown !== false)
    .filter((candidate) => candidate.costMoney > baseline)
    .map((candidate): CapitalUnlock => ({
      candidateId: candidate.id,
      subjectId: candidate.subjectId,
      title: candidate.title,
      kind: candidate.kind,
      requiredBudget: candidate.costMoney,
      additionalBudgetNeeded: currentBudget === null
        ? null
        : Math.max(0, candidate.costMoney - currentBudget),
      timeNeededDays: candidate.costDays,
      confidence: candidate.confidence,
      expectedReturn: candidate.expectedReturn,
      requirements: candidate.capitalRequirements ?? [],
      blockers: blockersFor(candidate, result),
    }))
    .sort((a, b) =>
      a.requiredBudget - b.requiredBudget || b.expectedReturn - a.expectedReturn,
    );

  const unknownCapital = result.ranked
    .filter((candidate) => candidate.capitalCostKnown === false)
    .map((candidate): UnknownCapitalCandidate => ({
      candidateId: candidate.id,
      subjectId: candidate.subjectId,
      title: candidate.title,
      kind: candidate.kind,
      timeNeededDays: candidate.costDays,
      confidence: candidate.confidence,
      expectedReturn: candidate.expectedReturn,
      reason: 'Cash requirement has not been evidenced yet.',
    }))
    .sort((a, b) => b.expectedReturn - a.expectedReturn);

  return {
    currentBudget,
    horizonDays: result.horizonDays,
    unlocks,
    unknownCapital,
  };
}
