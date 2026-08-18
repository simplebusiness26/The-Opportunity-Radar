import { expect, test, type Page } from '@playwright/test';

/**
 * The Phase 2 gate: a person runs the entire loop by hand, through the real
 * interface, with no AI provider and no external source connected.
 */

const unique = () => `owner-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function signUpFresh(page: Page, workspace: string): Promise<void> {
  await page.goto('/setup');
  await page.getByLabel('Your name').fill('Manual Owner');
  await page.getByLabel('Workspace name').fill(workspace);
  await page.getByLabel('Email').fill(unique());
  await page.getByLabel('Password').fill('a-sufficiently-long-password');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function recordEvidence(
  page: Page,
  input: { title: string; body: string; type: string; evidence: string; source?: string; monthly?: string },
): Promise<void> {
  await page.goto('/signals/new');
  await page.getByLabel('What was observed').fill(input.title);
  await page.getByLabel('The evidence itself').fill(input.body);
  await page.getByLabel('What kind of signal is this?').selectOption(input.type);
  await page.getByLabel('Where did it come from?').selectOption(input.evidence);
  if (input.source) await page.getByLabel('Who this came from').fill(input.source);
  if (input.monthly) await page.getByLabel('Amount they pay per month').fill(input.monthly);
  await page.getByRole('button', { name: 'Record evidence' }).click();

  // Assert the success outcome specifically. Accepting "an alert appeared"
  // would pass on the error alert too, which once hid a real failure until a
  // later step tripped over the missing data.
  await expect(
    page.getByText(/Recorded as new evidence|Matched existing evidence/i),
  ).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: /Could not record this/i })).toHaveCount(0);
}

test('a fresh installation reports manual mode honestly', async ({ page }) => {
  await signUpFresh(page, 'Honest Mode');

  // The chip renders in both the sidebar and the mobile header, and the
  // viewport hides one of them, so the assertion targets whichever is shown.
  await expect(page.locator('text=Manual mode >> visible=true')).toBeVisible();
  // It must say what is missing rather than implying it is doing more than it is.
  await expect(page.getByText('Connect an AI provider')).toBeVisible();
});

test('an empty installation says nothing warrants action, rather than inventing one', async ({ page }) => {
  await signUpFresh(page, 'Empty Radar');

  await expect(
    page.getByText('NO HIGH-CONFIDENCE OPPORTUNITY CURRENTLY WARRANTS ACTION'),
  ).toBeVisible();
  await expect(page.getByText('Do not do yet')).toBeVisible();
});

test('the full manual loop works with no AI configured', async ({ page }) => {
  await signUpFresh(page, 'Manual Loop');

  await recordEvidence(page, {
    title: 'Restaurant pays for booking software that cannot take deposits',
    body: 'We pay 180 a month for our booking system and it still cannot take a deposit, so we lose four or five covers every single weekend to no-shows.',
    type: 'spending',
    evidence: 'direct_customer',
    source: "Interview with Bella's",
    monthly: '180',
  });

  await recordEvidence(page, {
    title: 'Second restaurant describes the same loss',
    body: 'Every weekend we hold tables for bookings that never arrive. There is no way to charge a deposit through the system we already pay for.',
    type: 'pain',
    evidence: 'direct_customer',
    source: 'Interview with Fig and Vine',
  });

  await page.goto('/signals');
  await expect(page.getByText('Restaurant pays for booking software')).toBeVisible();
  await expect(page.getByText('Second restaurant describes')).toBeVisible();

  await page.goto('/opportunities/new');
  await page.getByLabel('Title').fill('Deposit automation for restaurant bookings');
  await page
    .getByLabel('Thesis')
    .fill('Independent restaurants already pay for booking software and will pay more for one that takes deposits automatically.');
  await page.getByLabel('What kind of move is this?').selectOption('new_product');
  await page.getByLabel('Who specifically').fill('Independent restaurants with 20 to 60 covers');
  await page.getByRole('button', { name: 'Create opportunity' }).click();

  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: /Deposit automation/ })).toBeVisible();

  // Scoring runs deterministically, with no provider connected.
  await page.getByRole('button', { name: 'Recalculate score' }).click();
  await expect(page.getByText('Score breakdown')).toBeVisible();

  // The gaps must be stated rather than hidden behind a confident number.
  await expect(page.getByText('What has not been established')).toBeVisible();

  // And the reasoning must be inspectable.
  await expect(page.getByText('Why this confidence')).toBeVisible();

  // Move it through the lifecycle with a recorded reason.
  await page.getByLabel('Move to').selectOption('watching');
  await page.getByLabel('Why').fill('Two independent restaurants, but nothing yet on what they would pay for a fix.');
  await page.getByRole('button', { name: 'Apply' }).click();

  await expect(page.getByText('watching').first()).toBeVisible();
  await expect(page.getByText('Two independent restaurants')).toBeVisible();
});

test('the interface refuses a state jump that skips validation', async ({ page }) => {
  await signUpFresh(page, 'Lifecycle Guard');

  await page.goto('/opportunities/new');
  await page.getByLabel('Title').fill('Something we want to rush');
  await page.getByLabel('Thesis').fill('We are certain about this and would like to skip ahead.');
  await page.getByRole('button', { name: 'Create opportunity' }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);

  // Execution must not even be offered from a bare detection.
  const options = await page.getByLabel('Move to').locator('option').allTextContents();
  expect(options.join(' ')).not.toContain('Execution');
  expect(options.join(' ')).toContain('Watching');
});

test('duplicate evidence is reported as a repeat, not counted twice', async ({ page }) => {
  await signUpFresh(page, 'Dedupe Check');

  const body =
    'Our booking system cannot take deposits, so no-shows cost us several covers every weekend and we simply absorb it.';

  await recordEvidence(page, {
    title: 'A restaurant on deposits',
    body,
    type: 'pain',
    evidence: 'community',
    source: 'Forum thread',
  });

  await page.goto('/signals/new');
  await page.getByLabel('What was observed').fill('The same thread, found again elsewhere');
  await page.getByLabel('The evidence itself').fill(body);
  await page.getByLabel('What kind of signal is this?').selectOption('pain');
  await page.getByLabel('Where did it come from?').selectOption('community');
  await page.getByRole('button', { name: 'Record evidence' }).click();

  await expect(page.getByText('Matched existing evidence', { exact: true })).toBeVisible();
  // Identical text is an exact match, so it is counted as a repeat mention of
  // the same claim rather than as a second, independent observation.
  await expect(page.getByText(/counted as a repeat mention rather than new evidence/)).toBeVisible();
});

/**
 * Investigation is the first feature that genuinely cannot work without a
 * provider. It has to say so plainly and stay out of the way, rather than
 * offering a control that fails or a spinner that never resolves.
 */
test('investigation says it needs a provider rather than pretending', async ({ page }) => {
  await signUpFresh(page, 'No Provider');

  await page.goto('/opportunities/new');
  await page.getByLabel('Title').fill('Something worth investigating one day');
  await page
    .getByLabel('Thesis')
    .fill('There may be something here, but nothing has been researched about it yet.');
  await page.getByRole('button', { name: 'Create opportunity' }).click();
  await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}$/);

  await expect(page.getByRole('button', { name: 'Investigate' })).toBeDisabled();
  await expect(page.getByText('Investigation needs an AI provider')).toBeVisible();
  await expect(page.getByText('No AI provider is connected, so nothing can be investigated')).toBeVisible();
});

test('Ask Radar searches the workspace and does not pretend to answer', async ({ page }) => {
  await signUpFresh(page, 'Ask Without AI');

  await recordEvidence(page, {
    title: 'Restaurant pays for booking software that cannot take deposits',
    body: 'We pay 180 a month for our booking system and it still cannot take a deposit, so we lose covers every weekend to no-shows.',
    type: 'spending',
    evidence: 'direct_customer',
    source: "Interview with Bella's",
    monthly: '180',
  });

  await page.goto('/ask');
  await page.getByLabel('Your question').fill('What do restaurants pay for booking software?');
  await page.getByRole('button', { name: 'Ask' }).click();

  // No provider, so it returns the records rather than composing prose, and
  // says which of the two it is doing.
  await expect(page.getByText('No answer was composed')).toBeVisible();
  await expect(page.getByText('Restaurant pays for booking software')).toBeVisible();
});

test('Ask Radar refuses a question the workspace has no records about', async ({ page }) => {
  await signUpFresh(page, 'Ask Out Of Scope');

  await page.goto('/ask');
  await page
    .getByLabel('Your question')
    .fill('What are the current shipping tariffs between Chile and Norway?');
  await page.getByRole('button', { name: 'Ask' }).click();

  await expect(page.getByText('no records')).toBeVisible();
  await expect(page.getByText('Nothing in this workspace matched')).toBeVisible();
});

test('setting up says what is missing and why it matters', async ({ page }) => {
  await signUpFresh(page, 'Setup Checklist');

  await expect(page.getByText('Radar is judging with half the picture')).toBeVisible();

  await page.goto('/onboarding');
  await expect(
    page.getByRole('link', { name: 'Record what you can already build' }),
  ).toBeVisible();
  await expect(page.getByText('Nothing recorded, so fit and leverage cannot be scored at all.')).toBeVisible();

  // Connecting AI is genuinely optional and must be labelled as such.
  await expect(page.getByText('optional').first()).toBeVisible();
});
