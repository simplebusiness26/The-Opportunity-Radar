import { attachEvidence } from '../../../../../../src/application/opportunities/lifecycle';
import { container } from '../../../../../../src/composition/container';
import { apiSuccess } from '../../../../../../src/web/http/response';
import { writeRoute } from '../../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

export const POST = writeRoute('opportunities.write', async ({ request, ctx, body }) => {
  const c = container();
  const segments = request.nextUrl.pathname.split('/').filter(Boolean);
  const id = segments[segments.length - 2]!;

  await attachEvidence({ repos: c.repos, tx: c.tx, clock: c.clock }, ctx, id, body as never);
  return apiSuccess({ attached: true });
});
