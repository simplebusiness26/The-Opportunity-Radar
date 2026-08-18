import { describe, expect, it } from 'vitest';
import {
  MINIMUM_SAMPLE,
  calibrateDays,
  computeCalibration,
  type ExecutionSample,
} from '../../src/domain/calibration/index';
import {
  describeTrigger,
  evaluateTrigger,
  triggersForRejection,
  type TriggerCandidate,
} from '../../src/domain/memory/triggers';
import {
  isSuppressedBy,
  keywordsFor,
  RELATIONSHIP_KINDS,
} from '../../src/domain/memory/relationships';

function sample(overrides: Partial<ExecutionSample> = {}): ExecutionSample {
  return {
    predictedBuildDays: 10,
    actualBuildDays: 15,
    predictedConfidence: 0.7,
    predictedScore: 70,
    outcome: 'succeeded',
    ...overrides,
  };
}

function candidate(overrides: Partial<TriggerCandidate> = {}): TriggerCandidate {
  return {
    title: 'Restaurant pays for a deposit tool',
    bodyText: 'We now pay 45 a month for something that holds a deposit.',
    signalTypeKey: 'spending',
    evidenceClass: 'direct_customer',
    monthlyAmount: 45,
    ...overrides,
  };
}

describe('calibration', () => {
  it('refuses to calibrate below the minimum sample, and says how many are needed', () => {
    const result = computeCalibration(Array.from({ length: 4 }, () => sample()));

    expect(result.usable).toBe(false);
    expect(result.buildEstimateRatio).toBeNull();
    expect(result.confidenceBias).toBeNull();
    expect(result.refusal).toContain(`4 of ${MINIMUM_SAMPLE}`);
    expect(result.refusal).toContain('4 more');
  });

  it('calibrates once there is enough history', () => {
    const samples = Array.from({ length: MINIMUM_SAMPLE }, () => sample());
    const result = computeCalibration(samples);

    expect(result.usable).toBe(true);
    expect(result.buildEstimateRatio).toBeCloseTo(1.5, 3);
    expect(result.notes.join(' ')).toContain('1.50×');
  });

  it('uses the median, so one runaway project does not become the expectation', () => {
    const samples = [
      ...Array.from({ length: 7 }, () => sample({ predictedBuildDays: 10, actualBuildDays: 11 })),
      sample({ predictedBuildDays: 10, actualBuildDays: 200 }),
    ];

    const result = computeCalibration(samples);
    expect(result.buildEstimateRatio).toBeLessThan(1.5);
  });

  it('reports overconfidence when predictions ran ahead of outcomes', () => {
    const samples = [
      ...Array.from({ length: 6 }, () => sample({ predictedConfidence: 0.8, outcome: 'failed' })),
      ...Array.from({ length: 2 }, () => sample({ predictedConfidence: 0.8, outcome: 'succeeded' })),
    ];

    const result = computeCalibration(samples);
    expect(result.confidenceBias).toBeGreaterThan(0.4);
    expect(result.notes.join(' ')).toContain('more confident than events justified');
  });

  it('leaves an estimate untouched when it cannot justify adjusting it', () => {
    const result = calibrateDays(20, computeCalibration([sample()]));

    expect(result.days).toBe(20);
    expect(result.adjusted).toBe(false);
    expect(result.explanation).toContain('Not enough history');
  });

  it('adjusts an estimate and says what it adjusted it by', () => {
    const calibration = computeCalibration(Array.from({ length: MINIMUM_SAMPLE }, () => sample()));
    const result = calibrateDays(20, calibration);

    expect(result.days).toBe(30);
    expect(result.adjusted).toBe(true);
    expect(result.explanation).toContain('1.50×');
  });
});

describe('re-evaluation triggers', () => {
  it('never fires on a trigger with no conditions', () => {
    // The most dangerous failure available here: a trigger that matches
    // everything would reopen every rejected opportunity on the first scan.
    const verdict = evaluateTrigger({}, candidate());

    expect(verdict.fires).toBe(false);
    expect(verdict.reason).toContain('no conditions');
  });

  it('fires when the evidence satisfies every condition, and says why', () => {
    const verdict = evaluateTrigger(
      { signalTypes: ['spending'], anyOf: ['deposit'], minMonthlyAmount: 20, requireIndependent: true },
      candidate(),
    );

    expect(verdict.fires).toBe(true);
    expect(verdict.reason).toContain('spending');
    expect(verdict.reason).toContain('deposit');
  });

  it('refuses evidence that cannot stand as an independent source', () => {
    const verdict = evaluateTrigger(
      { signalTypes: ['spending'], requireIndependent: true },
      candidate({ evidenceClass: 'ai_derived' }),
    );

    expect(verdict.fires).toBe(false);
    expect(verdict.reason).toContain('independent source');
  });

  it('does not treat a complaint as the spending it is waiting for', () => {
    const verdict = evaluateTrigger(
      { signalTypes: ['spending'], minMonthlyAmount: 1 },
      candidate({ signalTypeKey: 'pain', monthlyAmount: null }),
    );

    expect(verdict.fires).toBe(false);
  });

  it('excludes evidence containing an excluded phrase', () => {
    const verdict = evaluateTrigger(
      { anyOf: ['deposit'], noneOf: ['enterprise'] },
      candidate({ bodyText: 'Their enterprise tier holds a deposit for you.' }),
    );

    expect(verdict.fires).toBe(false);
    expect(verdict.reason).toContain('enterprise');
  });

  it('proposes what would undo the reason it was rejected', () => {
    const proposals = triggersForRejection({
      willingnessToPay: 'absent',
      hasFreeAlternative: true,
      objectionCategories: ['complaints_without_purchase', 'free_substitute'],
      keywords: ['deposits', 'restaurants'],
    });

    expect(proposals.map((proposal) => proposal.kind)).toEqual([
      'spending_observed',
      'free_alternative_withdrawn',
    ]);
    expect(proposals[0]?.predicate.minMonthlyAmount).toBe(1);
    expect(describeTrigger(proposals[0]!.predicate)).toContain('spending signal');
  });

  it('proposes nothing when it has no words to watch for', () => {
    // Better to offer none than to arm a trigger that matches anything.
    const proposals = triggersForRejection({
      willingnessToPay: 'absent',
      hasFreeAlternative: true,
      objectionCategories: [],
      keywords: ['a', 'the'],
    });

    expect(proposals).toEqual([]);
  });
});

describe('opportunity relationships', () => {
  it('suppresses an opportunity that duplicates another', () => {
    const verdict = isSuppressedBy([{ kind: 'duplicate_of', direction: 'from' }]);

    expect(verdict.suppressed).toBe(true);
    expect(verdict.reason).toContain('duplicate');
  });

  it('does not suppress the one being duplicated', () => {
    const verdict = isSuppressedBy([{ kind: 'duplicate_of', direction: 'to' }]);
    expect(verdict.suppressed).toBe(false);
  });

  it('suppresses an opportunity a later version superseded', () => {
    const verdict = isSuppressedBy([{ kind: 'supersedes', direction: 'to' }]);
    expect(verdict.suppressed).toBe(true);
  });

  it('leaves variants and competitors as their own lines of work', () => {
    expect(isSuppressedBy([{ kind: 'variant_of', direction: 'from' }]).suppressed).toBe(false);
    expect(isSuppressedBy([{ kind: 'competes_with', direction: 'from' }]).suppressed).toBe(false);
  });

  it('reads symmetrically where the relationship is symmetric', () => {
    for (const definition of Object.values(RELATIONSHIP_KINDS)) {
      if (definition.symmetric) expect(definition.label).toBe(definition.inverseLabel);
      else expect(definition.label).not.toBe(definition.inverseLabel);
    }
  });

  it('picks out the words that identify what an opportunity is about', () => {
    const words = keywordsFor(
      'Deposit automation for restaurant bookings. Restaurants lose covers to no-shows and deposit handling is manual.',
    );

    expect(words).toContain('deposit');
    // No stemming is claimed, so the assertion does not assume any.
    expect(words.some((word) => word.startsWith('restaurant'))).toBe(true);
    // Common filler must not become a trigger condition.
    expect(words).not.toContain('there');
  });
});
