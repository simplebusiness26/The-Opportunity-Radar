import { expect, type Page } from '@playwright/test';

export const TICK_TOKEN = 'e2e-tick-token-not-a-secret';
export const FEEDBACK_TOKEN = 'e2e-feedback-token-not-a-secret';

/**
 * A thin client for driving Radar through its own API.
 *
 * The acceptance tests are about behaviour that spans the whole system, and
 * clicking through twenty forms to set up each scenario would test the forms
 * rather than the behaviour. The forms have their own tests; these use the same
 * API the interface uses, with the same session and the same CSRF token, and
 * assert the result through the interface where the interface is the point.
 */
export class RadarClient {
  private csrfToken = '';

  private constructor(private readonly page: Page) {}

  static async signUp(page: Page, workspace: string): Promise<RadarClient> {
    await page.goto('/setup');
    await page.getByLabel('Your name').fill('Acceptance Owner');
    await page.getByLabel('Workspace name').fill(workspace);
    await page
      .getByLabel('Email')
      .fill(`owner-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`);
    await page.getByLabel('Password').fill('a-sufficiently-long-password');
    await page.getByRole('button', { name: 'Create workspace' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);

    const client = new RadarClient(page);
    await client.refreshToken();
    return client;
  }

  async refreshToken(): Promise<void> {
    const body = await this.get<{ csrfToken?: string }>('/api/v1/auth/session');
    this.csrfToken = body.csrfToken ?? '';
    expect(this.csrfToken).not.toBe('');
  }

  async post<T = Record<string, unknown>>(path: string, data: unknown = {}): Promise<T> {
    const response = await this.page.request.post(path, {
      data,
      headers: { 'x-radar-csrf': this.csrfToken, origin: new URL(this.page.url()).origin },
    });

    const body = (await response.json()) as { data?: T; error?: { message?: string } };
    if (!response.ok()) {
      throw new Error(`POST ${path} failed (${response.status()}): ${body.error?.message ?? ''}`);
    }
    return body.data as T;
  }

  async put<T = Record<string, unknown>>(path: string, data: unknown = {}): Promise<T> {
    const response = await this.page.request.put(path, {
      data,
      headers: { 'x-radar-csrf': this.csrfToken, origin: new URL(this.page.url()).origin },
    });
    const body = (await response.json()) as { data?: T; error?: { message?: string } };
    if (!response.ok()) {
      throw new Error(`PUT ${path} failed (${response.status()}): ${body.error?.message ?? ''}`);
    }
    return body.data as T;
  }

  async get<T = Record<string, unknown>>(path: string): Promise<T> {
    const response = await this.page.request.get(path);
    const text = await response.text();

    // A route with no GET handler answers with an empty body; failing loudly
    // here beats a JSON parse error thirty lines into a test.
    if (!response.ok() || text.length === 0) {
      throw new Error(`GET ${path} returned ${response.status()} with ${text.length} bytes.`);
    }

    return (JSON.parse(text) as { data?: T }).data as T;
  }

  async recordEvidence(input: {
    title: string;
    bodyText: string;
    url?: string;
    signalTypeKey: string;
    evidenceClass: string;
    sourceLabel?: string;
    monthlyAmount?: number;
  }): Promise<string> {
    const { monthlyAmount, ...rest } = input;
    const result = await this.post<{ evidenceUnitId: string }>('/api/v1/signals', {
      ...rest,
      // No observedAt: the server stamps it from its own clock, so ordering
      // between things recorded at different points in a test is real.
      ...(monthlyAmount ? { monetaryEvidence: { monthlyAmount, currency: 'GBP' } } : {}),
    });
    return result.evidenceUnitId;
  }

  async createOpportunity(input: Record<string, unknown>): Promise<string> {
    const result = await this.post<{ opportunity?: { id: string }; id?: string }>(
      '/api/v1/opportunities',
      input,
    );
    const id = result.opportunity?.id ?? result.id;
    expect(id, 'the opportunity was created').toBeTruthy();
    return id!;
  }

  async attach(
    opportunityId: string,
    evidenceUnitId: string,
    stance: 'for' | 'against' = 'for',
  ): Promise<void> {
    await this.post(`/api/v1/opportunities/${opportunityId}/evidence`, { evidenceUnitId, stance });
  }

  /**
   * Runs one piece of scheduled work now rather than waiting out its debounce.
   *
   * The same control the Machine view offers. Tests use it because a debounce
   * measured in seconds is correct in production and pointless to sit through.
   */
  async runNow(kind: string): Promise<void> {
    await this.post('/api/v1/system/run', { kind });
  }

  /**
   * Drains the queue by driving the same tick a scheduler drives.
   *
   * There is no sleeping anywhere in these tests: the loop runs until nothing
   * is claimed, and fails rather than spinning if that never happens.
   */
  async drain(maxPasses = 12): Promise<void> {
    for (let pass = 0; pass < maxPasses; pass += 1) {
      const response = await this.page.request.post('/api/v1/system/tick', {
        headers: { authorization: `Bearer ${TICK_TOKEN}` },
        data: { maxJobs: 50, budgetMs: 10_000 },
      });

      expect(response.ok(), 'the tick endpoint is enabled for the test run').toBe(true);
      const body = (await response.json()) as { data?: { jobs?: { claimed?: number } } };
      if ((body.data?.jobs?.claimed ?? 0) === 0) return;
    }

    throw new Error(`The queue did not drain within ${maxPasses} passes.`);
  }
}
