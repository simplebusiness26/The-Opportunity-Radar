import { beforeEach, describe, expect, it } from 'vitest';
import { recordSignal } from '../../src/application/signals/record-signal';
import {
  attachEvidence,
  createOpportunity,
  transitionOpportunity,
} from '../../src/application/opportunities/lifecycle';
import { rescoreOpportunity } from '../../src/application/opportunities/score-opportunity';
import {
  createTrigger,
  evaluateTriggers,
  listTriggers,
} from '../../src/application/memory/triggers';
import {
  linkOpportunities,
  readRelationships,
  suggestRelationships,
} from '../../src/application/memory/relationships';
import { readCalibration, recordExecutionOutcome } from '../../src/application/memory/execution';
import { signUp } from '../../src/application/auth/sign-up';
import { MINIMUM_SAMPLE } from '../../src/domain/calibration/index';
import type { SystemCtx, WorkspaceCtx } from '../../src/domain/types/identity';
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

  // The sweep runs as the machine, which deliberately cannot decide anything.
  const systemCtx: SystemCtx = {
    workspaceId: account.workspaceId,
    orgId: 'unused',
    actor: 'system',
  };

  return { deps, ctx, systemCtx, clock };
}

type Deps = Awaited<ReturnType<typeof setup>>['deps'];

async function rejectedOpportunity(deps: Deps, ctx: WorkspaceCtx) {
  const opportunity = await createOpportunity(deps, ctx, {
    title: 'Deposit automation for restaurant bookings',
    thesis: 'Restaurants complain constantly about no-shows and might pay to hold deposits.',
    typeKey: 'new_product',
    problemStatement: 'No-shows cost money and nobody has paid to fix it.',
  });

  const complaint = await recordSignal(deps, ctx, {
    title: 'Owners complain about no-shows again',
    bodyText: 'Every weekend we lose covers to people who never turn up. It is infuriating.',
    url: 'https://restaurant-forum.test/no-shows',
    signalTypeKey: 'pain',
    evidenceClass: 'community',
    observedAt: NOW,
  });
  await attachEvidence(deps, ctx, opportunity.id, {
    evidenceUnitId: complaint.evidenceUnitId,
    stance: 'for',
  });

  await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'new_evidence' });
  await transitionOpportunity(deps, ctx, opportunity.id, {
    toState: 'rejected',
    reason: 'Loud complaint, but no evidence anyone has paid to solve it and a free workaround exists.',
  });

  return opportunity;
}

describe('re-evaluation triggers', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('refuses a trigger with no conditions', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await rejectedOpportunity(deps, ctx);

    await expect(
      createTrigger(deps, ctx, opportunity.id, {
        kind: 'anything',
        description: 'Fire on absolutely anything at all.',
        predicate: {},
      }),
    ).rejects.toThrow(/fire on everything/i);
  });

  /**
   * Acceptance test (e): a rejected opportunity reopens when the world changes.
   *
   * The specific thing that must be true is that the reopening is traceable:
   * the transition names the signal that caused it, so a person can read the
   * evidence rather than trust the system's word for it.
   */
  it('reopens a rejected opportunity when its trigger is satisfied', async () => {
    const { deps, ctx, systemCtx, clock } = await setup();
    const opportunity = await rejectedOpportunity(deps, ctx);

    const trigger = await createTrigger(deps, ctx, opportunity.id, {
      kind: 'spending_observed',
      description: 'Someone is observed paying to solve this after all.',
      predicate: {
        signalTypes: ['spending'],
        anyOf: ['deposit'],
        requireIndependent: true,
        minMonthlyAmount: 1,
      },
    });

    // Nothing has changed yet, so nothing should fire.
    const quiet = await evaluateTriggers(deps, systemCtx);
    expect(quiet.fired).toHaveLength(0);

    const updated = await deps.repos.opportunities.findById(ctx.workspaceId, opportunity.id);
    expect(updated?.state).toBe('rejected');

    // The world changes: a restaurant is observed paying for exactly this.
    clock.advance(60_000);
    const spending = await recordSignal(deps, ctx, {
      title: 'Restaurant starts paying for a deposit tool',
      bodyText: 'We now pay 45 a month for a tool that takes a deposit at booking, and it has worked.',
      url: 'https://independent-hospitality.test/deposit-tool',
      signalTypeKey: 'spending',
      evidenceClass: 'direct_customer',
      observedAt: clock.now(),
      monetaryEvidence: { monthlyAmount: 45, currency: 'GBP' },
    });

    const result = await evaluateTriggers(deps, systemCtx);

    expect(result.fired).toHaveLength(1);
    expect(result.fired[0]?.triggerId).toBe(trigger.id);
    expect(result.fired[0]?.reopened).toBe(true);

    const reopened = await deps.repos.opportunities.findById(ctx.workspaceId, opportunity.id);
    expect(reopened?.state).toBe('reopened');

    const transitions = await deps.repos.opportunities.listTransitions(opportunity.id);
    const reopening = transitions.find((transition) => transition.toState === 'reopened');
    expect(reopening?.evidence).toMatchObject({ triggerId: trigger.id, signalId: spending.signal.id });
    expect(reopening?.actorKind).toBe('system');

    const alerts = await deps.repos.alerts.list(ctx.workspaceId, { limit: 10 });
    expect(alerts.some((alert) => alert.kind === 'opportunity_reopened')).toBe(true);

    // The evidence that changed our mind is attached, so the reopened
    // opportunity is not left arguing from the evidence that closed it.
    const attached = await deps.repos.opportunities.evidenceFor(opportunity.id);
    expect(attached.map((row) => row.evidenceUnitId)).toContain(spending.evidenceUnitId);

    // A fired trigger disarms, so a second sweep does nothing.
    const again = await evaluateTriggers(deps, systemCtx);
    expect(again.fired).toHaveLength(0);
  });

  it('ignores evidence that arrived before the trigger was armed', async () => {
    const { deps, ctx, systemCtx, clock } = await setup();
    const opportunity = await rejectedOpportunity(deps, ctx);

    // Evidence that was already known when the rejection was made. Matching it
    // would reopen the opportunity on the very evidence that closed it.
    await recordSignal(deps, ctx, {
      title: 'Historic note about deposits',
      bodyText: 'An old thread where someone mentioned paying for a deposit tool at 30 a month.',
      url: 'https://old-archive.test/deposits',
      signalTypeKey: 'spending',
      evidenceClass: 'direct_customer',
      observedAt: NOW,
      monetaryEvidence: { monthlyAmount: 30, currency: 'GBP' },
    });

    clock.advance(60_000);
    await createTrigger(deps, ctx, opportunity.id, {
      kind: 'spending_observed',
      description: 'Someone is observed paying to solve this after all.',
      predicate: { signalTypes: ['spending'], anyOf: ['deposit'], minMonthlyAmount: 1 },
    });

    const result = await evaluateTriggers(deps, systemCtx);
    expect(result.fired).toHaveLength(0);
  });

  it('does not fire on a complaint when it is waiting for spending', async () => {
    const { deps, ctx, systemCtx, clock } = await setup();
    const opportunity = await rejectedOpportunity(deps, ctx);

    await createTrigger(deps, ctx, opportunity.id, {
      kind: 'spending_observed',
      description: 'Someone is observed paying to solve this after all.',
      predicate: { signalTypes: ['spending'], anyOf: ['deposit'], minMonthlyAmount: 1 },
    });

    clock.advance(60_000);
    await recordSignal(deps, ctx, {
      title: 'Another furious thread about deposits and no-shows',
      bodyText: 'Twenty replies agreeing that deposits should be standard. Nobody says they pay for one.',
      url: 'https://restaurant-forum.test/another-thread',
      signalTypeKey: 'pain',
      evidenceClass: 'community',
      observedAt: clock.now(),
    });

    const result = await evaluateTriggers(deps, systemCtx);
    expect(result.fired).toHaveLength(0);

    const still = await deps.repos.opportunities.findById(ctx.workspaceId, opportunity.id);
    expect(still?.state).toBe('rejected');

    // Checked and found wanting is a fact worth keeping.
    const triggers = await listTriggers(deps, ctx, opportunity.id);
    expect(triggers[0]?.checkCount).toBe(1);
  });
});

describe('opportunity relationships', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('links both directions for a symmetric relationship', async () => {
    const { deps, ctx } = await setup();

    const first = await createOpportunity(deps, ctx, {
      title: 'Deposits by card at booking',
      thesis: 'Take a card at booking and charge on a no-show.',
      typeKey: 'new_product',
    });
    const second = await createOpportunity(deps, ctx, {
      title: 'Deposits by bank transfer at booking',
      thesis: 'Ask for a transfer at booking and refund it on arrival.',
      typeKey: 'new_product',
    });

    await linkOpportunities(deps, ctx, first.id, { toOpportunityId: second.id, kind: 'variant_of' });

    const fromFirst = await readRelationships(deps.repos, ctx, first.id);
    const fromSecond = await readRelationships(deps.repos, ctx, second.id);

    expect(fromFirst.related).toHaveLength(2);
    expect(fromSecond.related.some((relation) => relation.opportunityId === first.id)).toBe(true);
    expect(fromFirst.suppressed).toBe(false);
  });

  it('stops a duplicate competing for the same time', async () => {
    const { deps, ctx } = await setup();

    const original = await createOpportunity(deps, ctx, {
      title: 'Deposit automation',
      thesis: 'Restaurants will pay to hold deposits automatically.',
      typeKey: 'new_product',
    });
    const duplicate = await createOpportunity(deps, ctx, {
      title: 'Automatic deposits for restaurants',
      thesis: 'Restaurants will pay to hold deposits automatically.',
      typeKey: 'new_product',
    });

    await linkOpportunities(deps, ctx, duplicate.id, {
      toOpportunityId: original.id,
      kind: 'duplicate_of',
    });

    const duplicateView = await readRelationships(deps.repos, ctx, duplicate.id);
    const originalView = await readRelationships(deps.repos, ctx, original.id);

    expect(duplicateView.suppressed).toBe(true);
    expect(originalView.suppressed).toBe(false);
  });

  it('warns before investigating something already rejected', async () => {
    const { deps, ctx } = await setup();
    await rejectedOpportunity(deps, ctx);

    const fresh = await createOpportunity(deps, ctx, {
      title: 'Deposit automation for restaurant bookings',
      thesis: 'Restaurants complain constantly about no-shows and might pay to hold deposits.',
      typeKey: 'new_product',
      problemStatement: 'No-shows cost money and nobody has paid to fix it.',
    });

    const suggestions = await suggestRelationships(deps.repos, ctx, fresh.id);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.state).toBe('rejected');
    expect(suggestions[0]?.reason).toContain('Read why before spending again');
    expect(suggestions[0]?.suggestedKind).toBe('learned_from');
  });
});

describe('calibration', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('refuses to calibrate on a young workspace and says why', async () => {
    const { deps, ctx } = await setup();

    for (let index = 0; index < 3; index += 1) {
      await recordExecutionOutcome(deps, ctx, {
        outcome: 'succeeded',
        predictedBuildDays: 10,
        actualBuildDays: 14,
        reason: `Project ${index}`,
      });
    }

    const calibration = await readCalibration(deps.repos, ctx.workspaceId);
    expect(calibration.usable).toBe(false);
    expect(calibration.refusal).toContain(`3 of ${MINIMUM_SAMPLE}`);
  });

  it('captures what Radar predicted rather than what the caller claims', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await rejectedOpportunity(deps, ctx);
    const score = await deps.repos.scores.current(ctx.workspaceId, opportunity.id);

    const record = await recordExecutionOutcome(deps, ctx, {
      opportunityId: opportunity.id,
      outcome: 'failed',
      predictedBuildDays: 10,
      actualBuildDays: 30,
      reason: 'Nobody would pay.',
    });

    expect(record.predictedConfidence).toBe(score?.confidence ?? null);
    expect(record.predictedScore).toBe(score?.attractiveness ?? null);
  });

  it('calibrates once enough work has been recorded, and feeds it into scoring', async () => {
    const { deps, ctx } = await setup();

    for (let index = 0; index < MINIMUM_SAMPLE; index += 1) {
      await recordExecutionOutcome(deps, ctx, {
        outcome: 'succeeded',
        predictedBuildDays: 10,
        actualBuildDays: 20,
        reason: `Project ${index}`,
      });
    }

    const calibration = await readCalibration(deps.repos, ctx.workspaceId);
    expect(calibration.usable).toBe(true);
    expect(calibration.buildEstimateRatio).toBeCloseTo(2, 3);

    // And the score's own snapshot now records that history, so a score can be
    // traced back to the calibration it was computed under.
    const opportunity = await createOpportunity(deps, ctx, {
      title: 'Something to score',
      thesis: 'A thesis that needs scoring against our own track record.',
      typeKey: 'new_product',
    });
    const { score } = await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'manual' });
    const snapshot = score.inputsSnapshot as { calibration?: { buildEstimateRatio?: number } };

    expect(snapshot.calibration?.buildEstimateRatio).toBeCloseTo(2, 3);
  });
});
