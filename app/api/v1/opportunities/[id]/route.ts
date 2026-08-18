import { errors } from '../../../../../src/domain/types/errors';
import { container } from '../../../../../src/composition/container';
import { apiSuccess } from '../../../../../src/web/http/response';
import { readRoute } from '../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

export const GET = readRoute('opportunities.read', async ({ request, ctx }) => {
  const c = container();
  const id = request.nextUrl.pathname.split('/').filter(Boolean).pop()!;

  const opportunity = await c.repos.opportunities.findById(ctx.workspaceId, id);
  if (!opportunity) throw errors.notFound('Opportunity');

  const [score, history, transitions, evidence] = await Promise.all([
    c.repos.scores.current(ctx.workspaceId, id),
    c.repos.scores.history(ctx.workspaceId, id, 20),
    c.repos.opportunities.listTransitions(id),
    c.repos.opportunities.evidenceFor(id),
  ]);

  return apiSuccess({ opportunity, score, history, transitions, evidence });
});
