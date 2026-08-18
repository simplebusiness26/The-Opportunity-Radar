import { describe, expect, it } from 'vitest';
import {
  allocate,
  DEFAULT_POLICY,
  expectedValue,
  returnPerDay,
  type AllocationCandidate,
} from '../../src/domain/allocation/index';

function candidate(overrides: Partial<AllocationCandidate> = {}): AllocationCandidate {
  return {
    id: overrides.id ?? 'c1',
    subjectType: overrides.subjectType ?? 'opportunity',
    subjectId: overrides.subjectId ?? 'opp-1',
    kind: overrides.kind ?? 'build',
    title: overrides.title ?? 'A candidate',
    attractiveness: overrides.attractiveness ?? 70,
    fit: overrides.fit ?? 70,
    confidence: overrides.confidence ?? 0.7,
    costDays: overrides.costDays ?? 5,
    costMoney: overrides.costMoney ?? 100,
    goalAlignment: overrides.goalAlignment ?? 0.6,
    executionRisk: overrides.executionRisk ?? 0.3,
    learningValue: overrides.learningValue ?? 0.3,
    dependsOn: overrides.dependsOn,
  };
}

const PLENTY = { days: 30, money: 5000 };

describe('expected value', () => {
  it('discounts a thesis by how sure we are of it', () => {
    const sure = candidate({ confidence: 0.9 });
    const guess = candidate({ confidence: 0.2 });
    expect(expectedValue(sure)).toBeGreaterThan(expectedValue(guess));
  });

  it('lets a modest, well-evidenced idea beat a spectacular guess', () => {
    // Averaging score and confidence would let the guess win. Multiplying is
    // what stops the engine chasing the most exciting unknown.
    const spectacularGuess = candidate({ attractiveness: 98, fit: 95, confidence: 0.15 });
    const solidFact = candidate({ attractiveness: 68, fit: 70, confidence: 0.85 });
    expect(expectedValue(solidFact)).toBeGreaterThan(expectedValue(spectacularGuess));
  });

  it('credits what is learned regardless of the outcome', () => {
    const informative = candidate({ kind: 'validate', learningValue: 0.9, confidence: 0.3 });
    const blind = candidate({ kind: 'validate', learningValue: 0.05, confidence: 0.3 });
    expect(expectedValue(informative)).toBeGreaterThan(expectedValue(blind));
  });

  it('rewards cheapness through return per day', () => {
    const quick = candidate({ costDays: 2 });
    const slow = candidate({ costDays: 20 });
    expect(returnPerDay(quick)).toBeGreaterThan(returnPerDay(slow));
  });
});

describe('allocating the next stretch of effort', () => {
  it('prefers a cheap decisive test to an expensive build', () => {
    const result = allocate(
      [
        candidate({
          id: 'build',
          kind: 'build',
          title: 'Build the product',
          costDays: 21,
          confidence: 0.6,
          learningValue: 0.2,
        }),
        candidate({
          id: 'test',
          kind: 'validate',
          title: 'Talk to ten practice managers',
          costDays: 2,
          costMoney: 30,
          confidence: 0.6,
          learningValue: 0.9,
        }),
      ],
      PLENTY,
      7,
    );

    expect(result.recommendation?.id).toBe('test');
    expect(result.explanation).toContain('Best use of the next 7 days');
  });

  it('refuses to recommend building on thin evidence, however attractive', () => {
    const result = allocate(
      [
        candidate({
          id: 'shiny',
          kind: 'build',
          title: 'The exciting one',
          attractiveness: 95,
          fit: 90,
          confidence: 0.2,
        }),
      ],
      PLENTY,
      7,
    );

    expect(result.recommendation).toBeNull();
    expect(result.notYet[0]?.title).toBe('The exciting one');
    expect(result.notYet[0]?.reason).toContain('Reduce the uncertainty');
  });

  /** Acceptance test (d): weak evidence must produce an explicit refusal. */
  it('says plainly that nothing warrants action when everything is thin', () => {
    const result = allocate(
      [
        candidate({ id: 'a', kind: 'build', attractiveness: 88, confidence: 0.15 }),
        candidate({ id: 'b', kind: 'build', attractiveness: 76, confidence: 0.2 }),
      ],
      PLENTY,
      7,
    );

    expect(result.recommendation).toBeNull();
    expect(result.noActionReason).toContain(
      'NO HIGH-CONFIDENCE OPPORTUNITY CURRENTLY WARRANTS ACTION',
    );
    expect(result.noActionReason).toContain('gather evidence');
  });

  it('says nothing is affordable when nothing is', () => {
    const result = allocate(
      [candidate({ costDays: 40, costMoney: 9000 })],
      { days: 3, money: 50 },
      3,
    );

    expect(result.recommendation).toBeNull();
    expect(result.noActionReason).toContain('costs more than');
  });

  it('reports having nothing to compare rather than inventing something', () => {
    const result = allocate([], PLENTY, 7);
    expect(result.recommendation).toBeNull();
    expect(result.noActionReason).toContain('nothing to compare');
  });

  it('holds back work that depends on something not yet done', () => {
    const result = allocate(
      [
        candidate({
          id: 'second',
          title: 'Second',
          dependsOn: ['first'],
          costDays: 2,
          learningValue: 0.9,
          kind: 'validate',
        }),
        candidate({ id: 'first', title: 'First', costDays: 3, kind: 'validate', learningValue: 0.5 }),
      ],
      PLENTY,
      7,
    );

    expect(result.recommendation?.id).toBe('first');
    const second = result.ranked.find((entry) => entry.id === 'second');
    expect(second?.blockedBy).toEqual(['first']);
  });

  it('ranks improving an existing product against starting a new one', () => {
    const result = allocate(
      [
        candidate({
          id: 'new',
          kind: 'build',
          title: 'Start something new',
          attractiveness: 80,
          fit: 55,
          confidence: 0.55,
          costDays: 18,
        }),
        candidate({
          id: 'improve',
          kind: 'improve_existing',
          title: 'Add a feature customers are asking for',
          attractiveness: 65,
          fit: 90,
          confidence: 0.85,
          costDays: 4,
        }),
      ],
      PLENTY,
      7,
    );

    // The whole point of the engine: sometimes the answer is not a new product.
    expect(result.recommendation?.id).toBe('improve');
    expect(result.recommendation?.kind).toBe('improve_existing');
  });

  it('explains every candidate, including the ones it rejected', () => {
    const result = allocate(
      [
        candidate({ id: 'a', costDays: 2, kind: 'validate', learningValue: 0.8 }),
        candidate({ id: 'b', costDays: 90 }),
      ],
      { days: 7, money: 200 },
      7,
    );

    for (const entry of result.ranked) {
      expect(entry.rationale.length).toBeGreaterThan(10);
    }
    expect(result.ranked.find((entry) => entry.id === 'b')?.rationale).toContain('more than');
  });

  it('respects a raised confidence bar', () => {
    const candidates = [candidate({ kind: 'build', confidence: 0.55 })];

    expect(allocate(candidates, PLENTY, 7, DEFAULT_POLICY).recommendation).not.toBeNull();
    expect(
      allocate(candidates, PLENTY, 7, { ...DEFAULT_POLICY, minimumConfidenceToBuild: 0.8 })
        .recommendation,
    ).toBeNull();
  });
});
