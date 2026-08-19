import { describe, expect, it } from 'vitest';
import {
  availableTimeForHorizon,
  readCapitalPlan,
} from '../../src/application/intelligence/allocate-resources';
import { deriveCapitalUnlockReport } from '../../src/domain/allocation/capital';
import { allocate, type AllocationCandidate } from '../../src/domain/allocation/index';

function candidate(overrides: Partial<AllocationCandidate> = {}): AllocationCandidate {
  return {
    id: overrides.id ?? 'candidate',
    subjectType: overrides.subjectType ?? 'opportunity',
    subjectId: overrides.subjectId ?? 'opp-1',
    kind: overrides.kind ?? 'build',
    title: overrides.title ?? 'Candidate',
    attractiveness: overrides.attractiveness ?? 80,
    fit: overrides.fit ?? 80,
    confidence: overrides.confidence ?? 0.8,
    costDays: overrides.costDays ?? 5,
    costMoney: overrides.costMoney ?? 0,
    capitalCostKnown: overrides.capitalCostKnown,
    capitalRequirements: overrides.capitalRequirements,
    goalAlignment: overrides.goalAlignment ?? 0.8,
    executionRisk: overrides.executionRisk ?? 0.2,
    learningValue: overrides.learningValue ?? 0.3,
    dependsOn: overrides.dependsOn,
  };
}

describe('recorded capital plans', () => {
  it('accepts an explicit GBP plan and keeps its spending breakdown', () => {
    const plan = readCapitalPlan({
      capitalPlan: {
        currency: 'GBP',
        required: 750,
        requirements: [
          {
            category: 'data',
            label: 'Paid dataset',
            amount: 500,
            note: 'Needed for the first validation cohort.',
            evidenceRefs: ['evidence:1'],
          },
          { category: 'infrastructure', label: 'Processing', amount: 250 },
        ],
      },
    });

    expect(plan?.required).toBe(750);
    expect(plan?.requirements).toHaveLength(2);
    expect(plan?.requirements[0]?.label).toBe('Paid dataset');
  });

  it('rejects unsupported currencies and malformed amounts instead of guessing', () => {
    expect(readCapitalPlan({ capitalPlan: { currency: 'USD', required: 100 } })).toBeNull();
    expect(readCapitalPlan({ capitalPlan: { currency: 'GBP', required: 'unknown' } })).toBeNull();
  });
});

describe('recurring time capacity', () => {
  it('scales weekly availability to the allocation horizon', () => {
    const resource = { amount: 7, committed: 0, period: 'week' as const };
    expect(availableTimeForHorizon(resource, 7)).toBe(7);
    expect(availableTimeForHorizon(resource, 30)).toBe(30);
  });

  it('scales monthly availability down for a short horizon', () => {
    const resource = { amount: 20, committed: 0, period: 'month' as const };
    expect(availableTimeForHorizon(resource, 7)).toBeCloseTo(20 * (7 / 30));
  });

  it('does not repeat a one-off time allowance', () => {
    const resource = { amount: 12, committed: 2, period: 'once' as const };
    expect(availableTimeForHorizon(resource, 30)).toBe(10);
  });
});

describe('capital unlock analysis', () => {
  it('shows exact paid unlocks and keeps unknown cash requirements separate', () => {
    const result = allocate(
      [
        candidate({
          id: 'free-test',
          kind: 'validate',
          title: 'Free validation',
          costMoney: 0,
          capitalCostKnown: true,
        }),
        candidate({
          id: 'paid',
          title: 'Paid opportunity',
          costMoney: 500,
          capitalCostKnown: true,
          capitalRequirements: [
            { category: 'distribution', label: 'Customer acquisition test', amount: 500 },
          ],
        }),
        candidate({
          id: 'unknown',
          title: 'Unknown-capital opportunity',
          costMoney: 0,
          capitalCostKnown: false,
        }),
      ],
      { days: 30, money: 0 },
      30,
    );

    const report = deriveCapitalUnlockReport(result);

    expect(report.currentBudget).toBe(0);
    expect(report.unlocks).toHaveLength(1);
    expect(report.unlocks[0]?.requiredBudget).toBe(500);
    expect(report.unlocks[0]?.additionalBudgetNeeded).toBe(500);
    expect(report.unlocks[0]?.requirements[0]?.label).toBe('Customer acquisition test');
    expect(report.unknownCapital.map((item) => item.candidateId)).toEqual(['unknown']);
  });

  it('does not treat an unknown cash requirement as affordable against a finite budget', () => {
    const result = allocate(
      [candidate({ capitalCostKnown: false, costMoney: 0 })],
      { days: 30, money: 10_000 },
      30,
    );

    expect(result.ranked[0]?.affordable).toBe(false);
    expect(result.ranked[0]?.rationale).toContain('cash requirement has not been evidenced');
    expect(result.recommendation).toBeNull();
  });
});
