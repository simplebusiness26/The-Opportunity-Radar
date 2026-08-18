import { createOpportunity } from '../../../../src/application/opportunities/lifecycle';
import { container } from '../../../../src/composition/container';
import { apiCreated, apiSuccess } from '../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

export const GET = readRoute('opportunities.read', async ({ request, ctx }) => {
  const c = container();
  const params = request.nextUrl.searchParams;

  const rows = await c.repos.opportunities.list(ctx.workspaceId, {
    states: params.getAll('state') as never,
    includeDemo: params.get('demo') === 'true',
  });
  const scores = await c.repos.scores.currentForMany(
    ctx.workspaceId,
    rows.map((row) => row.id),
  );

  return apiSuccess({
    opportunities: rows.map((row) => ({
      ...row,
      score: scores.get(row.id) ?? null,
    })),
  });
});

export const POST = writeRoute('opportunities.write', async ({ ctx, body }) => {
  const c = container();
  const opportunity = await createOpportunity(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    body as never,
  );
  return apiCreated({ opportunity });
});
