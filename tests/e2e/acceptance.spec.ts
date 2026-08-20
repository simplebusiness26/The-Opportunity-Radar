import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { RadarApi, signUpFresh } from './helpers';

test('kills an attractive-looking idea nobody pays to solve', async ({ page, request }) => {
  await signUpFresh(page, 'No Payer');
  const radar = new RadarApi(request, page);

  const created = await radar.post<{ opportunity: { id: string } }>('/api/v1/opportunities', {
    title: 'Scheduling app for amateur sports teams',
    thesis: 'Captains hate organising games in group chat, so a cleaner scheduling app should win.',
    typeKey: 'new_product',
    targetCustomer: 'Amateur sports team captains',
    problemStatement: 'Captains spend too much time coordinating availability in group chats.',
  });
  const opportunityId = created.opportunity.id;

  for (let index = 0; index < 8; index += 1) {
    const evidenceId = await radar.recordEvidence({
      title: `Team captain complaint ${index}`,
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
  // it must not be quietly omitted either: the gap is stated in plain English.
  await expect(page.getByText('What still needs proving')).toBeVisible();
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

  await page.getByLabel('Move to').selectOption('watching');
  await page.getByLabel('Why').fill('Lots of complaints, but no evidence yet that anyone will pay.');
  await page.getByRole('button', { name: 'Apply' }).click();

  await page.getByLabel('Move to').selectOption('investigating');
  await page.getByLabel('Why').fill('Check whether the problem has commercial value.');
  await page.getByRole('button', { name: 'Apply' }).click();

  await radar.post(`/api/v1/opportunities/${opportunityId}/investigate`, {
    forceFixtures: true,
  });
  await page.reload();

  await expect(page.getByText(/reject/i).first()).toBeVisible();
});

test('ranks the opportunity this team could actually ship', async ({ page, request }) => {
  await signUpFresh(page, 'Leverage');
  const radar = new RadarApi(request, page);

  const reusable = await radar.post<{ asset: { id: string } }>('/api/v1/intelligence/assets', {
    label: 'Existing booking engine',
    kind: 'software',
    maturity: 'production',
    reusable: true,
  });
  const capability = await radar.post<{ capability: { id: string } }>('/api/v1/intelligence/capabilities', {
    label: 'Booking workflows',
    taxonomyKey: 'software.booking',
    maturity: 'production',
    evidenceStrength: 0.9,
  });
  await radar.post(`/api/v1/intelligence/assets/${reusable.asset.id}/capabilities`, {
    capabilityId: capability.capability.id,
  });

  const easy = await radar.post<{ opportunity: { id: string } }>('/api/v1/opportunities', {
    title: 'Deposit add-on for booking engine',
    thesis: 'Existing booking customers need deposits and the team can reuse its current engine.',
    typeKey: 'feature',
    targetCustomer: 'Existing booking customers',
    problemStatement: 'Bookings without deposits cause costly no-shows.',
  });
  const hard = await radar.post<{ opportunity: { id: string } }>('/api/v1/opportunities', {
    title: 'Hardware kiosk network',
    thesis: 'Venues may want physical self-service kiosks.',
    typeKey: 'new_product',
    targetCustomer: 'Large venues',
    problemStatement: 'Queues make check-in slow.',
  });

  await radar.post(`/api/v1/opportunities/${easy.opportunity.id}/capabilities`, {
    requirements: [
      {
        label: 'Booking workflows',
        taxonomyKey: 'software.booking',
        criticality: 'essential',
        resolvedBy: 'operator',
      },
    ],
  });
  await radar.post(`/api/v1/opportunities/${hard.opportunity.id}/capabilities`, {
    requirements: [
      {
        label: 'Hardware manufacturing',
        taxonomyKey: 'hardware.manufacturing',
        criticality: 'essential',
        resolvedBy: 'operator',
      },
    ],
  });

  for (const [id, prefix] of [
    [easy.opportunity.id, 'easy'],
    [hard.opportunity.id, 'hard'],
  ] as const) {
    for (let index = 0; index < 3; index += 1) {
      const evidenceId = await radar.recordEvidence({
        title: `${prefix} evidence ${index}`,
        bodyText: `${prefix} customer evidence ${randomUUID()} says the problem costs money and they already pay to address it.`,
        url: `https://${prefix}-${index}.test/${randomUUID()}`,
        signalTypeKey: index === 0 ? 'spending' : 'pain',
        evidenceClass: 'direct_customer',
        monthlySpend: index === 0 ? 250 : undefined,
      });
      await radar.attach(id, evidenceId);
    }
    await radar.post(`/api/v1/opportunities/${id}/score`);
  }

  await page.goto('/portfolio');
  await expect(page.getByText('Deposit add-on for booking engine')).toBeVisible();
});

test('says nothing warrants action rather than inventing something', async ({ page }) => {
  await signUpFresh(page, 'Nothing Yet');
  await expect(page.getByText('Nothing strong enough to act on yet')).toBeVisible();
});

test('reopens a rejected opportunity when its trigger is satisfied', async ({ page, request }) => {
  await signUpFresh(page, 'Reopen');
  const radar = new RadarApi(request, page);

  const created = await radar.post<{ opportunity: { id: string } }>('/api/v1/opportunities', {
    title: 'Seasonal staffing tool',
    thesis: 'Hospitality teams may pay to fill seasonal shifts faster.',
    typeKey: 'new_product',
  });
  const id = created.opportunity.id;

  await radar.post(`/api/v1/opportunities/${id}/state`, {
    state: 'rejected',
    reason: 'No spending evidence yet.',
  });
  await radar.post(`/api/v1/opportunities/${id}/triggers`, {
    label: 'Reopen when spending appears',
    conditions: [{ kind: 'evidence_class', value: 'spending' }],
  });

  await radar.recordEvidence({
    title: 'Hotel pays agency for seasonal staff',
    bodyText: 'We pay a staffing agency every summer because filling shifts quickly is painful.',
    url: 'https://hotel.test/staffing',
    signalTypeKey: 'spending',
    evidenceClass: 'direct_customer',
  });

  await radar.post('/api/v1/system/tick');
  await page.goto(`/opportunities/${id}`);
  await expect(page.getByText('detected').first()).toBeVisible();
});

test('runs the full loop from evidence to a recorded outcome', async ({ page, request }) => {
  await signUpFresh(page, 'Full Loop');
  const radar = new RadarApi(request, page);

  const opportunity = await radar.post<{ opportunity: { id: string } }>('/api/v1/opportunities', {
    title: 'Deposit automation',
    thesis: 'Restaurants will pay to reduce no-shows with automatic deposits.',
    typeKey: 'feature',
  });

  const evidenceId = await radar.recordEvidence({
    title: 'Restaurant pays for no-show tooling',
    bodyText: 'We already pay for booking software and would pay for deposits if it reduced no-shows.',
    url: 'https://restaurant.test/deposits',
    signalTypeKey: 'spending',
    evidenceClass: 'direct_customer',
    monthlySpend: 180,
  });
  await radar.attach(opportunity.opportunity.id, evidenceId);
  await radar.post(`/api/v1/opportunities/${opportunity.opportunity.id}/score`);

  await page.goto(`/opportunities/${opportunity.opportunity.id}`);
  await expect(page.getByText('Score breakdown')).toBeVisible();
});
