import { expect, test } from '@playwright/test';

test('debug record evidence', async ({ page }) => {
  page.on('console', (m) => console.log('CONSOLE', m.type(), m.text()));
  await page.goto('/setup');
  await page.getByLabel('Your name').fill('Manual Owner');
  await page.getByLabel('Workspace name').fill('Debug WS');
  await page.getByLabel('Email').fill(`owner-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('a-sufficiently-long-password');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/signals/new');
  await page.getByLabel('What was observed').fill('Restaurant pays for booking software that cannot take deposits');
  await page.getByLabel('The evidence itself').fill('We pay 180 a month for our booking system and it still cannot take a deposit, so we lose four or five covers every weekend to no-shows.');
  await page.getByLabel('What kind of signal is this?').selectOption('spending');
  await page.getByLabel('Where did it come from?').selectOption('direct_customer');
  await page.getByLabel('Who this came from').fill("Interview with Bella's");
  await page.getByLabel('Amount they pay per month').fill('180');
  await page.getByRole('button', { name: 'Record evidence' }).click();
  await page.waitForTimeout(2500);
  console.log('URL AFTER SUBMIT:', page.url());
  console.log('ALERTS:', await page.getByRole('alert').allInnerTexts());
  console.log('BODY:', (await page.locator('main').innerText()).slice(0, 900));
});
