import { describe, expect, it } from 'vitest';
import { DIMENSIONS } from '../../src/domain/scoring/dimensions';
import { diffScores, digestInput, scoreOpportunity } from '../../src/domain/scoring/engine';
import { NO_INDEPENDENT_SOURCE_CEILING, SINGLE_SOURCE_CEILING } from '../../src/domain/scoring/confidence';
import { scoringInput } from './helpers/scoring-input';

describe('dimension registry', () => {
  it('gives every dimension a distinct key', () => {
    const keys = DIMENSIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('covers the full range of judgement the product claims to make', () => {
    const composites = new Set(DIMENSIONS.map((d) => d.composite));
    for (const required of [
      'attractiveness',
      'fit',
      'leverage',
      'timing',
      'validation_efficiency',
      'strategic_value',
      'execution_risk',
    ]) {
      expect(composites.has(required as never)).toBe(true);
    }
  });

  /**
   * The separation the whole product rests on. If a certainty measure ever
   * feeds attractiveness, "excellent but unproven" becomes unsayable.
   */
  it('never lets a certainty measure feed attractiveness', () => {
    const certaintyInputs = [
      'independentSources',
      'sourceDiversity',
      'freshness',
      'counterEvidenceCount',
      'criticalUnknownCount',
      'calibration',
    ];

    for (const dimension of DIMENSIONS.filter((d) => d.composite === 'attractiveness')) {
      const source = dimension.compute.toString();
      for (const forbidden of certaintyInputs) {
        expect(
          source.includes(forbidden),
          `${dimension.key} reads ${forbidden}, which belongs to confidence`,
        ).toBe(false);
      }
    }
  });

  it('returns a usable result for an entirely empty input', () => {
    for (const dimension of DIMENSIONS) {
      const result = dimension.compute(scoringInput());
      expect(['ok', 'insufficient_evidence', 'not_applicable']).toContain(result.status);
      expect(result.explanation.length).toBeGreaterThan(10);
    }
  });

  it('always normalises into range', () => {
    const rich = scoringInput({
      evidence: {
        rawMentions: 500,
        uniqueEvidence: 200,
        independentSources: 90,
        sourceDiversity: 1,
        aiDerivedMentions: 0,
        strengthByType: { pain: 50, spending: 50, labour: 50 },
        countByClass: { direct_customer: 100 },
        freshness: 1,
        counterEvidenceCount: 0,
        counterEvidenceStrength: 0,
      },
      market: { competitorCount: 0, freeAlternativeCount: 0, competitorWeaknessCount: 99, observedMonthlySpend: [99999], momentum30d: 10 },
      internal: { capabilityCoverage: 1, requiredCapabilityCount: 10, missingCapabilityCount: 0, reusableAssetCount: 50, hasDistribution: true, hasDomainExperience: true, priorRelatedOutcomes: { successes: 20, failures: 0 } },
      economics: { estimatedMvpDaysGreenfield: [1, 2], estimatedMvpDaysLeveraged: [1, 2], estimatedValidationCost: 1, estimatedValidationDays: 1, availableBudget: 100000, availableDays: 365 },
    });

    for (const dimension of DIMENSIONS) {
      const result = dimension.compute(rich);
      if (result.normalised !== null) {
        expect(result.normalised).toBeGreaterThanOrEqual(0);
        expect(result.normalised).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('missing evidence', () => {
  /**
   * Scoring absent evidence as zero would make an unexamined opportunity look
   * identical to one that was examined and found wanting.
   */
  it('reports willingness to pay as unknown, not as zero, when nothing is known', () => {
    const result = scoreOpportunity(scoringInput());
    const wtp = result.dimensions.find((d) => d.key === 'willingness_to_pay');

    expect(wtp?.status).toBe('insufficient_evidence');
    expect(wtp?.normalised).toBeNull();
    expect(result.gaps.map((gap) => gap.key)).toContain('willingness_to_pay');
  });

  it('redistributes the weight of unmeasurable dimensions rather than counting them as zero', () => {
    const partial = scoringInput({
      evidence: {
        rawMentions: 10,
        uniqueEvidence: 8,
        independentSources: 4,
        sourceDiversity: 0.8,
        aiDerivedMentions: 0,
        strengthByType: { pain: 2.5, workaround: 1.5 },
        countByClass: { direct_customer: 8 },
        freshness: 1,
        counterEvidenceCount: 0,
        counterEvidenceStrength: 0,
      },
    });

    const result = scoreOpportunity(partial);
    const attractiveness = result.composites.attractiveness;

    expect(attractiveness.value).not.toBeNull();
    // Strong pain evidence should not be dragged down by unmeasured dimensions.
    expect(attractiveness.value!).toBeGreaterThan(30);
    expect(attractiveness.coverage).toBeLessThan(1);
    expect(attractiveness.gaps.length).toBeGreaterThan(0);
  });

  it('reports a composite as null when nothing in it could be measured', () => {
    const result = scoreOpportunity(scoringInput());
    expect(result.composites.leverage.value).toBeNull();
    expect(result.composites.leverage.coverage).toBe(0);
  });
});

/** Market facts good enough that the decisive dimensions are actually measured. */
const MEASURED_MARKET = {
  competitorCount: 3,
  freeAlternativeCount: 0,
  competitorWeaknessCount: 4,
  observedMonthlySpend: [220, 180, 260],
  momentum30d: 0.2,
};

describe('confidence', () => {
  it('is capped when nothing independent supports the thesis', () => {
    const result = scoreOpportunity(
      scoringInput({
        evidence: {
          rawMentions: 400,
          uniqueEvidence: 120,
          independentSources: 0,
          sourceDiversity: 0,
          aiDerivedMentions: 120,
          strengthByType: { pain: 40, demand: 30, trend: 60 },
          countByClass: { ai_derived: 120 },
          freshness: 1,
          counterEvidenceCount: 0,
          counterEvidenceStrength: 0,
        },
      }),
    );

    expect(result.confidence.value).toBeLessThanOrEqual(NO_INDEPENDENT_SOURCE_CEILING);
    expect(result.confidence.cap.applied).toBe(true);
    expect(result.confidence.cap.reason).toMatch(/AI-derived|independent/i);
  });

  it('is capped when everything traces back to one source', () => {
    const result = scoreOpportunity(
      scoringInput({
        evidence: {
          rawMentions: 60,
          uniqueEvidence: 40,
          independentSources: 1,
          sourceDiversity: 0,
          aiDerivedMentions: 0,
          strengthByType: { spending: 30, pain: 20 },
          countByClass: { direct_customer: 40 },
          freshness: 1,
          counterEvidenceCount: 0,
          counterEvidenceStrength: 0,
        },
      }),
    );
    expect(result.confidence.value).toBeLessThanOrEqual(SINGLE_SOURCE_CEILING);
  });

  it('rises with genuinely independent, high-quality evidence', () => {
    const weak = scoreOpportunity(
      scoringInput({
        evidence: {
          rawMentions: 6, uniqueEvidence: 4, independentSources: 2, sourceDiversity: 0.5,
          aiDerivedMentions: 0, strengthByType: { pain: 1, spending: 0.5 }, countByClass: { social: 4 },
          freshness: 0.6, counterEvidenceCount: 0, counterEvidenceStrength: 0,
        },
        market: MEASURED_MARKET,
      }),
    );
    const strong = scoreOpportunity(
      scoringInput({
        evidence: {
          rawMentions: 20, uniqueEvidence: 14, independentSources: 9, sourceDiversity: 0.95,
          aiDerivedMentions: 0, strengthByType: { spending: 4, pain: 3 },
          countByClass: { direct_customer: 8, transaction: 4, primary: 2 },
          freshness: 0.95, counterEvidenceCount: 0, counterEvidenceStrength: 0,
        },
        market: MEASURED_MARKET,
      }),
    );

    expect(strong.confidence.value).toBeGreaterThan(weak.confidence.value);
    expect(strong.confidence.value).toBeGreaterThan(0.55);
  });

  it('falls when counter-evidence is found', () => {
    const base = {
      rawMentions: 20, uniqueEvidence: 14, independentSources: 6, sourceDiversity: 0.9,
      aiDerivedMentions: 0, strengthByType: { spending: 4, pain: 3 },
      countByClass: { direct_customer: 10 }, freshness: 0.9,
    };
    const before = scoreOpportunity(scoringInput({ evidence: { ...base, counterEvidenceCount: 0, counterEvidenceStrength: 0 }, market: MEASURED_MARKET }));
    const after = scoreOpportunity(scoringInput({ evidence: { ...base, counterEvidenceCount: 6, counterEvidenceStrength: 5 }, market: MEASURED_MARKET }));

    expect(after.confidence.value).toBeLessThan(before.confidence.value);
  });

  it('falls while critical questions remain open', () => {
    const evidence = {
      rawMentions: 20, uniqueEvidence: 14, independentSources: 6, sourceDiversity: 0.9,
      aiDerivedMentions: 0, strengthByType: { spending: 4 }, countByClass: { direct_customer: 10 },
      freshness: 0.9, counterEvidenceCount: 0, counterEvidenceStrength: 0,
    };
    const settled = scoreOpportunity(scoringInput({ evidence, market: MEASURED_MARKET }));
    const open = scoreOpportunity(
      scoringInput({ evidence, market: MEASURED_MARKET, uncertainty: { criticalUnknownCount: 4, resolvedUnknownCount: 0, assumptionCount: 6 } }),
    );

    expect(open.confidence.value).toBeLessThan(settled.confidence.value);
  });

  it('ignores calibration until there is enough history for it to mean anything', () => {
    const evidence = {
      rawMentions: 20, uniqueEvidence: 14, independentSources: 6, sourceDiversity: 0.9,
      aiDerivedMentions: 0, strengthByType: { spending: 4 }, countByClass: { direct_customer: 10 },
      freshness: 0.9, counterEvidenceCount: 0, counterEvidenceStrength: 0,
    };
    const tinySample = scoreOpportunity(scoringInput({ evidence, market: MEASURED_MARKET, calibration: { sampleSize: 3, confidenceBias: 0.4, buildEstimateRatio: null } }));
    const noHistory = scoreOpportunity(scoringInput({ evidence, market: MEASURED_MARKET }));

    expect(tinySample.confidence.value).toBe(noHistory.confidence.value);

    const realSample = scoreOpportunity(scoringInput({ evidence, market: MEASURED_MARKET, calibration: { sampleSize: 12, confidenceBias: 0.4, buildEstimateRatio: null } }));
    expect(realSample.confidence.value).toBeLessThan(noHistory.confidence.value);
  });
});

describe('unmeasured decisive factors', () => {
  /**
   * Weight of complaint is not evidence of a market. However many unrelated
   * people report a problem, the thesis stays uncertain until somebody has
   * checked whether they would pay and what they already use instead.
   */
  it('caps confidence when nobody has checked whether anyone would pay', () => {
    const manyComplaints = scoringInput({
      evidence: {
        rawMentions: 60, uniqueEvidence: 40, independentSources: 25, sourceDiversity: 0.98,
        aiDerivedMentions: 0, strengthByType: { pain: 12 },
        countByClass: { community: 30, direct_customer: 10 },
        freshness: 1, counterEvidenceCount: 0, counterEvidenceStrength: 0,
      },
    });

    const result = scoreOpportunity(manyComplaints);

    expect(result.confidence.value).toBeLessThanOrEqual(0.5);
    expect(result.confidence.cap.applied).toBe(true);
    expect(result.confidence.cap.reason).toContain('would pay');
  });

  it('lifts the cap once those factors are actually established', () => {
    const evidence = {
      rawMentions: 60, uniqueEvidence: 40, independentSources: 25, sourceDiversity: 0.98,
      aiDerivedMentions: 0, strengthByType: { pain: 12, spending: 6 },
      countByClass: { community: 30, direct_customer: 10 },
      freshness: 1, counterEvidenceCount: 0, counterEvidenceStrength: 0,
    };

    const unchecked = scoreOpportunity(scoringInput({ evidence }));
    const checked = scoreOpportunity(scoringInput({ evidence, market: MEASURED_MARKET }));

    expect(checked.confidence.value).toBeGreaterThan(unchecked.confidence.value);
  });
});

describe('attractiveness and confidence are independent', () => {
  /**
   * The sentence the product exists to be able to say: this looks excellent,
   * and we are nowhere near sure enough to act on it.
   */
  it('can report a high score with low confidence', () => {
    const result = scoreOpportunity(
      scoringInput({
        evidence: {
          rawMentions: 5, uniqueEvidence: 3, independentSources: 1, sourceDiversity: 0.2,
          aiDerivedMentions: 0,
          strengthByType: { pain: 3, spending: 3, workaround: 2, labour: 2 },
          countByClass: { direct_customer: 3 }, freshness: 1,
          counterEvidenceCount: 0, counterEvidenceStrength: 0,
        },
        market: { competitorCount: 1, freeAlternativeCount: 0, competitorWeaknessCount: 5, observedMonthlySpend: [400, 350, 500], momentum30d: 0.6 },
      }),
    );

    expect(result.headline.attractiveness).toBeGreaterThan(60);
    expect(result.headline.confidence).toBeLessThan(0.5);
  });
});

describe('reproducibility', () => {
  it('produces the same digest for the same inputs regardless of key order', () => {
    const a = scoringInput({ market: { competitorCount: 3, freeAlternativeCount: 1, competitorWeaknessCount: 2, observedMonthlySpend: [100], momentum30d: 0.2 } });
    const b = scoringInput({ market: { momentum30d: 0.2, observedMonthlySpend: [100], competitorWeaknessCount: 2, freeAlternativeCount: 1, competitorCount: 3 } });
    expect(digestInput(a)).toBe(digestInput(b));
  });

  it('changes the digest when any input changes', () => {
    const before = scoringInput();
    const after = scoringInput({ market: { competitorCount: 1, freeAlternativeCount: null, competitorWeaknessCount: 0, observedMonthlySpend: [], momentum30d: null } });
    expect(digestInput(before)).not.toBe(digestInput(after));
  });

  it('is deterministic across repeated runs', () => {
    const input = scoringInput({
      evidence: {
        rawMentions: 10, uniqueEvidence: 7, independentSources: 3, sourceDiversity: 0.7,
        aiDerivedMentions: 0, strengthByType: { pain: 2 }, countByClass: { community: 7 },
        freshness: 0.8, counterEvidenceCount: 0, counterEvidenceStrength: 0,
      },
    });
    expect(JSON.stringify(scoreOpportunity(input))).toBe(JSON.stringify(scoreOpportunity(input)));
  });
});

describe('explaining change', () => {
  it('names what actually moved the score', () => {
    const before = scoreOpportunity(
      scoringInput({
        evidence: {
          rawMentions: 5, uniqueEvidence: 4, independentSources: 2, sourceDiversity: 0.6,
          aiDerivedMentions: 0, strengthByType: { pain: 1.5 }, countByClass: { community: 4 },
          freshness: 1, counterEvidenceCount: 0, counterEvidenceStrength: 0,
        },
      }),
    );
    const after = scoreOpportunity(
      scoringInput({
        evidence: {
          rawMentions: 12, uniqueEvidence: 9, independentSources: 5, sourceDiversity: 0.8,
          aiDerivedMentions: 0, strengthByType: { pain: 1.5, spending: 3 },
          countByClass: { community: 4, direct_customer: 5 },
          freshness: 1, counterEvidenceCount: 0, counterEvidenceStrength: 0,
        },
        market: { competitorCount: null, freeAlternativeCount: null, competitorWeaknessCount: 0, observedMonthlySpend: [420, 380], momentum30d: null },
      }),
    );

    const deltas = diffScores(before, after);
    const attractiveness = deltas.find((delta) => delta.composite === 'attractiveness');

    expect(attractiveness).toBeDefined();
    expect(attractiveness!.delta).toBeGreaterThan(0);
    expect(attractiveness!.topDrivers.map((driver) => driver.key)).toContain('willingness_to_pay');
  });

  it('reports nothing when nothing changed', () => {
    const input = scoringInput({
      evidence: {
        rawMentions: 5, uniqueEvidence: 4, independentSources: 2, sourceDiversity: 0.6,
        aiDerivedMentions: 0, strengthByType: { pain: 1.5 }, countByClass: { community: 4 },
        freshness: 1, counterEvidenceCount: 0, counterEvidenceStrength: 0,
      },
    });
    expect(diffScores(scoreOpportunity(input), scoreOpportunity(input))).toEqual([]);
  });
});
