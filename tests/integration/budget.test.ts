import { beforeEach, describe, expect, it } from 'vitest';
import { signUp } from '../../src/application/auth/sign-up';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { controllableClock } from '../../src/adapters/clock/index';
import { periodKeys } from '../../src/domain/budget/index';
import type { Repositories } from '../../src/ports/repositories/index';

const NOW = new Date('2026-08-18T00:00:00Z');

async function setup() {
  const account = await signUp(buildAuthDeps({ now: NOW }), {
    email: `owner-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-sufficiently-long-password',
    displayName: 'Owner',
    workspaceName: 'Radar HQ',
  });

  const { db } = testDb();
  const clock = controllableClock(NOW);
  const repos: Repositories = createRepositories(db);
  return { repos, tx: createTransactor(db), clock, workspaceId: account.workspaceId };
}

const KEYS = periodKeys(NOW);

async function withMonthlyBudget(repos: Repositories, workspaceId: string, limitUsd: number) {
  await repos.budgets.setBudget(workspaceId, { period: 'monthly', limitUsd });
  return [{ key: KEYS.monthly, period: 'monthly' as const, limitUsd }];
}

describe('budget enforcement', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('reserves against the limit and refuses what will not fit', async () => {
    const { repos, workspaceId } = await setup();
    const periods = await withMonthlyBudget(repos, workspaceId, 10);

    const first = await repos.budgets.reserve(workspaceId, {
      periods,
      amountUsd: 8,
      expiresAt: new Date(NOW.getTime() + 600_000),
    });
    expect(first.ok).toBe(true);

    const second = await repos.budgets.reserve(workspaceId, {
      periods,
      amountUsd: 5,
      expiresAt: new Date(NOW.getTime() + 600_000),
    });
    // 8 + 5 exceeds 10, so it is refused rather than allowed through.
    expect(second.ok).toBe(false);
    expect(second.reservationId).toBeNull();
  });

  /**
   * The race this design exists to prevent: two callers reading the same
   * headroom and both proceeding.
   */
  it('holds the limit under concurrent callers', async () => {
    const { repos, workspaceId } = await setup();
    const periods = await withMonthlyBudget(repos, workspaceId, 10);

    const attempts = await Promise.all(
      Array.from({ length: 20 }, () =>
        repos.budgets.reserve(workspaceId, {
          periods,
          amountUsd: 1,
          expiresAt: new Date(NOW.getTime() + 600_000),
        }),
      ),
    );

    const granted = attempts.filter((attempt) => attempt.ok);
    expect(granted).toHaveLength(10);

    const [ledger] = await repos.budgets.ledger(workspaceId, [KEYS.monthly]);
    expect(ledger?.reservedUsd).toBeCloseTo(10, 6);
  });

  it('settles a reservation to what was actually spent', async () => {
    const { repos, workspaceId } = await setup();
    const periods = await withMonthlyBudget(repos, workspaceId, 10);

    const reservation = await repos.budgets.reserve(workspaceId, {
      periods,
      amountUsd: 5,
      expiresAt: new Date(NOW.getTime() + 600_000),
    });

    await repos.budgets.settle(reservation.reservationId!, { actualUsd: 0.42, aiCallId: null });

    const [ledger] = await repos.budgets.ledger(workspaceId, [KEYS.monthly]);
    // The reservation is released and only the real cost remains committed, so
    // reserving the worst case does not permanently consume the budget.
    expect(ledger?.spentUsd).toBeCloseTo(0.42, 6);
    expect(ledger?.reservedUsd).toBeCloseTo(0, 6);
  });

  it('releases a reservation whose call never happened', async () => {
    const { repos, workspaceId } = await setup();
    const periods = await withMonthlyBudget(repos, workspaceId, 10);

    const reservation = await repos.budgets.reserve(workspaceId, {
      periods,
      amountUsd: 6,
      expiresAt: new Date(NOW.getTime() + 600_000),
    });
    await repos.budgets.release(reservation.reservationId!);

    const [ledger] = await repos.budgets.ledger(workspaceId, [KEYS.monthly]);
    expect(ledger?.reservedUsd).toBeCloseTo(0, 6);

    // And the freed headroom is usable again.
    const next = await repos.budgets.reserve(workspaceId, {
      periods,
      amountUsd: 9,
      expiresAt: new Date(NOW.getTime() + 600_000),
    });
    expect(next.ok).toBe(true);
  });

  it('keeps a crashed caller money committed until it is swept', async () => {
    const { repos, clock, workspaceId } = await setup();
    const periods = await withMonthlyBudget(repos, workspaceId, 10);

    await repos.budgets.reserve(workspaceId, {
      periods,
      amountUsd: 9,
      expiresAt: new Date(NOW.getTime() + 60_000),
    });

    // Before expiry it still counts as spent. Failing closed is the only safe
    // direction: the alternative is a crash quietly refunding real spend.
    let [ledger] = await repos.budgets.ledger(workspaceId, [KEYS.monthly]);
    expect(ledger?.reservedUsd).toBeCloseTo(9, 6);

    clock.advance(120_000);
    expect(await repos.budgets.sweepExpired(clock.now())).toBe(1);

    [ledger] = await repos.budgets.ledger(workspaceId, [KEYS.monthly]);
    expect(ledger?.reservedUsd).toBeCloseTo(0, 6);
  });

  it('reserves nothing at all when one period cannot fit it', async () => {
    const { repos, workspaceId } = await setup();

    await repos.budgets.setBudget(workspaceId, { period: 'monthly', limitUsd: 100 });
    await repos.budgets.setBudget(workspaceId, { period: 'daily', limitUsd: 2 });

    const periods = [
      { key: KEYS.monthly, period: 'monthly' as const, limitUsd: 100 },
      { key: KEYS.daily, period: 'daily' as const, limitUsd: 2 },
    ];

    const attempt = await repos.budgets.reserve(workspaceId, {
      periods,
      amountUsd: 5,
      expiresAt: new Date(NOW.getTime() + 600_000),
    });
    expect(attempt.ok).toBe(false);

    // A partial reservation would leave the monthly budget quietly committed
    // against work that was refused.
    const ledger = await repos.budgets.ledger(workspaceId, [KEYS.monthly, KEYS.daily]);
    for (const row of ledger) expect(row.reservedUsd).toBeCloseTo(0, 6);
  });

  it('enforces the daily limit independently of the monthly one', async () => {
    const { repos, workspaceId } = await setup();
    await repos.budgets.setBudget(workspaceId, { period: 'monthly', limitUsd: 100 });
    await repos.budgets.setBudget(workspaceId, { period: 'daily', limitUsd: 3 });

    const periods = [
      { key: KEYS.monthly, period: 'monthly' as const, limitUsd: 100 },
      { key: KEYS.daily, period: 'daily' as const, limitUsd: 3 },
    ];

    expect((await repos.budgets.reserve(workspaceId, { periods, amountUsd: 2, expiresAt: new Date(NOW.getTime() + 600_000) })).ok).toBe(true);
    expect((await repos.budgets.reserve(workspaceId, { periods, amountUsd: 2, expiresAt: new Date(NOW.getTime() + 600_000) })).ok).toBe(false);
  });
});

describe('the AI ledger', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('attributes spend to the thing it was spent on', async () => {
    const { repos, workspaceId, clock } = await setup();

    const provider = await repos.ai.upsertProvider(workspaceId, {
      kind: 'fixture',
      label: 'Test provider',
      enabled: true,
    });
    const model = await repos.ai.upsertModel(workspaceId, provider.id, {
      modelKey: 'test-1',
      label: 'Test model',
      inputCostPerMtok: 3,
      outputCostPerMtok: 15,
    });

    const opportunityId = '00000000-0000-4000-8000-000000000abc';

    for (const cost of [0.01, 0.02]) {
      await repos.ai.recordCall(
        workspaceId,
        {
          role: 'research',
          providerId: provider.id,
          modelId: model.id,
          modelKey: model.modelKey,
          requestHash: `hash-${cost}`,
          inputTokens: 1000,
          outputTokens: 200,
          cachedInputTokens: 0,
          costUsd: cost,
          costEstimated: true,
          latencyMs: 120,
          status: 'ok',
          attempt: 1,
          subjectType: 'opportunity',
          subjectId: opportunityId,
        },
        clock.now(),
      );
    }

    const bySubject = await repos.ai.spendBySubject(
      workspaceId,
      'opportunity',
      new Date(NOW.getTime() - 86_400_000),
    );
    expect(bySubject[0]?.calls).toBe(2);
    expect(bySubject[0]?.costUsd).toBeCloseTo(0.03, 6);

    const byRole = await repos.ai.spendSummary(workspaceId, new Date(NOW.getTime() - 86_400_000));
    expect(byRole.find((entry) => entry.role === 'research')?.calls).toBe(2);
  });

  it('records what the budget refused, so nothing simply vanishes', async () => {
    const { repos, workspaceId, clock } = await setup();

    await repos.ai.recordCall(
      workspaceId,
      {
        role: 'research',
        providerId: null,
        modelId: null,
        modelKey: 'none',
        requestHash: 'blocked',
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        costUsd: 0,
        costEstimated: true,
        latencyMs: null,
        status: 'blocked_by_budget',
        attempt: 1,
      },
      clock.now(),
    );

    const recent = await repos.ai.recentCalls(workspaceId, 10);
    expect(recent[0]?.status).toBe('blocked_by_budget');
  });
});
