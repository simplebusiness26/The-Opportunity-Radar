import { writeValidationPlan } from '../../../../../../src/application/experiments/experiments';
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
  const plan = await c.repos.validation.latestPlan(
    ctx.workspaceId,
    opportunityId(request.nextUrl.pathname),
  );
  return apiSuccess({ plan });
});

/**
 * Lets a person design the experiment themselves.
 *
 * Manual mode has to be able to test something, not merely score it, or the
 * whole validation half of the product would depend on a credential.
 */
export const POST = writeRoute('experiments.write', async ({ request, ctx, body }) => {
  const c = container();
  const result = await writeValidationPlan(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    opportunityId(request.nextUrl.pathname),
    body as never,
  );
  return apiSuccess(result);
});
