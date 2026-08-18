import { setBudget } from '../../../../../src/application/system/configure-ai';
import { readBudgetStatus } from '../../../../../src/pipeline/ai-gateway';
import { forecastSpend, periodKeys } from '../../../../../src/domain/budget/index';
import { container } from '../../../../../src/composition/container';
import { apiSuccess } from '../../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

export const GET = readRoute('workspace.read', async ({ ctx }) => {
  const c = container();
  const now = c.clock.now();
  const keys = periodKeys(now);

  const [budgets, ledger, status, spend] = await Promise.all([
    c.repos.budgets.listBudgets(ctx.workspaceId),
    c.repos.budgets.ledger(ctx.workspaceId, [keys.daily, keys.monthly]),
    readBudgetStatus({ repos: c.repos }, ctx.workspaceId, now),
    c.repos.ai.spendSummary(ctx.workspaceId, new Date(now.getTime() - 30 * 86_400_000)),
  ]);

  const monthly = ledger.find((row) => row.periodKey === keys.monthly);
  const daysInPeriod = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getUTCDate();

  return apiSuccess({
    budgets,
    ledger,
    status,
    spendByRole: spend,
    forecast: forecastSpend({
      spentUsd: monthly?.spentUsd ?? 0,
      daysElapsed: now.getUTCDate(),
      daysInPeriod,
    }),
  });
});

export const POST = writeRoute('budget.configure', async ({ ctx, body }) => {
  const c = container();
  await setBudget(
    { repos: c.repos, tx: c.tx, clock: c.clock, secretBox: c.secretBox },
    ctx,
    body as never,
  );
  return apiSuccess({ updated: true });
});
