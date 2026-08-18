import { beforeEach, describe, expect, it } from 'vitest';
import { recordSignal } from '../../src/application/signals/record-signal';
import { attachEvidence, createOpportunity, transitionOpportunity } from '../../src/application/opportunities/lifecycle';
import { rescoreOpportunity } from '../../src/application/opportunities/score-opportunity';
import { signUp } from '../../src/application/auth/sign-up';
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

type Deps = Awaited<ReturnType<typeof setup>>['deps'];

async function addEvidence(
  deps: Deps,
  ctx: WorkspaceCtx,
  input: Parameters<typeof recordSignal>[2],
): Promise<string> {
  const result = await recordSignal(deps, ctx, input);
  return result.evidenceUnitId;
}

describe('opportunity lifecycle', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('starts at detected with a recorded reason', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await createOpportunity(deps, ctx, {
      title: 'Deposit automation for restaurants',
      thesis: 'Restaurants lose covers to no-shows and cannot easily take deposits.',
      typeKey: 'new_product',
    });

    expect(opportunity.state).toBe('detected');
    expect(opportunity.reference).toBe(1);

    const transitions = await deps.repos.opportunities.listTransitions(opportunity.id);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]?.toState).toBe('detected');
    expect(transitions[0]?.reason).toBeTruthy();
  });

  it('numbers opportunities per workspace so references stay stable', async () => {
    const { deps, ctx } = await setup();
    const first = await createOpportunity(deps, ctx, { title: 'One', thesis: 'A thesis about something.', typeKey: 'new_product' });
    const second = await createOpportunity(deps, ctx, { title: 'Two', thesis: 'Another thesis entirely.', typeKey: 'productisation' });

    expect(first.reference).toBe(1);
    expect(second.reference).toBe(2);

    const other = await setup();
    const elsewhere = await createOpportunity(other.deps, other.ctx, { title: 'Theirs', thesis: 'A separate workspace thesis.', typeKey: 'new_product' });
    expect(elsewhere.reference).toBe(1);
  });

  it('refuses a jump that skips investigation and validation', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await createOpportunity(deps, ctx, { title: 'Rushed', thesis: 'We should just build it right now.', typeKey: 'new_product' });

    await expect(
      transitionOpportunity(deps, ctx, opportunity.id, { toState: 'execution', reason: 'Feels right.' }),
    ).rejects.toMatchObject({ code: 'opportunity.illegal_transition' });
  });

  it('refuses a state change with no stated reason', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await createOpportunity(deps, ctx, { title: 'Unexplained', thesis: 'A thesis needing investigation.', typeKey: 'new_product' });

    await expect(
      transitionOpportunity(deps, ctx, opportunity.id, { toState: 'watching', reason: '  ' }),
    ).rejects.toBeTruthy();
  });

  it('records a rejection in the decision log, not just the transition', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await createOpportunity(deps, ctx, { title: 'Doomed', thesis: 'A thesis that will not survive contact.', typeKey: 'new_product' });

    await transitionOpportunity(deps, ctx, opportunity.id, {
      toState: 'rejected',
      reason: 'No evidence anyone pays for this, and two free tools already do it.',
    });

    const decisions = await deps.repos.decisions.list(ctx.workspaceId);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.decision).toBe('rejected');
    expect(decisions[0]?.rationale).toContain('free tools');
  });

  it('keeps a rejected opportunity reopenable', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await createOpportunity(deps, ctx, { title: 'Too early', thesis: 'Right idea, wrong moment for it.', typeKey: 'new_product' });

    await transitionOpportunity(deps, ctx, opportunity.id, { toState: 'rejected', reason: 'Inference costs make the unit economics impossible.' });
    const reopened = await transitionOpportunity(deps, ctx, opportunity.id, { toState: 'reopened', reason: 'Inference pricing fell by 76%.' });

    expect(reopened.state).toBe('reopened');
    const transitions = await deps.repos.opportunities.listTransitions(opportunity.id);
    expect(transitions.map((t) => t.toState)).toContain('rejected');
  });

  it('does not let an analyst take a decision that commits the business', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await createOpportunity(deps, ctx, { title: 'Contested', thesis: 'A thesis somebody wants to kill.', typeKey: 'new_product' });

    await expect(
      transitionOpportunity(deps, { ...ctx, role: 'analyst' }, opportunity.id, {
        toState: 'rejected',
        reason: 'I do not like it.',
      }),
    ).rejects.toMatchObject({ code: 'opportunities.transition_denied' });
  });
});

describe('scoring an opportunity', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('scores from attached evidence and stores the reasoning', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await createOpportunity(deps, ctx, {
      title: 'Deposit automation',
      thesis: 'Restaurants will pay to stop losing covers to no-shows.',
      typeKey: 'new_product',
    });

    const evidenceId = await addEvidence(deps, ctx, {
      title: 'Restaurant pays for booking software that cannot take deposits',
      bodyText: 'We pay 180 a month for our booking system and it still cannot take a deposit, so we eat the loss every weekend.',
      signalTypeKey: 'spending',
      evidenceClass: 'direct_customer',
      observedAt: NOW,
      sourceLabel: "Interview with Bella's",
      monetaryEvidence: { monthlyAmount: 180, currency: 'GBP' },
    });
    await attachEvidence(deps, ctx, opportunity.id, { evidenceUnitId: evidenceId, stance: 'for' });

    const { result, score } = await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'new_evidence' });

    expect(score.attractiveness).not.toBeNull();
    expect(result.dimensions.length).toBeGreaterThan(10);
    // The observed price must come from the evidence, not from an assumption.
    const wtp = result.dimensions.find((d) => d.key === 'willingness_to_pay');
    expect(wtp?.status).toBe('ok');
    expect(wtp?.explanation).toContain('180');
  });

  it('does not write a duplicate score when nothing has changed', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await createOpportunity(deps, ctx, { title: 'Stable', thesis: 'Nothing about this has changed yet.', typeKey: 'new_product' });

    const first = await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'manual' });
    const second = await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'manual' });

    expect(second.changed).toBe(false);
    expect(second.score.id).toBe(first.score.id);
    expect(await deps.repos.scores.history(ctx.workspaceId, opportunity.id)).toHaveLength(1);
  });

  it('records what moved when the evidence changes', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await createOpportunity(deps, ctx, { title: 'Improving', thesis: 'Evidence is still accumulating here.', typeKey: 'new_product' });
    await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'manual' });

    const evidenceId = await addEvidence(deps, ctx, {
      title: 'Practice manager describes the same problem',
      bodyText: 'Chasing patients who do not turn up takes one member of staff most of a day every week, and we pay for that time.',
      signalTypeKey: 'labour',
      evidenceClass: 'direct_customer',
      observedAt: NOW,
      sourceLabel: 'Interview with a practice manager',
    });
    await attachEvidence(deps, ctx, opportunity.id, { evidenceUnitId: evidenceId, stance: 'for' });

    const after = await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'new_evidence' });
    expect(after.changed).toBe(true);
    expect(after.deltas.length).toBeGreaterThan(0);

    const deltas = await deps.repos.scores.recentDeltas(ctx.workspaceId, new Date(NOW.getTime() - 86_400_000));
    expect(deltas.some((delta) => delta.cause === 'new_evidence')).toBe(true);
  });
});

/**
 * The second acceptance test: Radar must be able to refuse an idea that looks
 * exciting. Heavy interest and many complaints, with nobody paying and good free
 * alternatives, is the classic trap.
 */
describe('acceptance: killing an attractive-looking idea', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('does not recommend building something nobody pays for', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await createOpportunity(deps, ctx, {
      title: 'Social scheduling tool for hobby groups',
      thesis: 'Everyone complains about organising hobby groups, so a tool would sell.',
      typeKey: 'new_product',
    });

    // Plenty of noise: complaints and interest from many places.
    for (let i = 0; i < 12; i += 1) {
      const evidenceId = await addEvidence(deps, ctx, {
        title: `Complaint thread ${i}`,
        bodyText: `Organising our weekly group is a nightmare, number ${i}. Everyone uses a different chat app and nobody replies to the poll in time.`,
        url: `https://forum-${i}.test/thread-${i}`,
        signalTypeKey: 'pain',
        evidenceClass: 'community',
        observedAt: NOW,
      });
      await attachEvidence(deps, ctx, opportunity.id, { evidenceUnitId: evidenceId, stance: 'for' });
    }

    // And what the red team would find: free tools that already do the job.
    for (const alternative of ['a free calendar poll', 'a free group chat', 'a free spreadsheet template']) {
      const counterId = await addEvidence(deps, ctx, {
        title: `Groups already use ${alternative}`,
        bodyText: `Most of the groups asked said they already use ${alternative} and would not pay anything for a dedicated tool to replace it.`,
        signalTypeKey: 'competitor_weakness',
        evidenceClass: 'direct_customer',
        observedAt: NOW,
        sourceLabel: `Research into ${alternative}`,
      });
      await attachEvidence(deps, ctx, opportunity.id, { evidenceUnitId: counterId, stance: 'against' });
    }

    const { result } = await rescoreOpportunity(deps, ctx, opportunity.id, {
      cause: 'counter_evidence',
      context: { market: { competitorCount: 4, freeAlternativeCount: 3, competitorWeaknessCount: 3, observedMonthlySpend: [], momentum30d: 0.4 } },
    });

    // Willingness to pay must read as unknown, never as a confident zero.
    const wtp = result.dimensions.find((d) => d.key === 'willingness_to_pay');
    expect(wtp?.status).toBe('insufficient_evidence');
    expect(result.gaps.map((gap) => gap.key)).toContain('willingness_to_pay');

    // Twelve unrelated complaints are real corroboration that the problem
    // exists, and say nothing about whether anyone would pay to fix it. The
    // thesis is the latter, so confidence stays capped and says why.
    expect(result.confidence.value).toBeLessThanOrEqual(0.5);
    expect(result.confidence.cap.applied).toBe(true);
    expect(result.confidence.cap.reason).toContain('would pay');

    // And the free alternatives must show up in the competition assessment.
    const gap = result.dimensions.find((d) => d.key === 'competition_gap');
    expect(gap?.explanation).toContain('free');

    const opportunityAfter = await deps.repos.opportunities.findById(ctx.workspaceId, opportunity.id);
    expect(opportunityAfter?.state).toBe('detected');
  });
});

/**
 * The fourth acceptance test: on weak, noisy evidence the correct output is that
 * nothing warrants action. That is a feature, not a gap.
 */
describe('acceptance: no action warranted', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('keeps confidence at the floor when everything traces to one origin', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await createOpportunity(deps, ctx, {
      title: 'Something someone mentioned',
      thesis: 'A single blog post suggested this might be a problem worth solving.',
      typeKey: 'new_product',
    });

    for (let i = 0; i < 6; i += 1) {
      const evidenceId = await addEvidence(deps, ctx, {
        title: `Aggregator repost ${i}`,
        bodyText: `Republished commentary number ${i} about the same original blog post, adding a paragraph of opinion but no new observation.`,
        url: `https://aggregator.test/post-${i}`,
        signalTypeKey: 'trend',
        evidenceClass: 'social',
        observedAt: NOW,
      });
      await attachEvidence(deps, ctx, opportunity.id, { evidenceUnitId: evidenceId, stance: 'for' });
    }

    const { result } = await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'new_evidence' });

    // Six reposts from one domain is one source, so confidence stays capped.
    expect(result.confidence.value).toBeLessThanOrEqual(0.45);
    expect(result.confidence.cap.reason).toBeTruthy();
  });
});
