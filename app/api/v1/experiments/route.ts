import { createExperiment } from '../../../../src/application/experiments/experiments';
import { container } from '../../../../src/composition/container';
import { apiSuccess } from '../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

export const GET = readRoute('opportunities.read', async ({ request, ctx }) => {
  const c = container();
  const opportunityId = request.nextUrl.searchParams.get('opportunityId');

  const experiments = await c.repos.validation.listExperiments(ctx.workspaceId, {
    opportunityId: opportunityId ?? undefined,
    limit: 100,
  });

  return apiSuccess({ experiments });
});

export const POST = writeRoute('experiments.write', async ({ ctx, body }) => {
  const c = container();
  const experiment = await createExperiment(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    body as never,
  );
  return apiSuccess({ experiment });
});
