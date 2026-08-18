import { handOff } from '../../../../../../src/application/execution/handoff';
import { container } from '../../../../../../src/composition/container';
import { apiSuccess } from '../../../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

function opportunityId(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  return segments[segments.length - 2]!;
}

export const GET = readRoute('opportunities.read', async ({ request, ctx }) => {
  const c = container();
  const handoffs = await c.repos.handoffs.list(ctx.workspaceId, {
    opportunityId: opportunityId(request.nextUrl.pathname),
  });
  return apiSuccess({ handoffs });
});

export const POST = writeRoute('opportunities.decide', async ({ request, ctx, body }) => {
  const c = container();
  const result = await handOff(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    opportunityId(request.nextUrl.pathname),
    body as never,
  );
  return apiSuccess(result);
});
