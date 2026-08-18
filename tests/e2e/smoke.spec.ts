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


/**
 * The bottom navigation is fixed, so if it ever grows past the clearance the
 * page reserves for it, it silently covers the end of every page on a phone --
 * which is how a hardcoded column count broke evidence recording once already.
 */
test('the mobile navigation stays one row tall and clears page content', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile viewport only');

  await page.goto('/sign-in');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await expect(nav).toBeHidden();

  await page.goto('/setup');
  await page.getByLabel('Your name').fill('Nav Check');
  await page.getByLabel('Workspace name').fill('Nav Check');
  await page.getByLabel('Email').fill(`nav-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('a-sufficiently-long-password');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  const box = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
  expect(box).not.toBeNull();
  // One row of 56px touch targets plus safe-area padding. Two rows would exceed
  // the 96px (pb-24) clearance that main reserves.
  expect(box!.height).toBeLessThanOrEqual(96);

  // The bar is deliberately capped: a phone bar with eight targets is one
  // nobody hits accurately.
  const links = page.getByRole('navigation', { name: 'Primary' }).getByRole('link');
  const count = await links.count();
  expect(count).toBeLessThanOrEqual(5);

  for (let index = 0; index < count; index += 1) {
    const linkBox = await links.nth(index).boundingBox();
    expect(linkBox).not.toBeNull();
    // Comfortably above the 44px minimum touch target on its short axis.
    expect(linkBox!.height).toBeGreaterThanOrEqual(44);
    expect(linkBox!.width).toBeGreaterThan(44);
  }
});

/**
 * Capping the bar is only acceptable if nothing became unreachable by doing so.
 * The pages that left the bar must still be one tap away on a phone.
 */
test('every destination remains reachable on a phone', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'mobile viewport only');

  await page.goto('/setup');
  await page.getByLabel('Your name').fill('Reach Check');
  await page.getByLabel('Workspace name').fill('Reach Check');
  await page.getByLabel('Email').fill(`reach-${Date.now()}@example.com`);
  await page.getByLabel('Password').fill('a-sufficiently-long-password');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Scoped to the visible mobile navigation: the desktop sidebar carries the
  // same links but is hidden at this width, and matching it would prove nothing.
  const more = page.getByRole('navigation', { name: 'More' });

  for (const path of ['/brief', '/intelligence', '/system', '/settings']) {
    await expect(
      more.locator(`a[href="${path}"]`),
      `${path} must be reachable from the dashboard on a phone`,
    ).toBeVisible();
  }
});
