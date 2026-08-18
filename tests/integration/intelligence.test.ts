import { beforeEach, describe, expect, it } from 'vitest';
import { signUp } from '../../src/application/auth/sign-up';
import {
  assessOpportunityFit,
  readOwnedCapabilities,
  recordAsset,
  recordCapability,
  recordGoal,
  recordResource,
} from '../../src/application/intelligence/capability-profile';
import { allocateResources } from '../../src/application/intelligence/allocate-resources';
import { createOpportunity } from '../../src/application/opportunities/lifecycle';
import { rescoreOpportunity } from '../../src/application/opportunities/score-opportunity';
import { resolveCapability } from '../../src/domain/taxonomy/capabilities';
import type { WorkspaceCtx } from '../../src/domain/types/identity';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { controllableClock } from '../../src/adapters/clock/index';

const NOW = new Date('2026-08-18T00:00:00Z');

async function setup() {
  const account = await signUp(buildAuthDeps({ now: NOW }), {
    email: `owner-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-sufficiently-long-password',
    displayName: 'Owner',
    workspaceName: 'Radar HQ',
  });

  const { db } = testDb();
  const clock = controllableClock(NOW);
  const deps = { repos: createRepositories(db), tx: createTransactor(db), clock };
  const ctx: WorkspaceCtx = {
    workspaceId: account.workspaceId,
    orgId: 'unused',
    userId: account.userId,
    role: 'owner',
  };
  return { deps, ctx, clock };
}

async function setRequirements(
  deps: Awaited<ReturnType<typeof setup>>['deps'],
  ctx: WorkspaceCtx,
  opportunityId: string,
  labels: Array<[string, 'nice_to_have' | 'important' | 'essential']>,
) {
  await deps.repos.opportunities.setCapabilityRequirements(
    ctx.workspaceId,
    opportunityId,
    labels.map(([label, criticality]) => {
      const resolution = resolveCapability(label);
      return { label, taxonomyKey: resolution.key, criticality, resolvedBy: resolution.method };
    }),
  );
}

describe('the internal intelligence graph', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('records a capability and links the assets that provide it', async () => {
    const { deps, ctx } = await setup();

    const result = await recordCapability(deps, ctx, {
      name: 'Radar auth stack',
      capability: 'authentication',
      maturity: 'battle_tested',
      evidenceStrength: 0.95,
      providedBy: ['radar-auth', 'session-kit'],
      notes: null,
    });

    expect(result.taxonomyKey).toBe('platform.auth');
    expect(result.unresolvedWarning).toBeNull();

    const owned = await readOwnedCapabilities(deps.repos, ctx.workspaceId);
    expect(owned).toHaveLength(1);
    expect(owned[0]?.assetNames).toEqual(expect.arrayContaining(['radar-auth', 'session-kit']));
  });

  it('stores an unrecognised capability but warns it will not count', async () => {
    const { deps, ctx } = await setup();

    const result = await recordCapability(deps, ctx, {
      name: 'Our secret sauce',
      capability: 'proprietary widget alignment',
      maturity: 'production',
      evidenceStrength: 0.9,
      providedBy: [],
      notes: null,
    });

    // Silently mapping this to something adjacent would corrupt every leverage
    // estimate that touched it, so it is stored and flagged instead.
    expect(result.taxonomyKey).toBeNull();
    expect(result.unresolvedWarning).toContain('will not count towards build leverage');
    expect(await readOwnedCapabilities(deps.repos, ctx.workspaceId)).toHaveLength(0);
  });

  it('carries reuse readiness through to the leverage estimate', async () => {
    const { deps, ctx } = await setup();

    await recordAsset(deps, ctx, {
      name: 'payments-module',
      assetKind: 'component',
      reuseReadiness: 'drop_in',
      location: null,
      licence: null,
      summary: null,
    });
    await recordCapability(deps, ctx, {
      name: 'Payments',
      capability: 'payments',
      maturity: 'production',
      evidenceStrength: 0.9,
      providedBy: ['payments-module'],
      notes: null,
    });

    const owned = await readOwnedCapabilities(deps.repos, ctx.workspaceId);
    expect(owned[0]?.reuseReadiness).toBe('drop_in');
  });
});

/**
 * Acceptance test (c), end to end through the database: two opportunities with
 * comparable external evidence, where only one uses what we already have.
 */
describe('acceptance: personal advantage, through the whole stack', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('ranks the one we can already mostly build above the one we cannot', async () => {
    const { deps, ctx } = await setup();

    for (const [name, capability, assets] of [
      ['Radar auth stack', 'authentication', ['radar-auth']],
      ['Workspace core', 'multi-tenant workspaces', ['workspace-core']],
      ['Job queue', 'background jobs', ['job-queue']],
      ['Metrics kit', 'analytics', ['metrics-kit']],
    ] as const) {
      await recordAsset(deps, ctx, {
        name: assets[0]!,
        assetKind: 'component',
        reuseReadiness: 'lift_and_shift',
        location: null,
        licence: null,
        summary: null,
      });
      await recordCapability(deps, ctx, {
        name,
        capability,
        maturity: 'production',
        evidenceStrength: 0.9,
        providedBy: [...assets],
        notes: null,
      });
    }

    const advantaged = await createOpportunity(deps, ctx, {
      title: 'Workspace analytics for agencies',
      thesis: 'Agencies already pay for reporting and would pay more for it inside their workspace.',
      typeKey: 'new_product',
      targetCustomer: 'Digital agencies',
    });

    const foreign = await createOpportunity(deps, ctx, {
      title: 'Regulated clinical scheduling',
      thesis: 'Clinics need scheduling that satisfies their regulator.',
      typeKey: 'new_product',
      targetCustomer: 'Private clinics',
    });

    await setRequirements(deps, ctx, advantaged.id, [
      ['authentication', 'essential'],
      ['multi-tenant workspaces', 'essential'],
      ['background jobs', 'essential'],
      ['analytics', 'important'],
    ]);

    await setRequirements(deps, ctx, foreign.id, [
      ['mobile app', 'essential'],
      ['compliance', 'essential'],
      ['regulated', 'essential'],
      ['crm', 'important'],
    ]);

    const here = await assessOpportunityFit(deps, ctx, advantaged.id);
    const there = await assessOpportunityFit(deps, ctx, foreign.id);

    expect(here.leverage.coverage).toBeGreaterThan(0.5);
    expect(there.leverage.coverage).toBeLessThan(0.15);
    expect(here.leverage.leverageScore - there.leverage.leverageScore).toBeGreaterThan(30);

    // And it can say precisely what gives the advantage, by name.
    expect(here.leverage.reusableAssets).toEqual(
      expect.arrayContaining(['radar-auth', 'workspace-core', 'job-queue']),
    );
    expect(here.fit.score).toBeGreaterThan(there.fit.score);
  });
});

describe('allocating effort from real state', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('reports having nothing to compare on an empty workspace', async () => {
    const { deps, ctx } = await setup();
    const result = await allocateResources(deps, ctx, { horizonDays: 7 });

    // An empty workspace gets an honest answer, not an invented recommendation.
    expect(result.recommendation).toBeNull();
    expect(result.noActionReason).toContain('nothing to compare');
  });

  it('prefers testing an uncertain thesis to building it', async () => {
    const { deps, ctx } = await setup();

    await recordResource(deps, ctx, {
      name: 'Discretionary budget',
      resourceKind: 'budget',
      amount: 500,
      unit: 'GBP',
      period: 'month',
      committed: 0,
    });
    await recordResource(deps, ctx, {
      name: 'Available time',
      resourceKind: 'time',
      amount: 12,
      unit: 'days',
      period: 'month',
      committed: 0,
    });
    await recordGoal(deps, ctx, {
      name: 'Reach first recurring revenue',
      horizon: 'quarter',
      priority: 1,
      metric: 'MRR',
      target: '1000',
    });

    const opportunity = await createOpportunity(deps, ctx, {
      title: 'Deposit automation for restaurant bookings',
      thesis: 'Restaurants would pay for automatic deposits.',
      typeKey: 'new_product',
      targetCustomer: 'Independent restaurants',
    });

    await setRequirements(deps, ctx, opportunity.id, [
      ['authentication', 'essential'],
      ['payments', 'essential'],
      ['calendar', 'important'],
    ]);

    await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'manual' });

    const result = await allocateResources(deps, ctx, { horizonDays: 7 });

    // With no evidence recorded, confidence is low, so building is refused and
    // the cheap test wins -- which is the entire point of the engine.
    expect(result.recommendation?.kind).toBe('validate');
    expect(result.notYet.length).toBeGreaterThan(0);
    expect(result.notYet[0]?.reason).toContain('Reduce the uncertainty');
  });

  it('respects the resources actually recorded', async () => {
    const { deps, ctx } = await setup();

    await recordResource(deps, ctx, {
      name: 'Available time',
      resourceKind: 'time',
      amount: 1,
      unit: 'days',
      period: 'month',
      committed: 0,
    });
    await recordResource(deps, ctx, {
      name: 'Budget',
      resourceKind: 'budget',
      amount: 5,
      unit: 'GBP',
      period: 'month',
      committed: 0,
    });

    const opportunity = await createOpportunity(deps, ctx, {
      title: 'Something needing real effort',
      thesis: 'It would take a while.',
      typeKey: 'new_product',
      targetCustomer: 'Someone',
    });
    await setRequirements(deps, ctx, opportunity.id, [['payments', 'essential']]);
    await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'manual' });

    const result = await allocateResources(deps, ctx, { horizonDays: 7 });
    expect(result.recommendation).toBeNull();
    expect(result.noActionReason).toBeTruthy();
  });
});
