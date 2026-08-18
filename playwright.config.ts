import { defineConfig, devices } from '@playwright/test';

/**
 * The container ships a pinned Chromium build. We point Playwright straight at
 * it so the runner never attempts a download, and so browser revision drift
 * cannot break the acceptance suite.
 */
const CHROMIUM = process.env.RADAR_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PORT = Number(process.env.RADAR_E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
locale: 'en-GB',
    timezoneId: 'UTC',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], launchOptions: { executablePath: CHROMIUM } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], launchOptions: { executablePath: CHROMIUM } },
    },
  ],
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      // Starts at a known instant and then moves at real speed. A frozen clock
      // would make "this arrived after that" inexpressible, and several
      // behaviours worth testing are exactly that.
      RADAR_CLOCK: 'from:2026-08-18T00:00:00Z',
      RADAR_E2E: '1',
      // Origin verification compares against this exact value, so it has to be
      // the address the tests actually browse.
      RADAR_PUBLIC_URL: BASE_URL,
      // The acceptance suite creates several isolated owners, so the
      // single-owner lock is exercised by its own test rather than globally.
      RADAR_SINGLE_OWNER: 'false',
      // The suite creates several accounts in quick succession from one
      // address, which the production limits would rightly refuse.
      RADAR_RATE_LIMIT_SCALE: '200',
      // The acceptance tests drive the machine the way a scheduler does,
      // rather than sleeping and hoping. Fixed here so the specs and the
      // server agree on the token without one being configured by hand.
      RADAR_TICK_TOKEN: 'e2e-tick-token-not-a-secret',
      RADAR_FEEDBACK_TOKEN: 'e2e-feedback-token-not-a-secret',
    },
  },
});
