import { beforeEach, describe, expect, it } from 'vitest';
import { recordSignal } from '../../src/application/signals/record-signal';
import { attachEvidence, createOpportunity } from '../../src/application/opportunities/lifecycle';
import { rescoreOpportunity } from '../../src/application/opportunities/score-opportunity';
import { readInvestigationLog } from '../../src/application/opportunities/investigation-log';
import {
  concludeExperiment,
  createExperiment,
  moveExperiment,
  recordExperimentResult,
} from '../../src/application/experiments/experiments';
import { signUp } from '../../src/application/auth/sign-up';
import { investigateOpportunity } from '../../src/pipeline/investigations/runner';
import { deterministicNonce } from '../../src/pipeline/prompts/nonce';
import type { AIProvider, CompletionRequest } from '../../src/ports/ai';
import type { WorkspaceCtx } from '../../src/domain/types/identity';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { controllableClock } from '../../src/adapters/clock/index';

const NOW = new Date('2026-08-18T00:00:00Z');

/**
 * A provider that answers from a script keyed by schema name.
 *
 * Scripted rather than recorded, because these tests are about the
 * orchestration and the projection -- what the runner does with an answer -- and
 * a hand-written answer states the case under test far more clearly than a
 * captured one.
 */
function scriptedProvider(): AIProvider & {
  calls: CompletionRequest[];
  script: Record<string, unknown>;
} {
  const calls: CompletionRequest[] = [];
  const script: Record<string, unknown> = {};

  return {
    key: 'scripted',
    kind: 'fixture',
    calls,
    script,
    async complete(request) {
      calls.push(request);
      const name = request.jsonSchema?.name ?? '';
      const answer = script[name];
      if (answer === undefined) throw new Error(`No scripted answer for ${name}`);

      const text = JSON.stringify(answer);
      return {
        text,
        inputTokens: Math.ceil(request.user.length / 4),
        outputTokens: Math.ceil(text.length / 4),
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

/**
 * Installs the answers.
 *
 * The provider is built before the evidence exists, but every answer has to
 * cite real evidence ids, so the script arrives afterwards.
 */
function install(
  provider: ReturnType<typeof scriptedProvider>,
  script: Record<string, unknown>,
): void {
  for (const key of Object.keys(provider.script)) delete provider.script[key];
  Object.assign(provider.script, script);
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

  const provider = scriptedProvider();

  // A provider, a model with real prices, and a route per role: exactly what
  // an owner would configure, so the gateway is exercised rather than bypassed.
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

  return { deps, ctx, clock, investigation, provider };
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

/** An opportunity with enough independent evidence to earn investigation. */
async function seedInvestigable(deps: Deps, ctx: WorkspaceCtx) {
  const opportunity = await createOpportunity(deps, ctx, {
    title: 'Deposit-taking for independent restaurants',
    thesis: 'Independent restaurants lose covers to no-shows and cannot easily take deposits.',
    typeKey: 'new_product',
    targetCustomer: 'Independent restaurants with 20 to 60 covers',
    problemStatement: 'No-shows cost money and existing booking tools cannot take a deposit.',
  });

  const ids: string[] = [];
  const seeds = [
    {
      title: 'Restaurant pays for booking software that cannot take deposits',
      bodyText:
        'We pay 180 a month for our booking system and it still cannot take a deposit, so we eat the loss every weekend.',
      url: 'https://restaurant-owners.test/thread-1',
      signalTypeKey: 'spending' as const,
      evidenceClass: 'direct_customer' as const,
      monetaryEvidence: { monthlyAmount: 180, currency: 'GBP' },
    },
    {
      title: 'Trade body reports no-show costs',
      bodyText:
        'A survey of member restaurants put the annual cost of no-shows in the low thousands per site, concentrated on weekends.',
      url: 'https://hospitality-association.test/report',
      signalTypeKey: 'pain' as const,
      evidenceClass: 'primary' as const,
    },
    {
      title: 'Owner describes chasing deposits by bank transfer',
      bodyText:
        'We ask for a bank transfer for parties over six. Half of them never send it and we have stopped chasing.',
      url: 'https://kitchen-forum.test/deposits',
      signalTypeKey: 'workaround' as const,
      evidenceClass: 'direct_customer' as const,
    },
    {
      title: 'Booking platform announces deposit feature for enterprise only',
      bodyText:
        'The feature is limited to their enterprise tier, which starts well above what an independent site would pay.',
      url: 'https://booking-vendor.test/changelog',
      signalTypeKey: 'competitor_weakness' as const,
      evidenceClass: 'primary' as const,
    },
    {
      title: 'Second site pays a third-party tool to take deposits',
      bodyText:
        'We bolted on a payments tool at 45 a month purely to hold deposits, and it does not talk to the booking system at all.',
      url: 'https://independent-hospitality.test/deposits-thread',
      signalTypeKey: 'spending' as const,
      evidenceClass: 'direct_customer' as const,
      monetaryEvidence: { monthlyAmount: 45, currency: 'GBP' },
    },
    {
      title: 'Card networks widen support for pre-authorisation on small merchants',
      bodyText:
        'Pre-authorisation limits that previously applied only to larger merchants were extended to small hospitality accounts this year.',
      url: 'https://payments-regulator.test/bulletin',
      signalTypeKey: 'technology_unlock' as const,
      evidenceClass: 'primary' as const,
    },
  ];

  for (const seed of seeds) {
    const id = await addEvidence(deps, ctx, { ...seed, observedAt: NOW });
    await attachEvidence(deps, ctx, opportunity.id, { evidenceUnitId: id, stance: 'for' });
    ids.push(id);
  }

  await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'new_evidence' });
  return { opportunity, evidenceIds: ids };
}

function investigationScript(evidenceIds: string[], overrides: Record<string, unknown> = {}) {
  const [first, second, third] = evidenceIds;

  return {
    'investigation.market': {
      injectionAttempts: [],
      customerDescription: 'Independent restaurants with 20 to 60 covers',
      problemStatement: 'No-shows on weekends, with no practical way to hold a deposit.',
      currentAlternatives: ['Bank transfer requested by hand', 'Accepting the loss'],
      findings: [
        { claim: 'Owners already pay for booking software.', signalIds: [first], confidence: 0.8, stance: 'for' },
        { claim: 'A rival system covers every restaurant in Britain.', signalIds: ['invented-id'], confidence: 0.9, stance: 'against' },
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
          signalIds: [third ?? first],
        },
      ],
      freeAlternatives: ['Asking for a bank transfer by hand'],
      gap: 'Nothing serves an independent site at an independent price.',
      findings: [],
    },
    'investigation.demand': {
      injectionAttempts: [],
      spendingEvidence: [
        { description: 'Pays 180 a month for booking software', monthlyAmount: 180, currency: 'GBP', signalIds: [first] },
      ],
      unpaidComplaintCount: 2,
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
          signalIds: [second ?? first],
        },
        {
          kind: 'known_fact',
          statement: 'Independent sites already pay for booking software',
          impact: 0.2,
          resolvability: 1,
          estimatedCost: 0,
          estimatedDays: 0,
          signalIds: [],
        },
      ],
    },
    'investigation.red_team': {
      injectionAttempts: [],
      strongestObjection: 'Restaurants may not risk asking guests for card details.',
      objections: [
        {
          category: 'switching_cost',
          argument: 'Owners already pay for a booking system and would have to replace it.',
          severity: 'serious',
          signalIds: [first],
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
      steps: ['Contact ten owners', 'Ask what they do about no-shows today', 'Offer to trial a deposit link'],
      estimatedCost: 0,
      estimatedDays: 5,
      successThreshold: { description: 'At least four agree to trial it', metric: 'trial_agreements', value: 4 },
      failureThreshold: { description: 'Fewer than two will discuss it', metric: 'trial_agreements', value: 1 },
      evidenceToCollect: ['What they currently lose to no-shows'],
      doNotBuildYet: ['Payment integration', 'A mobile app'],
      ...(overrides['investigation.validation'] as object | undefined),
    },
    ...overrides,
  };
}

describe('investigation', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('refuses to spend on an opportunity with too little independent evidence', async () => {
    const { deps, ctx, investigation, provider } = await setup();

    const opportunity = await createOpportunity(deps, ctx, {
      title: 'Something loudly complained about',
      thesis: 'People complain about this constantly on one forum.',
      typeKey: 'new_product',
    });
    const evidenceId = await addEvidence(deps, ctx, {
      title: 'A complaint',
      bodyText: 'This is infuriating and someone should fix it.',
      url: 'https://one-forum.test/thread',
      signalTypeKey: 'pain',
      evidenceClass: 'community',
      observedAt: NOW,
    });
    await attachEvidence(deps, ctx, opportunity.id, { evidenceUnitId: evidenceId, stance: 'for' });

    const outcome = await investigateOpportunity(investigation, ctx, opportunity.id);

    expect(outcome.proceeded).toBe(false);
    expect(outcome.stage).toBe('collect_more');
    expect(outcome.needed).toContain('independent source');
    // The point of the gate: no money was spent reaching that conclusion.
    expect(provider.calls).toHaveLength(0);

    const runs = await deps.repos.investigations.listFor(ctx.workspaceId, 'opportunity', opportunity.id);
    expect(runs[0]?.state).toBe('terminated');
    expect(runs[0]?.terminationReason).toContain('independent');
  });

  it('runs the investigation stage and records what each role concluded', async () => {
    const { deps, ctx, investigation, provider } = await setup();
    const { opportunity, evidenceIds } = await seedInvestigable(deps, ctx);
    install(provider, investigationScript(evidenceIds));

    const outcome = await investigateOpportunity(investigation, ctx, opportunity.id);

    expect(outcome.proceeded).toBe(true);
    expect(outcome.stage).toBe('investigate');
    expect(outcome.runs.filter((run) => run.status === 'complete').map((run) => run.role)).toEqual([
      'market',
      'competitors',
      'demand',
      'uncertainty',
    ]);

    const log = await readInvestigationLog(deps.repos, ctx, opportunity.id);
    const market = log.entries.find((entry) => entry.schemaKey === 'investigation.market');
    expect(market?.payload?.customerDescription).toContain('Independent restaurants');

    // The invented citation is dropped and reported rather than stored.
    expect(market?.correction).toContain('invented citation');
    const findings = market?.payload?.findings as Array<{ claim: string }>;
    expect(findings).toHaveLength(1);
    expect(findings[0]?.claim).toContain('already pay');

    // A "known fact" citing nothing is recorded as an assumption, not a fact.
    const kinds = log.uncertainty.map((item) => item.kind);
    expect(kinds).toContain('critical_unknown');
    expect(kinds).not.toContain('known_fact');
    expect(log.uncertainty[0]?.kind).toBe('critical_unknown');

    const updated = await deps.repos.opportunities.findById(ctx.workspaceId, opportunity.id);
    expect(updated?.state).toBe('investigating');
    expect(log.totalSpentUsd).toBeGreaterThan(0);
  });

  it('promotes to candidate only after surviving the red team', async () => {
    const { deps, ctx, investigation, provider } = await setup();
    const { opportunity, evidenceIds } = await seedInvestigable(deps, ctx);
    install(provider, investigationScript(evidenceIds));

    await investigateOpportunity(investigation, ctx, opportunity.id);
    const redTeamRun = await investigateOpportunity(investigation, ctx, opportunity.id);

    expect(redTeamRun.stage).toBe('red_team');
    expect(redTeamRun.recommendation).toBe('promote');

    const updated = await deps.repos.opportunities.findById(ctx.workspaceId, opportunity.id);
    expect(updated?.state).toBe('candidate');
  });

  /**
   * Acceptance test (b): an idea that looks attractive and is not.
   *
   * Loud complaint, a free alternative, and nobody paying. The system has to be
   * able to say so, name the evidence, and stop -- without a human prompting it.
   */
  it('recommends rejecting a loud problem nobody pays to solve', async () => {
    const { deps, ctx, investigation, provider } = await setup();
    const { opportunity, evidenceIds } = await seedInvestigable(deps, ctx);

    const script = investigationScript(evidenceIds, {
      'investigation.demand': {
        injectionAttempts: [],
        spendingEvidence: [],
        unpaidComplaintCount: 12,
        willingnessToPayAssessment: 'absent',
        findings: [],
      },
      'investigation.red_team': {
        injectionAttempts: [],
        strongestObjection: 'Everybody complains and nobody has ever paid for a fix.',
        objections: [
          {
            category: 'complaints_without_purchase',
            argument: 'Twelve complaints, no observed spending, and a free workaround people already use.',
            severity: 'fatal',
            signalIds: [evidenceIds[0]!, evidenceIds[1]!],
            disconfirmingTest: 'Find one restaurant that has paid anything to solve this.',
          },
        ],
        verdict: 'fatal',
        verdictReason: 'Volume of complaint has not become spending anywhere in the evidence.',
      },
    });
    install(provider, script);

    await investigateOpportunity(investigation, ctx, opportunity.id);
    const outcome = await investigateOpportunity(investigation, ctx, opportunity.id);

    expect(outcome.recommendation).toBe('reject');
    expect(outcome.recommendationReason).toContain('judged fatal');

    // Counter-evidence is attached as rows a person can read, not a summary.
    expect(outcome.counterEvidenceAttached).toBe(2);
    const attached = await deps.repos.opportunities.evidenceFor(opportunity.id);
    const against = attached.filter((row) => row.stance === 'against');
    expect(against.map((row) => row.evidenceUnitId).sort()).toEqual(
      [evidenceIds[0]!, evidenceIds[1]!].sort(),
    );

    // Radar recommends; it does not decide. The state never reaches candidate.
    const updated = await deps.repos.opportunities.findById(ctx.workspaceId, opportunity.id);
    expect(updated?.state).toBe('watching');

    const alerts = await deps.repos.alerts.list(ctx.workspaceId, { limit: 10 });
    expect(alerts.some((alert) => alert.kind === 'rejection_recommended')).toBe(true);
  });

  /**
   * The same conclusion reached without the red team saying "fatal".
   *
   * Complaint volume, a free alternative and no observed spending is the
   * pattern this product exists to catch, and it has to catch it from the
   * evidence rather than from a model agreeing that it is fatal.
   */
  it('recommends rejecting on the evidence pattern even when the red team hedges', async () => {
    const { deps, ctx, investigation, provider } = await setup();
    const { opportunity, evidenceIds } = await seedInvestigable(deps, ctx);

    install(
      provider,
      investigationScript(evidenceIds, {
        'investigation.demand': {
          injectionAttempts: [],
          spendingEvidence: [],
          unpaidComplaintCount: 9,
          willingnessToPayAssessment: 'absent',
          findings: [],
        },
        'investigation.red_team': {
          injectionAttempts: [],
          strongestObjection: 'People may simply live with this.',
          objections: [
            {
              category: 'free_substitute',
              argument: 'Asking for a bank transfer costs nothing and is already what people do.',
              severity: 'serious',
              signalIds: [evidenceIds[2]!],
              disconfirmingTest: 'Find a site that has paid to replace the manual process.',
            },
          ],
          verdict: 'serious_but_testable',
          verdictReason: 'Worth testing, but the free workaround is a real threat.',
        },
      }),
    );

    await investigateOpportunity(investigation, ctx, opportunity.id);
    const outcome = await investigateOpportunity(investigation, ctx, opportunity.id);

    expect(outcome.recommendation).toBe('reject');
    expect(outcome.recommendationReason).toContain('Volume of complaint is not demand');

    const updated = await deps.repos.opportunities.findById(ctx.workspaceId, opportunity.id);
    expect(updated?.state).toBe('watching');
  });

  it('downgrades a fatal verdict that cites nothing supplied', async () => {
    const { deps, ctx, investigation, provider } = await setup();
    const { opportunity, evidenceIds } = await seedInvestigable(deps, ctx);

    install(
      provider,
      investigationScript(evidenceIds, {
        'investigation.red_team': {
          injectionAttempts: [],
          strongestObjection: 'I am confident this cannot work.',
          objections: [
            {
              category: 'poor_economics',
              argument: 'The economics never work at this scale.',
              severity: 'fatal',
              signalIds: ['not-a-real-id'],
              disconfirmingTest: null,
            },
          ],
          verdict: 'fatal',
          verdictReason: 'It simply will not work.',
        },
      }),
    );

    await investigateOpportunity(investigation, ctx, opportunity.id);
    const outcome = await investigateOpportunity(investigation, ctx, opportunity.id);

    expect(outcome.recommendation).not.toBe('reject');

    const log = await readInvestigationLog(deps.repos, ctx, opportunity.id);
    const redTeam = log.entries.find((entry) => entry.schemaKey === 'investigation.red_team');
    expect(redTeam?.payload?.verdict).toBe('serious_but_testable');
    expect(redTeam?.payload?.verdictDowngradedFrom).toBe('fatal');
    expect(outcome.counterEvidenceAttached).toBe(0);
  });

  it('designs a validation plan and links it to the unknown it tests', async () => {
    const { deps, ctx, investigation, provider } = await setup();
    const { opportunity, evidenceIds } = await seedInvestigable(deps, ctx);
    install(provider, investigationScript(evidenceIds));

    await investigateOpportunity(investigation, ctx, opportunity.id);
    await investigateOpportunity(investigation, ctx, opportunity.id);
    const outcome = await investigateOpportunity(investigation, ctx, opportunity.id);

    expect(outcome.stage).toBe('propose_validation');

    const plan = await deps.repos.validation.latestPlan(ctx.workspaceId, opportunity.id);
    expect(plan?.hypothesis).toContain('card details');
    expect(plan?.doNotBuildYet).toContain('Payment integration');
    expect(plan?.successThreshold.value).toBe(4);

    const updated = await deps.repos.opportunities.findById(ctx.workspaceId, opportunity.id);
    expect(updated?.state).toBe('validation_ready');
  });

  it('holds rather than fails when no model is assigned', async () => {
    const { deps, ctx, investigation, provider } = await setup();
    const { opportunity, evidenceIds } = await seedInvestigable(deps, ctx);
    install(provider, investigationScript(evidenceIds));

    for (const role of ['research', 'reasoning', 'high_value_decision'] as const) {
      await deps.repos.ai.setRoute(ctx.workspaceId, role, { primaryModelId: null });
    }

    const outcome = await investigateOpportunity(investigation, ctx, opportunity.id);

    expect(outcome.blockedBy).toContain('No model is assigned');
    const runs = await deps.repos.investigations.listFor(ctx.workspaceId, 'opportunity', opportunity.id);
    expect(runs.some((run) => run.state === 'blocked')).toBe(true);
    expect(runs.some((run) => run.state === 'failed')).toBe(false);
  });
});

describe('experiments', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  async function readyExperiment() {
    const { deps, ctx, investigation, provider } = await setup();
    const { opportunity, evidenceIds } = await seedInvestigable(deps, ctx);
    install(provider, investigationScript(evidenceIds));

    await investigateOpportunity(investigation, ctx, opportunity.id);
    await investigateOpportunity(investigation, ctx, opportunity.id);
    await investigateOpportunity(investigation, ctx, opportunity.id);

    const plan = await deps.repos.validation.latestPlan(ctx.workspaceId, opportunity.id);
    const experiment = await createExperiment(deps, ctx, {
      opportunityId: opportunity.id,
      validationPlanId: plan?.id ?? null,
      name: 'Ten owner interviews',
      budget: 0,
    });

    return { deps, ctx, opportunity, experiment };
  }

  it('refuses to record a result before the experiment has run', async () => {
    const { deps, ctx, experiment } = await readyExperiment();

    await expect(
      recordExperimentResult(deps, ctx, experiment.id, { metricKey: 'trial_agreements', value: 9 }),
    ).rejects.toThrow(/cannot record results/i);
  });

  it('judges the result against the thresholds agreed beforehand', async () => {
    const { deps, ctx, experiment } = await readyExperiment();

    await moveExperiment(deps, ctx, experiment.id, { toState: 'approved', reason: 'Agreed to run it.' });
    await moveExperiment(deps, ctx, experiment.id, { toState: 'running', reason: 'Started calling owners.' });
    await recordExperimentResult(deps, ctx, experiment.id, { metricKey: 'trial_agreements', value: 5 });

    const conclusion = await concludeExperiment(deps, ctx, experiment.id);

    expect(conclusion.verdict).toBe('validated');
    expect(conclusion.confidenceDelta).toBeGreaterThan(0);
    expect(conclusion.explanation).toContain('5');
    expect(conclusion.experiment.state).toBe('completed');
  });

  it('calls a result between the thresholds neither a success nor a failure', async () => {
    const { deps, ctx, experiment } = await readyExperiment();

    await moveExperiment(deps, ctx, experiment.id, { toState: 'approved', reason: 'Agreed to run it.' });
    await moveExperiment(deps, ctx, experiment.id, { toState: 'running', reason: 'Started calling owners.' });
    await recordExperimentResult(deps, ctx, experiment.id, { metricKey: 'trial_agreements', value: 2 });

    const conclusion = await concludeExperiment(deps, ctx, experiment.id);

    expect(conclusion.verdict).toBe('partially_validated');
    // Real-world evidence moves the score, and says why.
    const events = await deps.repos.events.listUnprocessed(50);
    expect(events.some((event) => event.kind === 'experiment.result_recorded')).toBe(true);
  });

  it('will not reopen an experiment that has concluded', async () => {
    const { deps, ctx, experiment } = await readyExperiment();

    await moveExperiment(deps, ctx, experiment.id, { toState: 'approved', reason: 'Agreed to run it.' });
    await moveExperiment(deps, ctx, experiment.id, { toState: 'running', reason: 'Started calling owners.' });
    await recordExperimentResult(deps, ctx, experiment.id, { metricKey: 'trial_agreements', value: 5 });
    await concludeExperiment(deps, ctx, experiment.id);

    await expect(
      moveExperiment(deps, ctx, experiment.id, { toState: 'running', reason: 'One more call.' }),
    ).rejects.toThrow(/cannot be reopened/i);
  });
});
