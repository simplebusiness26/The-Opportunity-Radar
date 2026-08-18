import { rescoreOpportunity } from '../../../../../../src/application/opportunities/score-opportunity';
import { container } from '../../../../../../src/composition/container';
import { apiSuccess } from '../../../../../../src/web/http/response';
import { writeRoute } from '../../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

export const POST = writeRoute('opportunities.write', async ({ request, ctx }) => {
  const c = container();
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 2]!;

  const { result, changed, deltas } = await rescoreOpportunity(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    id,
    { cause: 'manual' },
  );

  return apiSuccess({
    changed,
    composites: result.composites,
    confidence: result.confidence,
    gaps: result.gaps,
    deltas,
  });
});
