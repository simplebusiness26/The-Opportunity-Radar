import { concludeExperiment } from '../../../../../../src/application/experiments/experiments';
import { container } from '../../../../../../src/composition/container';
import { apiSuccess } from '../../../../../../src/web/http/response';
import { writeRoute } from '../../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

/**
 * Ends an experiment against the thresholds agreed before it ran.
 *
 * There is deliberately no way to supply the verdict: it is computed from the
 * recorded results, which is the entire point of fixing the thresholds first.
 */
export const POST = writeRoute('experiments.write', async ({ request, ctx }) => {
  const c = container();
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 2]!;

  const result = await concludeExperiment({ repos: c.repos, tx: c.tx, clock: c.clock }, ctx, id);
  return apiSuccess(result);
});
