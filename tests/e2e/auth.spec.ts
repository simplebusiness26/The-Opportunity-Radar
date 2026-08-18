import { expect, test } from '@playwright/test';

/**
 * Exercises the real HTTP stack: middleware headers, cookies, CSRF and the
 * session lifecycle. The database is shared with the dev server, so each run
 * uses a distinct account rather than depending on a reset.
 */
const unique = () => `owner-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

test('first run sends an unauthenticated visitor to setup', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/(setup|sign-in)$/);
});

test('security headers are present on every response', async ({ page }) => {
  const response = await page.goto('/sign-in');
  const headers = response?.headers() ?? {};

  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['content-security-policy']).toContain("object-src 'none'");
  // A nonce-based policy is the point; inline script must not be blanket-allowed.
  expect(headers['content-security-policy']).not.toContain("script-src 'self' 'unsafe-inline'");
});

test('an owner can create a workspace, stay signed in, and sign out', async ({ page, context }) => {
  const email = unique();

  await page.goto('/setup');
  await page.getByLabel('Your name').fill('Test Owner');
  await page.getByLabel('Workspace name').fill('Acceptance Workspace');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-sufficiently-long-password');
  await page.getByRole('button', { name: 'Create workspace' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Radar', level: 1 })).toBeVisible();

  // The session cookie must be inaccessible to script.
  const cookie = (await context.cookies()).find((c) => c.name.includes('radar_session'));
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie)).not.toContain('radar_session');

  // The session survives a reload.
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);

  const signOut = await page.request.post('/api/v1/auth/sign-out');
  expect(signOut.ok()).toBe(true);

  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/(sign-in|setup)$/);
});

test('a state-changing request without a CSRF token is refused', async ({ page }) => {
  const email = unique();

  await page.goto('/setup');
  await page.getByLabel('Your name').fill('CSRF Owner');
  await page.getByLabel('Workspace name').fill('CSRF Workspace');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('a-sufficiently-long-password');
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Authenticated by cookie, but carrying no CSRF token.
  const response = await page.request.post('/api/v1/auth/workspace', {
    data: { workspaceId: '00000000-0000-4000-8000-000000000000' },
    headers: { origin: new URL(page.url()).origin },
  });

  expect(response.status()).toBe(403);
  const body = (await response.json()) as { error: { code: string } };
  expect(body.error.code).toBe('csrf.token_rejected');
});

test('a cross-origin state-changing request is refused outright', async ({ page }) => {
  await page.goto('/sign-in');

  const response = await page.request.post('/api/v1/auth/workspace', {
    data: { workspaceId: '00000000-0000-4000-8000-000000000000' },
    headers: { origin: 'https://evil.example.com' },
  });

  expect(response.status()).toBe(403);
  const body = (await response.json()) as { error: { code: string } };
  expect(body.error.code).toBe('csrf.origin_rejected');
});

test('sign-in reveals nothing about which accounts exist', async ({ page }) => {
  await page.goto('/sign-in');

  const unknown = await page.request.post('/api/v1/auth/sign-in', {
    data: { email: 'definitely-not-registered@example.com', password: 'some-long-password' },
    headers: { origin: new URL(page.url()).origin },
  });

  const body = (await unknown.json()) as { error: { message: string } };
  expect(unknown.status()).toBe(401);
  expect(body.error.message).toBe('That email address and password do not match.');
});
