import { describe, expect, it } from 'vitest';
import {
  estimateBuildLeverage,
  matchCapabilities,
  type OwnedCapability,
  type RequiredCapability,
} from '../../src/domain/leverage/index';
import { computeFit } from '../../src/domain/fit/index';
import { resolveCapability } from '../../src/domain/taxonomy/capabilities';

function required(
  label: string,
  key: string | null,
  criticality: RequiredCapability['criticality'] = 'important',
): RequiredCapability {
  return { label, taxonomyKey: key, criticality };
}

function owned(
  taxonomyKey: string,
  overrides: Partial<OwnedCapability> = {},
): OwnedCapability {
  return {
    taxonomyKey,
    maturity: overrides.maturity ?? 'production',
    evidenceStrength: overrides.evidenceStrength ?? 0.9,
    assetNames: overrides.assetNames ?? [],
    // Fixtures state readiness explicitly. Leaving it unset is meaningful --
    // see the test below on the conservative default.
    reuseReadiness: overrides.reuseReadiness ?? 'drop_in',
  };
}

describe('resolving free text onto the capability vocabulary', () => {
  it('matches an exact key and a known alias', () => {
    expect(resolveCapability('platform.auth').key).toBe('platform.auth');
    expect(resolveCapability('Stripe').key).toBe('commerce.payments');
    expect(resolveCapability('multi tenant').key).toBe('platform.multi_tenant');
  });

  it('refuses to guess rather than inventing a match', () => {
    // A wrong guess would silently corrupt every leverage estimate downstream.
    const resolution = resolveCapability('quantum flux harmoniser');
    expect(resolution.key).toBeNull();
    expect(resolution.method).toBe('unresolved');
  });

  it('reports how the match was made, so certainty is never overstated', () => {
    expect(resolveCapability('payments').method).toBe('alias');
    expect(resolveCapability('').method).toBe('unresolved');
  });
});

describe('matching what is needed against what exists', () => {
  it('gives full credit for a proven capability and names the asset', () => {
    const [match] = matchCapabilities(
      [required('Authentication', 'platform.auth')],
      [owned('platform.auth', { assetNames: ['radar-auth'], maturity: 'battle_tested' })],
    );

    expect(match!.matchKind).toBe('exact');
    expect(match!.coverage).toBeGreaterThan(0.85);
    expect(match!.note).toContain('radar-auth');
  });

  it('treats unrecorded reuse readiness conservatively rather than optimistically', () => {
    const [stated] = matchCapabilities(
      [required('Authentication', 'platform.auth')],
      [owned('platform.auth', { reuseReadiness: 'drop_in' })],
    );
    const [unstated] = matchCapabilities(
      [required('Authentication', 'platform.auth')],
      [{ taxonomyKey: 'platform.auth', maturity: 'production', evidenceStrength: 0.9, assetNames: [] }],
    );

    // An unfilled field must not flatter the estimate: "we have auth somewhere"
    // is not the same as "we can drop our auth module into this tomorrow".
    expect(unstated!.coverage).toBeLessThan(stated!.coverage);
  });

  it('discounts a capability whose only implementation is a concept', () => {
    const [ready] = matchCapabilities(
      [required('Payments', 'commerce.payments')],
      [owned('commerce.payments', { reuseReadiness: 'drop_in' })],
    );
    const [notional] = matchCapabilities(
      [required('Payments', 'commerce.payments')],
      [owned('commerce.payments', { reuseReadiness: 'concept' })],
    );

    expect(notional!.coverage).toBeLessThan(ready!.coverage / 3);
  });

  it('discounts a capability that is only experimental', () => {
    const [proven] = matchCapabilities(
      [required('Payments', 'commerce.payments')],
      [owned('commerce.payments', { maturity: 'battle_tested' })],
    );
    const [rough] = matchCapabilities(
      [required('Payments', 'commerce.payments')],
      [owned('commerce.payments', { maturity: 'experimental' })],
    );

    // A prototype is not the same as something that survived production.
    expect(rough!.coverage).toBeLessThan(proven!.coverage / 2);
  });

  it('gives partial credit for a closely related capability', () => {
    const [match] = matchCapabilities(
      [required('Subscription billing', 'commerce.subscriptions')],
      [owned('commerce.payments')],
    );

    expect(match!.matchKind).toBe('related');
    expect(match!.coverage).toBeGreaterThan(0);
    expect(match!.coverage).toBeLessThan(0.5);
  });

  it('treats an unresolvable requirement as a gap, not as satisfied', () => {
    const [match] = matchCapabilities(
      [required('Something nobody has named yet', null)],
      [owned('platform.auth')],
    );

    expect(match!.matchKind).toBe('unresolved');
    expect(match!.coverage).toBe(0);
    expect(match!.note).toContain('counted as a gap');
  });
});

describe('build leverage estimates', () => {
  const requirements = [
    required('Authentication', 'platform.auth', 'essential'),
    required('Multi-tenant workspaces', 'platform.multi_tenant', 'essential'),
    required('Payments', 'commerce.payments', 'essential'),
    required('Calendar integration', 'integration.calendar', 'important'),
    required('Notifications', 'platform.notifications', 'nice_to_have'),
  ];

  it('is faster to build when much of it already exists', () => {
    const withNothing = estimateBuildLeverage(matchCapabilities(requirements, []));
    const withPlatform = estimateBuildLeverage(
      matchCapabilities(requirements, [
        owned('platform.auth'),
        owned('platform.multi_tenant'),
        owned('platform.notifications'),
      ]),
    );

    expect(withPlatform.coverage).toBeGreaterThan(withNothing.coverage);
    expect(withPlatform.leveragedDays[1]).toBeLessThan(withNothing.leveragedDays[1]);
    expect(withPlatform.leverageScore).toBeGreaterThan(withNothing.leverageScore);
  });

  it('always presents effort as a range rather than a false precision', () => {
    const estimate = estimateBuildLeverage(matchCapabilities(requirements, [owned('platform.auth')]));

    expect(estimate.greenfieldDays[0]).toBeLessThan(estimate.greenfieldDays[1]);
    expect(estimate.leveragedDays[0]).toBeLessThan(estimate.leveragedDays[1]);
  });

  it('never claims assembly is free, even when everything exists', () => {
    const estimate = estimateBuildLeverage(
      matchCapabilities(
        requirements,
        requirements
          .map((requirement) => requirement.taxonomyKey)
          .filter((key): key is string => key !== null)
          .map((key) => owned(key, { maturity: 'battle_tested', evidenceStrength: 1 })),
      ),
    );

    // Integration still costs days; a leveraged estimate trending to zero would
    // be the single most damaging lie this screen could tell.
    expect(estimate.leveragedDays[0]).toBeGreaterThan(0);
    expect(estimate.coverage).toBeGreaterThan(0.9);
  });

  it('widens the range and warns when most requirements are unrecognised', () => {
    const vague = estimateBuildLeverage(
      matchCapabilities(
        [required('Thing one', null), required('Thing two', null), required('Auth', 'platform.auth')],
        [owned('platform.auth')],
      ),
    );

    expect(vague.caveat).toContain('rough shape');
    expect(vague.unresolvedCount).toBe(2);
  });

  it('says so plainly when there is nothing to estimate from', () => {
    const empty = estimateBuildLeverage([]);
    expect(empty.coverage).toBe(0);
    expect(empty.caveat).toContain('before relying on any build estimate');
  });
});

describe('fit', () => {
  const baseLeverage = estimateBuildLeverage(
    matchCapabilities([required('Auth', 'platform.auth')], [owned('platform.auth')]),
  );

  it('scores absent information as unknown rather than as a negative', () => {
    const blank = computeFit({
      leverage: baseLeverage,
      domainExperience: null,
      customerAccess: null,
      hasDistribution: null,
      capitalFit: { available: null, required: null },
      timeFit: { availableDays: null, requiredDays: null },
      strategicAlignment: null,
      motivation: null,
      priorOutcomes: { successes: 0, failures: 0 },
    });

    // A team that has not filled in a profile must not appear unsuited to
    // everything; the honest signal is low confidence, not a low score.
    expect(blank.confidence).toBeLessThan(0.4);
    expect(blank.unknowns.length).toBeGreaterThan(4);
    expect(blank.explanation).toContain('too little about this team');
  });

  it('rewards being able to reach the customer', () => {
    const shared = {
      leverage: baseLeverage,
      domainExperience: 'direct' as const,
      hasDistribution: true,
      capitalFit: { available: 500, required: 100 },
      timeFit: { availableDays: 10, requiredDays: 4 },
      strategicAlignment: 0.8,
      motivation: 0.8,
      priorOutcomes: { successes: 3, failures: 1 },
    };

    const reachable = computeFit({ ...shared, customerAccess: 'strong' });
    const cold = computeFit({ ...shared, customerAccess: 'none' });

    expect(reachable.score).toBeGreaterThan(cold.score);
    expect(cold.weaknesses.join(' ')).toContain('cold');
  });

  it('ignores a track record too short to mean anything', () => {
    const factorFor = (successes: number, failures: number) =>
      computeFit({
        leverage: baseLeverage,
        domainExperience: 'direct',
        customerAccess: 'strong',
        hasDistribution: true,
        capitalFit: { available: 500, required: 100 },
        timeFit: { availableDays: 10, requiredDays: 4 },
        strategicAlignment: 0.8,
        motivation: 0.8,
        priorOutcomes: { successes, failures },
      }).factors.find((factor) => factor.key === 'trackRecord');

    // One win is an anecdote. Reading a pattern into it would be the same
    // mistake the product warns its owner against.
    expect(factorFor(1, 0)?.value).toBeNull();
    expect(factorFor(3, 1)?.value).toBeCloseTo(0.75, 5);
  });
});

/**
 * Acceptance test (c): two opportunities that look equally good from outside,
 * where one uses what we already have. Radar must notice, and must be able to
 * say what specifically gives the advantage.
 */
describe('acceptance: recognising a personal advantage', () => {
  const sharedRequirements = [
    required('Authentication', 'platform.auth', 'essential'),
    required('Multi-tenant workspaces', 'platform.multi_tenant', 'essential'),
    required('Background jobs', 'platform.jobs', 'essential'),
    required('Payments', 'commerce.payments', 'important'),
    required('Analytics', 'data.analytics', 'important'),
  ];

  const ourStack = [
    owned('platform.auth', { assetNames: ['radar-auth'], maturity: 'battle_tested' }),
    owned('platform.multi_tenant', { assetNames: ['workspace-core'], maturity: 'production' }),
    owned('platform.jobs', { assetNames: ['job-queue'], maturity: 'production' }),
    owned('data.analytics', { assetNames: ['metrics-kit'], maturity: 'working' }),
  ];

  const requirementsWeCannotHelpWith = [
    required('Mobile application', 'interface.mobile', 'essential'),
    required('Regulated industry knowledge', 'domain_knowledge.regulated', 'essential'),
    required('Compliance certification', 'operations.compliance', 'essential'),
    required('Direct sales', 'gtm.sales', 'important'),
    required('CRM integration', 'integration.crm', 'important'),
  ];

  it('separates the one we can build quickly from the one we cannot', () => {
    const advantaged = estimateBuildLeverage(matchCapabilities(sharedRequirements, ourStack));
    const foreign = estimateBuildLeverage(matchCapabilities(requirementsWeCannotHelpWith, ourStack));

    expect(advantaged.coverage).toBeGreaterThan(0.6);
    expect(foreign.coverage).toBeLessThan(0.2);
    expect(advantaged.leverageScore - foreign.leverageScore).toBeGreaterThan(30);
  });

  it('names the specific assets that give the advantage', () => {
    const advantaged = estimateBuildLeverage(matchCapabilities(sharedRequirements, ourStack));

    // "You have an advantage" is not useful. "You already have radar-auth,
    // workspace-core and job-queue" is.
    expect(advantaged.reusableAssets).toEqual(
      expect.arrayContaining(['radar-auth', 'workspace-core', 'job-queue']),
    );
    expect(advantaged.explanation).toContain('already exist');
  });

  it('carries the difference through to fit, not just to effort', () => {
    const profile = {
      domainExperience: 'adjacent' as const,
      customerAccess: 'weak' as const,
      hasDistribution: false,
      capitalFit: { available: 500, required: 300 },
      strategicAlignment: 0.6,
      motivation: 0.7,
      priorOutcomes: { successes: 2, failures: 2 },
    };

    const advantaged = estimateBuildLeverage(matchCapabilities(sharedRequirements, ourStack));
    const foreign = estimateBuildLeverage(matchCapabilities(requirementsWeCannotHelpWith, ourStack));

    const fitHere = computeFit({
      ...profile,
      leverage: advantaged,
      timeFit: { availableDays: 14, requiredDays: advantaged.leveragedDays[1] },
    });
    const fitThere = computeFit({
      ...profile,
      leverage: foreign,
      timeFit: { availableDays: 14, requiredDays: foreign.leveragedDays[1] },
    });

    expect(fitHere.score).toBeGreaterThan(fitThere.score);
    expect(fitHere.advantages.join(' ')).toMatch(/already built/i);
  });
});
