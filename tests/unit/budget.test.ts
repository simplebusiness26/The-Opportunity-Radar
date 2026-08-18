import { describe, expect, it } from 'vitest';
import {
  actualCost,
  estimateCost,
  estimateTokens,
  forecastSpend,
  govern,
  periodKeys,
  readBudget,
  type BudgetState,
} from '../../src/domain/budget/index';

function state(overrides: Partial<BudgetState> = {}): BudgetState {
  return {
    limitUsd: overrides.limitUsd ?? 30,
    spentUsd: overrides.spentUsd ?? 0,
    reservedUsd: overrides.reservedUsd ?? 0,
    warnPct: overrides.warnPct ?? 0.7,
    degradePct: overrides.degradePct ?? 0.85,
    criticalPct: overrides.criticalPct ?? 0.95,
  };
}

describe('reading the budget', () => {
  it('moves through the postures as spend rises', () => {
    expect(readBudget(state({ spentUsd: 5 })).posture).toBe('normal');
    expect(readBudget(state({ spentUsd: 21 })).posture).toBe('warn');
    expect(readBudget(state({ spentUsd: 26 })).posture).toBe('degrade');
    expect(readBudget(state({ spentUsd: 29 })).posture).toBe('critical');
    expect(readBudget(state({ spentUsd: 30 })).posture).toBe('stopped');
  });

  it('counts reservations as committed, not as available', () => {
    // Two concurrent callers must not both see the same headroom.
    const held = readBudget(state({ spentUsd: 20, reservedUsd: 9 }));
    expect(held.posture).toBe('critical');
    expect(held.remainingUsd).toBeCloseTo(1, 6);
  });

  it('explains itself in terms of money rather than percentages', () => {
    expect(readBudget(state({ spentUsd: 30 })).explanation).toContain('Manual mode continues');
  });
});

describe('the degradation ladder', () => {
  const work = { role: 'research' as const, optional: true, valueOfInformation: 0.2 };

  it('runs everything normally while there is room', () => {
    const decision = govern(readBudget(state({ spentUsd: 1 })), work);
    expect(decision).toMatchObject({ allowed: true, tier: 'primary', scanDepthFactor: 1 });
  });

  it('reduces scan depth before it reduces quality', () => {
    const decision = govern(readBudget(state({ spentUsd: 22 })), work);
    expect(decision.allowed).toBe(true);
    expect(decision.tier).toBe('primary');
    expect(decision.scanDepthFactor).toBe(0.5);
  });

  it('drops low-value investigation before it drops model quality', () => {
    const degrading = readBudget(state({ spentUsd: 26 }));
    expect(govern(degrading, work).allowed).toBe(false);
    // The same posture still runs work that is actually worth something.
    expect(govern(degrading, { ...work, valueOfInformation: 0.9 }).allowed).toBe(true);
    expect(govern(degrading, { ...work, valueOfInformation: 0.9 }).tier).toBe('degraded');
  });

  it('runs only high-value decisions when nearly spent', () => {
    const critical = readBudget(state({ spentUsd: 29 }));
    expect(govern(critical, { role: 'research', optional: false }).allowed).toBe(false);
    expect(govern(critical, { role: 'high_value_decision', optional: false }).allowed).toBe(true);
  });

  it('stops everything at the limit, and says manual mode still works', () => {
    const stopped = readBudget(state({ spentUsd: 30 }));
    for (const role of ['cheap_extraction', 'high_value_decision', 'embedding'] as const) {
      expect(govern(stopped, { role, optional: false }).allowed).toBe(false);
    }
    // Held rather than failed: the work resumes when the period rolls over.
    expect(govern(stopped, { role: 'reasoning', optional: false }).reason).toContain('held rather than failed');
  });
});

describe('costing a call', () => {
  it('reserves the worst case rather than the expected case', () => {
    const estimate = estimateCost({
      inputTokens: 10_000,
      maxOutputTokens: 4_000,
      inputCostPerMtok: 3,
      outputCostPerMtok: 15,
    });

    // 10k in at $3/M plus 4k out at $15/M.
    expect(estimate.maxCostUsd).toBeCloseTo(0.03 + 0.06, 6);
  });

  it('settles to what was actually used', () => {
    const settled = actualCost({
      inputTokens: 10_000,
      outputTokens: 500,
      inputCostPerMtok: 3,
      outputCostPerMtok: 15,
    });
    expect(settled).toBeCloseTo(0.03 + 0.0075, 6);
  });

  it('treats an unpriced model as zero rather than guessing a price', () => {
    // A fabricated price would be a fabricated metric, which this product does
    // not do. The interface marks such spend as unknown instead.
    expect(
      estimateCost({
        inputTokens: 1000,
        maxOutputTokens: 1000,
        inputCostPerMtok: null,
        outputCostPerMtok: null,
      }).maxCostUsd,
    ).toBe(0);
  });

  it('errs high when counting tokens, since under-reserving is the dangerous direction', () => {
    const text = 'a'.repeat(340);
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(100);
  });
});

describe('forecasting', () => {
  it('projects a range rather than a false point estimate', () => {
    const forecast = forecastSpend({ spentUsd: 10, daysElapsed: 10, daysInPeriod: 30 });
    expect(forecast).not.toBeNull();
    expect(forecast!.projectedUsd[0]).toBeLessThan(forecast!.projectedUsd[1]);
    expect(forecast!.basis).toContain('10 day(s)');
  });

  it('narrows the range as the period progresses', () => {
    const early = forecastSpend({ spentUsd: 3, daysElapsed: 3, daysInPeriod: 30 })!;
    const late = forecastSpend({ spentUsd: 27, daysElapsed: 27, daysInPeriod: 30 })!;

    const earlySpread = (early.projectedUsd[1] - early.projectedUsd[0]) / early.projectedUsd[1];
    const lateSpread = (late.projectedUsd[1] - late.projectedUsd[0]) / late.projectedUsd[1];
    expect(lateSpread).toBeLessThan(earlySpread);
  });

  it('declines to forecast from less than a day', () => {
    expect(forecastSpend({ spentUsd: 5, daysElapsed: 0, daysInPeriod: 30 })).toBeNull();
  });

  it('never projects below what has already been spent', () => {
    const forecast = forecastSpend({ spentUsd: 25, daysElapsed: 29, daysInPeriod: 30 })!;
    expect(forecast.projectedUsd[0]).toBeGreaterThanOrEqual(25);
  });
});

describe('period keys', () => {
  it('produces stable daily and monthly keys', () => {
    expect(periodKeys(new Date('2026-08-18T13:45:00Z'))).toEqual({
      daily: '2026-08-18',
      monthly: '2026-08',
    });
  });
});
