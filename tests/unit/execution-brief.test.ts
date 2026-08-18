import { describe, expect, it } from 'vitest';
import {
  assessReadiness,
  buildBrief,
  renderBrief,
  type BriefInput,
} from '../../src/domain/execution/brief';

function input(overrides: Partial<BriefInput> = {}): BriefInput {
  return {
    reference: 7,
    title: 'Deposit automation for restaurant bookings',
    thesis: 'Independent restaurants will pay to hold deposits automatically.',
    state: 'validated',
    typeKey: 'new_product',
    targetCustomer: 'Independent restaurants with 20 to 60 covers',
    problemStatement: 'No-shows cost covers every weekend.',
    whyNow: 'Pre-authorisation was extended to small merchants this year.',
    demo: false,

    attractiveness: 72,
    confidence: 0.62,
    fit: 65,
    leverage: 58,

    evidence: {
      rawMentions: 41,
      uniqueEvidence: 12,
      independentSources: 5,
      aiDerivedMentions: 3,
      strongest: [{ claim: 'A restaurant pays 180 a month', evidenceClass: 'direct_customer', mentions: 2 }],
      counter: [{ claim: 'A free workaround exists', note: 'Cited by the red team' }],
    },

    capabilities: [{ label: 'Payments', criticality: 'essential', coveredBy: 'billing-service' }],
    reusableAssets: ['billing-service'],
    buildDaysRange: { low: 12, high: 24 },

    knowns: ['Restaurants already pay for booking software'],
    assumptions: ['Guests will tolerate entering card details'],
    criticalUnknowns: ['Whether restaurants will ask guests for card details'],

    objections: [
      { argument: 'Owners would have to replace their booking system', severity: 'serious', disconfirmingTest: 'Ask ten owners' },
    ],

    validation: {
      hypothesis: 'Restaurants will ask guests for card details',
      experimentType: 'customer_interview',
      successThreshold: 'At least four agree to trial it',
      failureThreshold: 'Fewer than two will discuss it',
      doNotBuildYet: ['Payment integration', 'A mobile app'],
    },

    experiments: [
      { name: 'Ten owner interviews', state: 'completed', verdict: 'validated', conclusion: 'Five agreed.' },
    ],

    watchingFor: ['The free workaround starts charging'],
    allocationRationale: 'Reuses the billing service, so it is the cheapest of the current candidates.',
    generatedAt: new Date('2026-08-18T00:00:00Z'),
    ...overrides,
  };
}

describe('execution brief readiness', () => {
  it('accepts an opportunity that survived the whole process', () => {
    const verdict = assessReadiness(input());

    expect(verdict.ready).toBe(true);
  });

  it('refuses when nothing has been independently corroborated', () => {
    const verdict = assessReadiness(
      input({ evidence: { ...input().evidence, independentSources: 0 } }),
    );

    expect(verdict.ready).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining('corroborated') });
  });

  it('refuses when confidence is too low to commit build effort against', () => {
    const verdict = assessReadiness(input({ confidence: 0.3 }));

    expect(verdict.ready).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining('30%') });
  });

  it('refuses while a fatal objection stands', () => {
    const verdict = assessReadiness(
      input({
        objections: [{ argument: 'Nobody pays for this', severity: 'fatal', disconfirmingTest: null }],
      }),
    );

    expect(verdict.ready).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining('fatal') });
  });

  it('refuses when nothing has been tested against real people', () => {
    const verdict = assessReadiness(input({ experiments: [] }));

    expect(verdict.ready).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining('real people') });
  });

  it('refuses when the experiment came back negative', () => {
    const verdict = assessReadiness(
      input({
        experiments: [
          { name: 'Ten owner interviews', state: 'completed', verdict: 'rejected', conclusion: 'One agreed.' },
        ],
      }),
    );

    expect(verdict.ready).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining('negative result') });
  });

  it('does not let an inconclusive experiment count as a pass', () => {
    const verdict = assessReadiness(
      input({
        experiments: [
          { name: 'Ten owner interviews', state: 'completed', verdict: 'inconclusive', conclusion: null },
        ],
      }),
    );

    expect(verdict.ready).toBe(false);
    expect(verdict).toMatchObject({ reason: expect.stringContaining('inconclusive') });
  });
});

describe('rendering the brief', () => {
  it('leads with the readiness verdict rather than the thesis', () => {
    const markdown = renderBrief(buildBrief(input({ confidence: 0.2 })));
    const firstBlock = markdown.slice(0, 400);

    expect(firstBlock).toContain('NOT READY TO BUILD');
  });

  it('states the three counts and excludes AI-derived mentions from them', () => {
    const markdown = renderBrief(buildBrief(input()));

    expect(markdown).toContain('41 mentions · 12 unique evidence · 5 independent sources');
    expect(markdown).toContain('count toward none of the above');
  });

  it('carries what must not be built yet', () => {
    const markdown = renderBrief(buildBrief(input()));

    expect(markdown).toContain('## Do not build yet');
    expect(markdown).toContain('Payment integration');
  });

  it('says so when nothing has been ruled out', () => {
    const brief = buildBrief(input({ validation: null }));
    const markdown = renderBrief(brief);

    expect(markdown).toContain('scope is unbounded');
  });

  it('gives the build estimate as a range, not a number', () => {
    const markdown = renderBrief(buildBrief(input()));

    expect(markdown).toContain('12–24 days');
    expect(markdown).toContain('A range, not a number');
  });

  it('marks demo data unmistakably', () => {
    const markdown = renderBrief(buildBrief(input({ demo: true })));

    expect(markdown).toContain('**DEMO DATA.**');
  });
});
