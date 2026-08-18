import { expect, test } from '@playwright/test';
import { FEEDBACK_TOKEN, RadarClient } from './helpers/api';

/**
 * The five acceptance tests.
 *
 * Each one exists because it is a way the product could plausibly be built and
 * be useless: an idea generator that cannot kill an idea, a ranking that
 * ignores who is asking, a system that always has an answer, a rejection that
 * is forgotten, and a loop that never closes.
 *
 * All five run with no AI provider and no network. That is not a limitation of
 * the tests — it is the claim that the load-bearing judgement is arithmetic
 * over recorded evidence rather than a model's opinion.
 */

test.describe.configure({ mode: 'serial' });

/**
 * Acceptance (b): kill an idea that looks attractive.
 *
 * Loud, widespread complaint, a free alternative, and nobody observed paying.
 * The system must refuse to promote it, and must refuse for a reason a person
 * can check against specific evidence.
 */
test('kills an attractive-looking idea nobody pays to solve', async ({ page }) => {
  const radar = await RadarClient.signUp(page, 'Kill It');

  const opportunityId = await radar.createOpportunity({
    title: 'Group scheduling for amateur sports clubs',
    thesis: 'Everyone complains about organising fixtures, so a tool for it should sell.',
    typeKey: 'new_product',
    problemStatement: 'Organising a weekly fixture across twenty people is painful.',
  });

  // Plenty of complaint, from genuinely different origins, and no money.
  for (let index = 0; index < 5; index += 1) {
    const evidenceId = await radar.recordEvidence({
      title: `Complaint thread ${index} about organising fixtures`,
      bodyText: `Organising our weekly game is a nightmare, thread ${index}. Everyone uses a different chat app and nobody replies to the poll in time. We just use a free group chat and a spreadsheet.`,
      url: `https://forum-${index}.test/thread-${index}`,
      signalTypeKey: 'pain',
      evidenceClass: 'community',
    });
    await radar.attach(opportunityId, evidenceId);
  }

  await radar.post(`/api/v1/opportunities/${opportunityId}/score`);
  await page.goto(`/opportunities/${opportunityId}`);

  // Willingness to pay is not established. It must not be scored as zero, and
  // it must not be quietly omitted either: the gap is stated.
  await expect(page.getByText('What has not been established')).toBeVisible();
  await expect(page.getByText(/willingness to pay/i).first()).toBeVisible();

  const detail = await radar.get<{ score?: { confidence: number } }>(
    `/api/v1/opportunities/${opportunityId}`,
  );
  /*
   * Complaint volume alone must not produce a confident recommendation. The
   * ceiling here is the unmeasured-decisive one: willingness to pay was never
   * established, so confidence is held at 50% no matter how many complaints
   * arrive, and the gap is named on screen above.
   */
  expect(detail.score!.confidence).toBeLessThanOrEqual(0.5);

  // And the lifecycle must not offer a route that skips validation.
  const options = await page.getByLabel('Move to').locator('option').allTextContents();
  expect(options.join(' ')).not.toContain('Execution');
});

/**
 * Acceptance (c): recognise a personal advantage.
 *
 * Two opportunities with near-identical external evidence. One reuses what this
 * team already has; the other does not. Attractiveness should barely differ;
 * leverage and fit should differ a lot, and the explanation should name the
 * specific asset.
 */
test('ranks the opportunity this team could actually ship', async ({ page }) => {
  const radar = await RadarClient.signUp(page, 'Our Advantage');

  await radar.post('/api/v1/intelligence/assets', {
    name: 'billing-service',
    assetKind: 'service',
    reuseReadiness: 'drop_in',
  });
  await radar.post('/api/v1/intelligence/capabilities', {
    name: 'Taking payments',
    capability: 'card payments',
    maturity: 'production',
    evidenceStrength: 0.9,
    providedBy: ['billing-service'],
  });
  await radar.post('/api/v1/intelligence/resources', {
    name: 'Engineering time',
    resourceKind: 'time',
    amount: 20,
    unit: 'days',
    period: 'month',
    committed: 0,
  });

  const shared = [
    {
      title: 'Operator describes the same manual process',
      bodyText: 'We do this by hand every week and it costs us most of a day of somebody senior.',
      signalTypeKey: 'labour',
      evidenceClass: 'direct_customer',
    },
    {
      title: 'Trade publication reports the same friction',
      bodyText: 'The report found the process is manual at most sites and is widely disliked.',
      signalTypeKey: 'pain',
      evidenceClass: 'primary',
    },
  ];

  const ids: string[] = [];
  for (const [index, opportunity] of [
    {
      title: 'Deposit handling, which we can build on our billing service',
      thesis: 'Taking deposits is the missing piece, and we already run payments.',
      requirement: 'card payments',
    },
    {
      title: 'Rota optimisation, which needs machine learning we do not have',
      thesis: 'Optimising rotas is the missing piece, and it needs modelling we have never built.',
      requirement: 'machine learning',
    },
  ].entries()) {
    const id = await radar.createOpportunity({
      title: opportunity.title,
      thesis: opportunity.thesis,
      typeKey: 'new_product',
    });

    for (const seed of shared) {
      const evidenceId = await radar.recordEvidence({
        ...seed,
        title: `${seed.title} (${index})`,
        url: `https://source-${index}-${seed.signalTypeKey}.test/item`,
      });
      await radar.attach(id, evidenceId);
    }

    await radar.put(`/api/v1/opportunities/${id}/requirements`, {
      requirements: [{ label: opportunity.requirement, criticality: 'essential' }],
    });
    await radar.post(`/api/v1/opportunities/${id}/score`);
    ids.push(id);
  }

  const [reusable, greenfield] = ids;

  const first = await radar.get<{ leverage?: { coverage: number; reusableAssets: string[]; explanation: string } }>(
    `/api/v1/opportunities/${reusable}/requirements`,
  );
  const second = await radar.get<{ leverage?: { coverage: number } }>(
    `/api/v1/opportunities/${greenfield}/requirements`,
  );

  expect(first.leverage!.coverage).toBeGreaterThan(second.leverage!.coverage + 0.3);
  // The explanation must name the actual asset, not merely assert an advantage.
  expect(first.leverage!.reusableAssets).toContain('billing-service');

  await page.goto('/portfolio');
  const body = await page.locator('main').innerText();
  expect(body.indexOf('Deposit handling')).toBeLessThan(
    body.indexOf('Rota optimisation') === -1 ? Number.MAX_SAFE_INTEGER : body.indexOf('Rota optimisation'),
  );
});

/**
 * Acceptance (d): say nothing warrants action when nothing does.
 *
 * A system that always has an answer is not measuring anything. The exact
 * sentence is asserted, because softening it later would quietly remove the
 * only outcome that costs the owner nothing.
 */
test('says nothing warrants action rather than inventing something', async ({ page }) => {
  const radar = await RadarClient.signUp(page, 'Null Result');

  const opportunityId = await radar.createOpportunity({
    title: 'Something with one thin source behind it',
    thesis: 'One person on one forum mentioned this once, which is not much to go on.',
    typeKey: 'new_product',
  });

  // Several observations, all from the same origin: mentions without
  // independence, which must not add up to confidence.
  for (let index = 0; index < 3; index += 1) {
    const evidenceId = await radar.recordEvidence({
      title: `Same-site observation ${index}`,
      bodyText: `Another note from the same site about the same thing, number ${index}. Nothing here says anyone paid for anything.`,
      url: `https://one-site.test/post-${index}`,
      signalTypeKey: 'pain',
      evidenceClass: 'social',
    });
    await radar.attach(opportunityId, evidenceId);
  }

  await radar.post(`/api/v1/opportunities/${opportunityId}/score`);
  await page.goto('/dashboard');

  await expect(
    page.getByText('NO HIGH-CONFIDENCE OPPORTUNITY CURRENTLY WARRANTS ACTION'),
  ).toBeVisible();
  // And it must offer the cheapest way to learn something, not just refuse.
  await expect(page.getByText(/Do not do yet|reduce/i).first()).toBeVisible();
});

/**
 * Acceptance (e): reopen a rejected opportunity when the world changes.
 *
 * The reopening must name the signal that caused it, or it is an assertion
 * rather than a record.
 */
test('reopens a rejected opportunity when its trigger is satisfied', async ({ page }) => {
  const radar = await RadarClient.signUp(page, 'Reopen');

  const opportunityId = await radar.createOpportunity({
    title: 'Deposit automation for restaurant bookings',
    thesis: 'Restaurants complain about no-shows and might pay to hold deposits.',
    typeKey: 'new_product',
  });

  const complaintId = await radar.recordEvidence({
    title: 'Owners complain about no-shows again',
    bodyText: 'Every weekend we lose covers to people who never turn up. It is infuriating.',
    url: 'https://restaurant-forum.test/no-shows',
    signalTypeKey: 'pain',
    evidenceClass: 'community',
  });
  await radar.attach(opportunityId, complaintId);
  await radar.post(`/api/v1/opportunities/${opportunityId}/score`);

  await radar.post(`/api/v1/opportunities/${opportunityId}/transition`, {
    toState: 'rejected',
    reason: 'Loud complaint, but nobody observed paying and a free workaround exists.',
  });

  await radar.post(`/api/v1/opportunities/${opportunityId}/triggers`, {
    kind: 'spending_observed',
    description: 'Someone is observed paying to solve this after all.',
    predicate: {
      signalTypes: ['spending'],
      anyOf: ['deposit'],
      requireIndependent: true,
      minMonthlyAmount: 1,
    },
  });

  // Nothing has changed yet.
  await radar.runNow('triggers.evaluate');
  await radar.drain();
  let current = await radar.get<{ opportunity?: { state: string } }>(
    `/api/v1/opportunities/${opportunityId}`,
  );
  expect(current.opportunity?.state).toBe('rejected');

  // The world changes.
  await radar.recordEvidence({
    title: 'Restaurant starts paying for a deposit tool',
    bodyText: 'We now pay 45 a month for a tool that takes a deposit at booking, and it has worked.',
    url: 'https://independent-hospitality.test/deposit-tool',
    signalTypeKey: 'spending',
    evidenceClass: 'direct_customer',
    monthlyAmount: 45,
  });

  await radar.runNow('triggers.evaluate');
  await radar.drain();

  current = await radar.get<{ opportunity?: { state: string } }>(
    `/api/v1/opportunities/${opportunityId}`,
  );
  expect(current.opportunity?.state).toBe('reopened');

  await page.goto(`/opportunities/${opportunityId}`);
  await expect(page.getByText('reopened').first()).toBeVisible();
  // The transition names the trigger, so the reopening can be checked.
  await expect(page.getByText(/observed paying to solve this/i).first()).toBeVisible();
});

/**
 * Acceptance (a): the whole loop, from evidence to a recorded outcome.
 *
 * Run entirely without an AI provider: the experiment is designed by a person,
 * which is a supported way to use Radar and the only way to prove the loop does
 * not depend on a credential.
 */
test('runs the full loop from evidence to a recorded outcome', async ({ page }) => {
  const radar = await RadarClient.signUp(page, 'Full Loop');

  await radar.post('/api/v1/intelligence/assets', {
    name: 'billing-service',
    assetKind: 'service',
    reuseReadiness: 'drop_in',
  });
  await radar.post('/api/v1/intelligence/capabilities', {
    name: 'Taking payments',
    capability: 'card payments',
    maturity: 'production',
    evidenceStrength: 0.9,
    providedBy: ['billing-service'],
  });

  const opportunityId = await radar.createOpportunity({
    title: 'Deposit automation for restaurant bookings',
    thesis: 'Independent restaurants already pay for booking software and will pay for deposits.',
    typeKey: 'new_product',
    targetCustomer: 'Independent restaurants with 20 to 60 covers',
    problemStatement: 'No-shows cost covers every weekend and deposits cannot be taken.',
  });

  for (const seed of [
    {
      title: 'Restaurant pays for booking software that cannot take deposits',
      bodyText: 'We pay 180 a month for our booking system and it still cannot take a deposit.',
      url: 'https://restaurant-owners.test/thread-1',
      signalTypeKey: 'spending',
      evidenceClass: 'direct_customer',
      monthlyAmount: 180,
    },
    {
      title: 'Second site pays a third-party tool for deposits',
      bodyText: 'We bolted on a payments tool at 45 a month purely to hold deposits.',
      url: 'https://independent-hospitality.test/deposits',
      signalTypeKey: 'spending',
      evidenceClass: 'direct_customer',
      monthlyAmount: 45,
    },
    {
      title: 'Trade body reports the cost of no-shows',
      bodyText: 'A survey put the annual cost of no-shows in the low thousands per site.',
      url: 'https://hospitality-association.test/report',
      signalTypeKey: 'pain',
      evidenceClass: 'primary',
    },
    {
      title: 'Booking platform limits deposits to its enterprise tier',
      bodyText: 'The feature is limited to their enterprise tier, well above an independent budget.',
      url: 'https://booking-vendor.test/changelog',
      signalTypeKey: 'competitor_weakness',
      evidenceClass: 'primary',
    },
  ]) {
    const evidenceId = await radar.recordEvidence(seed);
    await radar.attach(opportunityId, evidenceId);
  }

  await radar.put(`/api/v1/opportunities/${opportunityId}/requirements`, {
    requirements: [{ label: 'card payments', criticality: 'essential' }],
  });
  await radar.post(`/api/v1/opportunities/${opportunityId}/score`);

  // The brief refuses while nothing has been tested against real people.
  const early = await radar.get<{ brief: { readiness: { ready: boolean } }; markdown: string }>(
    `/api/v1/opportunities/${opportunityId}/brief`,
  );
  expect(early.brief.readiness.ready).toBe(false);
  expect(early.markdown).toContain('NOT READY TO BUILD');

  // A person walks it through the lifecycle, which is what manual mode is.
  for (const [toState, reason] of [
    ['investigating', 'Two sites are already paying for something adjacent; worth looking at properly.'],
    ['candidate', 'Nothing found so far kills it, and the spending is real.'],
  ] as const) {
    await radar.post(`/api/v1/opportunities/${opportunityId}/transition`, { toState, reason });
  }

  // A person designs the experiment. No provider is connected.
  const plan = await radar.post<{ planId: string }>(
    `/api/v1/opportunities/${opportunityId}/validation-plan`,
    {
      hypothesis: 'Independent restaurants will ask guests for card details to hold a booking.',
      whyItMatters: 'Everything else depends on guests tolerating it.',
      experimentType: 'customer_interview',
      audience: 'Owners of independent restaurants with 20 to 60 covers',
      steps: ['Contact ten owners', 'Ask what they do about no-shows today'],
      estimatedCost: 0,
      estimatedDays: 5,
      successThreshold: { description: 'At least four agree to trial it', metric: 'trial_agreements', value: 4 },
      failureThreshold: { description: 'Fewer than two will discuss it', metric: 'trial_agreements', value: 1 },
      doNotBuildYet: ['Payment integration', 'A mobile app'],
    },
  );

  const experiment = await radar.post<{ experiment: { id: string } }>('/api/v1/experiments', {
    opportunityId,
    validationPlanId: plan.planId,
    name: 'Ten owner interviews',
    budget: 0,
  });

  await radar.post(`/api/v1/experiments/${experiment.experiment.id}`, {
    toState: 'approved',
    reason: 'Agreed to run it.',
  });
  await radar.post(`/api/v1/experiments/${experiment.experiment.id}`, {
    toState: 'running',
    reason: 'Started calling owners.',
  });
  await radar.post(`/api/v1/experiments/${experiment.experiment.id}/results`, {
    metricKey: 'trial_agreements',
    value: 6,
  });

  const conclusion = await radar.post<{ verdict: string }>(
    `/api/v1/experiments/${experiment.experiment.id}/conclude`,
  );
  expect(conclusion.verdict).toBe('validated');

  // The machine reacts to the result on its own.
  await radar.drain();

  const afterExperiment = await radar.get<{ history?: Array<Record<string, unknown>> }>(
    `/api/v1/opportunities/${opportunityId}`,
  );
  // The result produced a new score rather than leaving the old one standing.
  expect((afterExperiment.history ?? []).length).toBeGreaterThan(1);

  await radar.post(`/api/v1/opportunities/${opportunityId}/transition`, {
    toState: 'validated',
    reason: 'Six of ten owners agreed to trial it, against a threshold of four.',
  });

  const ready = await radar.get<{ brief: { readiness: { ready: boolean } }; markdown: string }>(
    `/api/v1/opportunities/${opportunityId}/brief`,
  );
  expect(ready.brief.readiness.ready).toBe(true);
  expect(ready.markdown).toContain('Do not build yet');
  expect(ready.markdown).toContain('Payment integration');

  const handoff = await radar.post<{ handoff: { id: string }; ready: boolean }>(
    `/api/v1/opportunities/${opportunityId}/handoff`,
    { note: 'Build the deposit flow.' },
  );
  expect(handoff.ready).toBe(true);

  // The outcome comes back from whoever built it.
  const feedback = await page.request.post('/api/v1/execution/feedback', {
    headers: { authorization: `Bearer ${FEEDBACK_TOKEN}` },
    data: {
      handoffId: handoff.handoff.id,
      status: 'completed',
      outcome: 'shipped_and_used',
      actualBuildDays: 18,
      reason: 'Shipped in three weeks; four sites using it.',
    },
  });
  expect(feedback.ok()).toBe(true);

  await page.goto('/intelligence');
  await expect(page.getByText('Calibration')).toBeVisible();
  // One outcome is not enough to calibrate against, and it says so on screen.
  await expect(page.getByText(/1 of 8 completed projects/)).toBeVisible();
});
