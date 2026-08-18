import { expect, test } from '@playwright/test';

/**
 * Phase 0 gate. Proves the toolchain end to end: the production build boots,
 * serves a page, and renders in both the desktop and mobile projects against
 * the pinned Chromium in this image.
 */
test('the application boots and serves a page', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

test('the page never scrolls sideways', async ({ page }) => {
  await page.goto('/');
  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  expect(overflows).toBe(false);
});
