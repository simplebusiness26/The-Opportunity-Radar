import { beforeEach, describe, expect, it } from 'vitest';
import { recordSignal } from '../../src/application/signals/record-signal';
import {
  attachEvidence,
  createOpportunity,
  transitionOpportunity,
} from '../../src/application/opportunities/lifecycle';
import { rescoreOpportunity } from '../../src/application/opportunities/score-opportunity';
import {
  recordCapability,
  recordAsset,
  recordResource,
} from '../../src/application/intelligence/capability-profile';
import {
  concludeExperiment,
  createExperiment,
  moveExperiment,
  recordExperimentResult,
} from '../../src/application/experiments/experiments';
import { buildExecutionBrief } from '../../src/application/execution/brief';
import { handOff } from '../../src/application/execution/handoff';
import { recordHandoffFeedback } from '../../src/application/execution/feedback';
import { readCalibration } from '../../src/application/memory/execution';
import { signUp } from '../../src/application/auth/sign-up';
import { resolveCapability } from '../../src/domain/taxonomy/capabilities';
import { investigateOpportunity } from '../../src/pipeline/investigations/runner';
import { deterministicNonce } from '../../src/pipeline/prompts/nonce';
import { projectEvents } from '../../src/jobs/event-router';
import type { AIProvider, CompletionRequest } from '../../src/ports/ai';
import type { SystemCtx, WorkspaceCtx } from '../../src/domain/types/identity';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { controllableClock } from '../../src/adapters/clock/index';

const NOW = new Date('2026-08-18T00:00:00Z');

function scriptedProvider(): AIProvider & { script: Record<string, unknown>; calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = [];
  const script: Record<string, unknown> = {};

  return {
    key: 'scripted',
    kind: 'fixture',
    calls,
    script,
    async complete(request) {
      calls.push(request);
      const answer = script[request.jsonSchema?.name ?? ''];
      if (answer === undefined) throw new Error(`No scripted answer for ${request.jsonSchema?.name}`);
      const text = JSON.stringify(answer);
      return {
        text,
        inputTokens: 200,
        outputTokens: 100,
        cachedInputTokens: 0,
        modelKey: request.modelKey,
        finishReason: 'stop',
      };
    },
    async embed() {
      throw new Error('not used');
    },
    async healthCheck() {
      return { ok: true, message: 'scripted' };
    },
    supports() {
      return true;
    },
  };
}

async function setup() {
  const account = await signUp(buildAuthDeps({ now: NOW }), {
    email: `owner-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-sufficiently-long-password',
    displayName: 'Owner',
    workspaceName: 'Radar HQ',
  });

  const { db } = testDb();
  const clock = controllableClock(NOW);
  const repos = createRepositories(db);
  const tx = createTransactor(db);

  const ctx: WorkspaceCtx = {
    workspaceId: account.workspaceId,
    orgId: 'unused',
    userId: account.userId,
    role: 'owner',
  };
  const systemCtx: SystemCtx = { workspaceId: account.workspaceId, orgId: 'unused', actor: 'system' };

  const provider = scriptedProvider();
  const providerRow = await repos.ai.upsertProvider(ctx.workspaceId, {
    kind: 'fixture',
    label: 'Scripted',
    enabled: true,
  });
  const model = await repos.ai.upsertModel(ctx.workspaceId, providerRow.id, {
    modelKey: 'scripted-1',
    label: 'Scripted',
    inputCostPerMtok: 1,
    outputCostPerMtok: 2,
  });
  for (const role of ['research', 'reasoning', 'high_value_decision'] as const) {
    await repos.ai.setRoute(ctx.workspaceId, role, { primaryModelId: model.id });
  }

  const deps = { repos, tx, clock };
  const investigation = {
    repos,
    tx,
    clock,
    gateway: { repos, clock, providerFor: async () => provider },
    nonce: deterministicNonce('test'),
  };

  return { deps, ctx, systemCtx, clock, investigation, provider };
}


const EVIDENCE = [
  {
    title: 'Restaurant pays for booking software that cannot take deposits',
    bodyText: 'We pay 180 a month for our booking system and it still cannot take a deposit, so we eat the loss every weekend.',
    url: 'https://restaurant-owners.test/thread-1',
    signalTypeKey: 'spending' as const,
    evidenceClass: 'direct_customer' as const,
    monetaryEvidence: { monthlyAmount: 180, currency: 'GBP' },
  },
  {
    title: 'Trade body reports the cost of no-shows',
    bodyText: 'A survey of member restaurants put the annual cost of no-shows in the low thousands per site.',
    url: 'https://hospitality-association.test/report',
    signalTypeKey: 'pain' as const,
    evidenceClass: 'primary' as const,
  },
  {
    title: 'Second site pays a third-party tool to take deposits',
    bodyText: 'We bolted on a payments tool at 45 a month purely to hold deposits, and it does not talk to the booking system.',
    url: 'https://independent-hospitality.test/deposits',
    signalTypeKey: 'spending' as const,
    evidenceClass: 'direct_customer' as const,
    monetaryEvidence: { monthlyAmount: 45, currency: 'GBP' },
  },
  {
    title: 'Owner describes chasing deposits by bank transfer',
    bodyText: 'We ask for a bank transfer for parties over six. Half of them never send it and we have stopped chasing.',
    url: 'https://kitchen-forum.test/deposits',
    signalTypeKey: 'workaround' as const,
    evidenceClass: 'direct_customer' as const,
  },
  {
    title: 'Booking platform limits deposits to its enterprise tier',
    bodyText: 'The feature is limited to their enterprise tier, well above what an independent site would pay.',
    url: 'https://booking-vendor.test/changelog',
    signalTypeKey: 'competitor_weakness' as const,
    evidenceClass: 'primary' as const,
  },
  {
    title: 'Card networks widen pre-authorisation to small merchants',
    bodyText: 'Pre-authorisation limits that applied only to larger merchants were extended to small hospitality accounts.',
    url: 'https://payments-regulator.test/bulletin',
    signalTypeKey: 'technology_unlock' as const,
    evidenceClass: 'primary' as const,
  },
];

function script(evidenceIds: string[]) {
  const [first, second, third] = evidenceIds;

  return {
    'investigation.market': {
      injectionAttempts: [],
      customerDescription: 'Independent restaurants with 20 to 60 covers',
      problemStatement: 'No-shows on weekends, with no practical way to hold a deposit.',
      currentAlternatives: ['Asking for a bank transfer by hand'],
      findings: [
        { claim: 'Owners already pay for booking software.', signalIds: [first!], confidence: 0.8, stance: 'for' },
      ],
      unknowns: ['How many covers are lost per weekend'],
    },
    'investigation.competitors': {
      injectionAttempts: [],
      competitors: [
        {
          name: 'An established booking platform',
          weaknesses: ['Deposits only on the enterprise tier'],
          pricingObserved: 'enterprise tier only',
          signalIds: [third!],
        },
      ],
      freeAlternatives: ['Asking for a bank transfer by hand'],
      gap: 'Nothing serves an independent site at an independent price.',
      findings: [],
    },
    'investigation.demand': {
      injectionAttempts: [],
      spendingEvidence: [
        { description: 'Pays 180 a month for booking software', monthlyAmount: 180, currency: 'GBP', signalIds: [first!] },
        { description: 'Pays 45 a month for a deposit bolt-on', monthlyAmount: 45, currency: 'GBP', signalIds: [third!] },
      ],
      unpaidComplaintCount: 1,
      willingnessToPayAssessment: 'demonstrated',
      findings: [],
    },
    'investigation.uncertainty': {
      injectionAttempts: [],
      items: [
        {
          kind: 'critical_unknown',
          statement: 'Whether restaurants will make guests enter card details at booking',
          impact: 0.9,
          resolvability: 0.8,
          estimatedCost: 0,
          estimatedDays: 2,
          signalIds: [second!],
        },
      ],
    },
    'investigation.red_team': {
      injectionAttempts: [],
      strongestObjection: 'Owners would have to replace a system they already pay for.',
      objections: [
        {
          category: 'switching_cost',
          argument: 'Owners already pay for a booking system and would have to replace it.',
          severity: 'serious',
          signalIds: [first!],
          disconfirmingTest: 'Ask ten owners whether they would switch.',
        },
      ],
      verdict: 'survivable',
      verdictReason: 'The objections are real but testable, and spending is already observed.',
    },
    'investigation.validation': {
      injectionAttempts: [],
      hypothesis: 'Independent restaurants will ask guests for card details to hold a booking.',
      whyItMatters: 'Everything else depends on guests tolerating it.',
      riskiestAssumption: 'Whether restaurants will make guests enter card details at booking',
      experimentType: 'customer_interview',
      audience: 'Owners of independent restaurants with 20 to 60 covers',
      steps: ['Contact ten owners', 'Ask what they do about no-shows today'],
      estimatedCost: 0,
      estimatedDays: 5,
      successThreshold: { description: 'At least four agree to trial it', metric: 'trial_agreements', value: 4 },
      failureThreshold: { description: 'Fewer than two will discuss it', metric: 'trial_agreements', value: 1 },
      evidenceToCollect: ['What they currently lose to no-shows'],
      doNotBuildYet: ['Payment integration', 'A mobile app'],
    },
  };
}

describe('the full loop', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  /**
   * Acceptance test (a): evidence in, built work out, outcome back.
   *
   * The point is not that each step works -- each has its own test -- but that
   * they compose: the score moves because an experiment ran, the brief refuses
   * until it should not, and the outcome written back reaches the calibration
   * that will judge the next estimate.
   */
  it('runs from evidence through to a recorded outcome', async () => {
    const { deps, ctx, systemCtx, investigation, provider } = await setup();

    // --- what we already have -------------------------------------------
    await recordAsset(deps, ctx, {
      name: 'billing-service',
      assetKind: 'service',
      reuseReadiness: 'drop_in',
    });
    await recordCapability(deps, ctx, {
      name: 'Card payments',
      capability: 'payments',
      maturity: 'production',
      evidenceStrength: 0.9,
      providedBy: ['billing-service'],
    });
    await recordResource(deps, ctx, {
      name: 'Engineering time',
      resourceKind: 'time',
      amount: 30,
      unit: 'days',
      period: 'month',
      committed: 0,
    });
    await recordResource(deps, ctx, {
      name: 'Budget',
      resourceKind: 'budget',
      amount: 5000,
      unit: 'GBP',
      period: 'month',
      committed: 0,
    });

    // --- evidence ---------------------------------------------------------
    const opportunity = await createOpportunity(deps, ctx, {
      title: 'Deposit automation for restaurant bookings',
      thesis: 'Independent restaurants already pay for booking software and will pay for deposits.',
      typeKey: 'new_product',
      targetCustomer: 'Independent restaurants with 20 to 60 covers',
      problemStatement: 'No-shows cost covers every weekend and deposits cannot be taken.',
    });

    const evidenceIds: string[] = [];
    for (const seed of EVIDENCE) {
      const recorded = await recordSignal(deps, ctx, { ...seed, observedAt: NOW });
      await attachEvidence(deps, ctx, opportunity.id, {
        evidenceUnitId: recorded.evidenceUnitId,
        stance: 'for',
      });
      evidenceIds.push(recorded.evidenceUnitId);
    }

    await deps.repos.opportunities.setCapabilityRequirements(ctx.workspaceId, opportunity.id, [
      {
        label: 'Card payments',
        // Resolved through the shared vocabulary, exactly as the interface
        // does; a raw string here would be a gap, not a match.
        taxonomyKey: resolveCapability('card payments').key,
        criticality: 'essential',
        resolvedBy: 'alias',
      },
    ]);

    const initial = await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'new_evidence' });
    expect(initial.score.attractiveness).not.toBeNull();

    // --- investigation, red team, validation plan -------------------------
    Object.assign(provider.script, script(evidenceIds));

    await investigateOpportunity(investigation, ctx, opportunity.id);
    await investigateOpportunity(investigation, ctx, opportunity.id);
    const planned = await investigateOpportunity(investigation, ctx, opportunity.id);
    expect(planned.stage).toBe('propose_validation');

    const plan = await deps.repos.validation.latestPlan(ctx.workspaceId, opportunity.id);
    expect(plan).not.toBeNull();

    const beforeExperiment = await deps.repos.scores.current(ctx.workspaceId, opportunity.id);

    // --- the brief refuses while nothing has been tested -------------------
    const early = await buildExecutionBrief(deps, ctx, opportunity.id);
    expect(early.brief.readiness.ready).toBe(false);
    expect(early.markdown).toContain('NOT READY TO BUILD');

    await expect(handOff(deps, ctx, opportunity.id)).rejects.toThrow(/real people|confidence|corroborated/i);

    // --- run the experiment ----------------------------------------------
    const experiment = await createExperiment(deps, ctx, {
      opportunityId: opportunity.id,
      validationPlanId: plan!.id,
      name: 'Ten owner interviews',
      budget: 0,
    });
    await moveExperiment(deps, ctx, experiment.id, { toState: 'approved', reason: 'Agreed to run it.' });
    await moveExperiment(deps, ctx, experiment.id, { toState: 'running', reason: 'Started calling owners.' });
    await recordExperimentResult(deps, ctx, experiment.id, { metricKey: 'trial_agreements', value: 6 });

    const conclusion = await concludeExperiment(deps, ctx, experiment.id);
    expect(conclusion.verdict).toBe('validated');

    // --- the machine reacts to the result ---------------------------------
    await projectEvents({ repos: deps.repos, clock: deps.clock });
    const rescored = await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'experiment_result' });

    expect(rescored.changed).toBe(true);
    expect(rescored.score.confidence).toBeGreaterThan(beforeExperiment?.confidence ?? 0);

    const deltas = await deps.repos.scores.recentDeltas(
      ctx.workspaceId,
      new Date(NOW.getTime() - 86_400_000),
    );
    expect(deltas.some((delta) => delta.cause === 'experiment_result')).toBe(true);

    // --- the human decides ------------------------------------------------
    await transitionOpportunity(deps, ctx, opportunity.id, {
      toState: 'validated',
      reason: 'Six of ten owners agreed to trial it, against a threshold of four.',
    });

    const ready = await buildExecutionBrief(deps, ctx, opportunity.id);
    expect(ready.brief.readiness.ready).toBe(true);
    expect(ready.markdown).toContain('Ready to build');
    // The brief carries what must not be built, not just what should.
    expect(ready.markdown).toContain('Payment integration');
    expect(ready.markdown).toContain('billing-service');

    // --- across the boundary ----------------------------------------------
    const handoff = await handOff(deps, ctx, opportunity.id, { note: 'Build the deposit flow.' });
    expect(handoff.ready).toBe(true);
    expect(handoff.overruled).toBeNull();

    const afterHandoff = await deps.repos.opportunities.findById(ctx.workspaceId, opportunity.id);
    expect(afterHandoff?.state).toBe('execution');

    const decisions = await deps.repos.decisions.list(ctx.workspaceId, 10);
    expect(decisions.some((decision) => decision.decision === 'handed_off')).toBe(true);

    // --- and the outcome comes back ---------------------------------------
    const feedback = await recordHandoffFeedback(deps, systemCtx, {
      handoffId: handoff.handoff.id,
      status: 'completed',
      outcome: 'shipped_and_used',
      actualBuildDays: 18,
      actualRevenue: 0,
      reason: 'Shipped in three weeks; four sites using it.',
    });

    expect(feedback.record).not.toBeNull();

    const history = await deps.repos.executionHistory.forOpportunity(ctx.workspaceId, opportunity.id);
    expect(history).toHaveLength(1);
    expect(history[0]?.actualBuildDays).toBe(18);
    expect(history[0]?.source).toBe('factory_feedback');
    // The prediction judged is the one the builder was actually given.
    expect(history[0]?.predictedConfidence).not.toBeNull();

    // One outcome is not enough to calibrate against, and it says so.
    const calibration = await readCalibration(deps.repos, ctx.workspaceId);
    expect(calibration.usable).toBe(false);
    expect(calibration.refusal).toContain('1 of 8');
  });
});

describe('the execution boundary', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('lets an owner overrule the readiness verdict, and records that they did', async () => {
    const { deps, ctx } = await setup();

    const opportunity = await createOpportunity(deps, ctx, {
      title: 'Something we want to build anyway',
      thesis: 'We are confident about this despite the evidence being thin.',
      typeKey: 'new_product',
    });
    const recorded = await recordSignal(deps, ctx, {
      title: 'One observation',
      bodyText: 'Somebody mentioned this once on a forum.',
      url: 'https://one-forum.test/thread',
      signalTypeKey: 'pain',
      evidenceClass: 'community',
      observedAt: NOW,
    });
    await attachEvidence(deps, ctx, opportunity.id, {
      evidenceUnitId: recorded.evidenceUnitId,
      stance: 'for',
    });
    await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'new_evidence' });

    await expect(handOff(deps, ctx, opportunity.id)).rejects.toThrow();

    const result = await handOff(deps, ctx, opportunity.id, {
      acknowledgeNotReady: true,
      note: 'Building it anyway; this is a strategic bet.',
    });

    expect(result.ready).toBe(false);
    expect(result.overruled).toBeTruthy();

    const decisions = await deps.repos.decisions.list(ctx.workspaceId, 10);
    const decision = decisions.find((entry) => entry.decision === 'handed_off');
    expect(decision?.radarRecommendation).toBe('not ready to build');
  });

  it('refuses handoff to anyone without the authority to commit work', async () => {
    const { deps, ctx } = await setup();
    const opportunity = await createOpportunity(deps, ctx, {
      title: 'Something',
      thesis: 'A thesis that will not be handed over by an analyst.',
      typeKey: 'new_product',
    });

    const analyst: WorkspaceCtx = { ...ctx, role: 'analyst' };
    await expect(handOff(deps, analyst, opportunity.id)).rejects.toThrow(/only an owner|decide/i);
  });

  it('snapshots the brief so later edits cannot change what was sent', async () => {
    const { deps, ctx } = await setup();

    const opportunity = await createOpportunity(deps, ctx, {
      title: 'Original title',
      thesis: 'The thesis as it stood when this was handed over.',
      typeKey: 'new_product',
    });
    await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'new_evidence' });

    const result = await handOff(deps, ctx, opportunity.id, { acknowledgeNotReady: true });

    await deps.repos.opportunities.update(
      ctx.workspaceId,
      opportunity.id,
      { title: 'Rewritten later' },
      NOW,
    );

    const stored = await deps.repos.handoffs.findById(ctx.workspaceId, result.handoff.id);
    expect(stored?.briefMarkdown).toContain('Original title');
    expect(stored?.briefMarkdown).not.toContain('Rewritten later');
  });

  it('refuses feedback that names no handoff', async () => {
    const { deps, systemCtx } = await setup();

    await expect(
      recordHandoffFeedback(deps, systemCtx, { status: 'completed' }),
    ).rejects.toThrow(/name the handoff/i);
  });
});
