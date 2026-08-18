import { moveExperiment, readExperiment } from '../../../../../src/application/experiments/experiments';
import { container } from '../../../../../src/composition/container';
import { apiSuccess } from '../../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

function experimentId(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  return segments[segments.length - 1]!;
}

export const GET = readRoute('opportunities.read', async ({ request, ctx }) => {
  const c = container();
  const detail = await readExperiment(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    experimentId(request.nextUrl.pathname),
  );
  return apiSuccess(detail);
});

export const POST = writeRoute('experiments.write', async ({ request, ctx, body }) => {
  const c = container();
  const experiment = await moveExperiment(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    experimentId(request.nextUrl.pathname),
    body as never,
  );
  return apiSuccess({ experiment });
});
