import {
  allocateResources,
  compareScenarios,
} from '../../../../src/application/intelligence/allocate-resources';
import { container } from '../../../../src/composition/container';
import { apiSuccess } from '../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

const deps = () => {
  const c = container();
  return { repos: c.repos, tx: c.tx, clock: c.clock };
};

export const GET = readRoute('opportunities.read', async ({ request, ctx }) => {
  const horizonDays = Number(request.nextUrl.searchParams.get('days') ?? 7);
  return apiSuccess(await allocateResources(deps(), ctx, { horizonDays }));
});

/**
 * Scenario comparison. The useful output is where the recommendation changes
 * between constraints, not any single answer.
 */
export const POST = writeRoute('opportunities.read', async ({ ctx, body }) => {
  const input = (body ?? {}) as {
    scenarios?: Array<{ label: string; horizonDays?: number; budgetOverride?: number; daysOverride?: number }>;
  };

  const scenarios = input.scenarios?.length
    ? input.scenarios
    : [
        { label: 'This week, current resources', horizonDays: 7 },
        { label: 'A weekend and £50', horizonDays: 2, budgetOverride: 50, daysOverride: 2 },
        { label: 'A month and £500', horizonDays: 30, budgetOverride: 500, daysOverride: 20 },
      ];

  return apiSuccess({ scenarios: await compareScenarios(deps(), ctx, scenarios) });
});
