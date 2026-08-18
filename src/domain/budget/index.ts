/**
 * Cost control.
 *
 * The rule this module exists to enforce is simple and absolute: Radar never
 * silently exceeds a budget the owner set. Everything else here -- the ladder,
 * the reservations, the forecast -- follows from taking that seriously.
 */

export type BudgetPosture = 'normal' | 'warn' | 'degrade' | 'critical' | 'stopped';

export interface BudgetState {
  limitUsd: number;
  spentUsd: number;
  reservedUsd: number;
  warnPct: number;
  degradePct: number;
  criticalPct: number;
}

export interface BudgetStatus {
  posture: BudgetPosture;
  /** Committed spend as a fraction of the limit, including reservations. */
  usedFraction: number;
  remainingUsd: number;
  explanation: string;
}

export function readBudget(state: BudgetState): BudgetStatus {
  const committed = state.spentUsd + state.reservedUsd;
  const usedFraction = state.limitUsd > 0 ? committed / state.limitUsd : 1;
  const remainingUsd = Math.max(0, state.limitUsd - committed);

  const posture: BudgetPosture =
    usedFraction >= 1
      ? 'stopped'
      : usedFraction >= state.criticalPct
        ? 'critical'
        : usedFraction >= state.degradePct
          ? 'degrade'
          : usedFraction >= state.warnPct
            ? 'warn'
            : 'normal';

  return { posture, usedFraction, remainingUsd, explanation: explain(posture, state, remainingUsd) };
}

function explain(posture: BudgetPosture, state: BudgetState, remaining: number): string {
  const spent = state.spentUsd.toFixed(2);
  const limit = state.limitUsd.toFixed(2);

  switch (posture) {
    case 'stopped':
      return `Budget spent (${spent} of ${limit}). All optional AI work is stopped until the period rolls over or the limit is raised. Manual mode continues to work normally.`;
    case 'critical':
      return `Only ${remaining.toFixed(2)} of ${limit} remains. Radar is running high-value decisions only and has stopped optional work.`;
    case 'degrade':
      return `${spent} of ${limit} spent. Radar has switched to cheaper models and is skipping low-value investigations.`;
    case 'warn':
      return `${spent} of ${limit} spent. Radar has halved scan depth to make the remainder last.`;
    default:
      return `${spent} of ${limit} spent.`;
  }
}

export type AiRole =
  | 'cheap_extraction'
  | 'classification'
  | 'research'
  | 'reasoning'
  | 'high_value_decision'
  | 'embedding';

export interface WorkPlan {
  role: AiRole;
  /** Optional work is dropped first when money is short. */
  optional: boolean;
  /** 0-1 how much this call would reduce uncertainty; used to triage. */
  valueOfInformation?: number;
}

export interface GovernorDecision {
  allowed: boolean;
  /** Which model tier to use. */
  tier: 'primary' | 'degraded';
  reason: string;
  /** Multiplier on how much source material to process this run. */
  scanDepthFactor: number;
}

/**
 * The degradation ladder.
 *
 * Written as a pure function of posture and the work being asked for, so the
 * behaviour at every level can be asserted exactly rather than observed by
 * spending money. Each rung gives up something specific and says what.
 */
export function govern(status: BudgetStatus, work: WorkPlan): GovernorDecision {
  switch (status.posture) {
    case 'normal':
      return { allowed: true, tier: 'primary', reason: 'Within budget.', scanDepthFactor: 1 };

    case 'warn':
      return {
        allowed: true,
        tier: 'primary',
        reason: 'Approaching the budget; scanning less per run to make it last.',
        scanDepthFactor: 0.5,
      };

    case 'degrade':
      // Low-value investigation is the first thing to go: it is the largest
      // spend with the least certain payoff.
      if (work.optional && (work.valueOfInformation ?? 1) < 0.5) {
        return {
          allowed: false,
          tier: 'degraded',
          reason: 'Budget is tight, so low-value investigations are suppressed.',
          scanDepthFactor: 0.5,
        };
      }
      return {
        allowed: true,
        tier: 'degraded',
        reason: 'Budget is tight, so cheaper models are being used.',
        scanDepthFactor: 0.5,
      };

    case 'critical':
      if (work.role !== 'high_value_decision') {
        return {
          allowed: false,
          tier: 'degraded',
          reason: 'Budget nearly spent; only high-value decisions are still running.',
          scanDepthFactor: 0.25,
        };
      }
      return {
        allowed: true,
        tier: 'degraded',
        reason: 'Budget nearly spent; running this as a high-value decision only.',
        scanDepthFactor: 0.25,
      };

    case 'stopped':
      return {
        allowed: false,
        tier: 'degraded',
        reason:
          'The budget for this period is spent. Work is being held rather than failed, and resumes when the period rolls over or the limit is raised.',
        scanDepthFactor: 0,
      };
  }
}

export interface CostEstimate {
  inputTokens: number;
  maxOutputTokens: number;
  /** The most this call could possibly cost, which is what gets reserved. */
  maxCostUsd: number;
}

/**
 * What a call could cost at worst.
 *
 * The reservation is the maximum rather than the expected cost, deliberately.
 * Reserving an expectation would let a run of long responses walk past the
 * limit before anyone noticed.
 */
export function estimateCost(input: {
  inputTokens: number;
  maxOutputTokens: number;
  inputCostPerMtok: number | null;
  outputCostPerMtok: number | null;
}): CostEstimate {
  // An unpriced model is treated as free rather than guessed at. The interface
  // marks its spend as unknown; inventing a price would be a fabricated metric.
  const inputCost = ((input.inputCostPerMtok ?? 0) * input.inputTokens) / 1_000_000;
  const outputCost = ((input.outputCostPerMtok ?? 0) * input.maxOutputTokens) / 1_000_000;

  return {
    inputTokens: input.inputTokens,
    maxOutputTokens: input.maxOutputTokens,
    maxCostUsd: Number((inputCost + outputCost).toFixed(6)),
  };
}

export function actualCost(input: {
  inputTokens: number;
  outputTokens: number;
  inputCostPerMtok: number | null;
  outputCostPerMtok: number | null;
}): number {
  const inputCost = ((input.inputCostPerMtok ?? 0) * input.inputTokens) / 1_000_000;
  const outputCost = ((input.outputCostPerMtok ?? 0) * input.outputTokens) / 1_000_000;
  return Number((inputCost + outputCost).toFixed(6));
}

/**
 * A rough token count for text, used only to size reservations.
 *
 * Deliberately crude and deliberately labelled as an estimate everywhere it
 * surfaces. It errs high, because under-reserving is what lets a budget be
 * exceeded and over-reserving only makes Radar briefly more cautious.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.4);
}

export interface SpendForecast {
  /** Range rather than a point: a single figure would imply precision. */
  projectedUsd: [number, number];
  basis: string;
}

/**
 * Projects the period's spend from what has been spent so far.
 *
 * Presented as a range because the basis is a trailing mean over a handful of
 * days, which cannot support a point estimate honestly.
 */
export function forecastSpend(input: {
  spentUsd: number;
  daysElapsed: number;
  daysInPeriod: number;
}): SpendForecast | null {
  if (input.daysElapsed < 1) return null;

  const perDay = input.spentUsd / input.daysElapsed;
  const remainingDays = Math.max(0, input.daysInPeriod - input.daysElapsed);
  const central = input.spentUsd + perDay * remainingDays;

  // The spread narrows as the period progresses and the mean firms up.
  const uncertainty = Math.max(0.15, 0.6 - 0.4 * (input.daysElapsed / input.daysInPeriod));

  return {
    projectedUsd: [
      Number(Math.max(input.spentUsd, central * (1 - uncertainty)).toFixed(2)),
      Number((central * (1 + uncertainty)).toFixed(2)),
    ],
    basis: `Based on ${input.spentUsd.toFixed(2)} over ${input.daysElapsed} day(s) of a ${input.daysInPeriod}-day period.`,
  };
}

export function periodKeys(now: Date): { daily: string; monthly: string } {
  const iso = now.toISOString();
  return { daily: iso.slice(0, 10), monthly: iso.slice(0, 7) };
}
