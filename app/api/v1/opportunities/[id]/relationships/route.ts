import {
  linkOpportunities,
  readRelationships,
  suggestRelationships,
  unlinkOpportunities,
} from '../../../../../../src/application/memory/relationships';
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
  const id = opportunityId(request.nextUrl.pathname);

  const [view, suggestions] = await Promise.all([
    readRelationships(c.repos, ctx, id),
    suggestRelationships(c.repos, ctx, id),
  ]);

  return apiSuccess({ ...view, suggestions });
});

export const POST = writeRoute('opportunities.write', async ({ request, ctx, body }) => {
  const c = container();
  await linkOpportunities(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    opportunityId(request.nextUrl.pathname),
    body as never,
  );
  return apiSuccess({ linked: true });
});

export const DELETE = writeRoute('opportunities.write', async ({ ctx, body }) => {
  const c = container();
  const relationshipId = String((body as { relationshipId?: unknown }).relationshipId ?? '');
  await unlinkOpportunities({ repos: c.repos, tx: c.tx, clock: c.clock }, ctx, relationshipId);
  return apiSuccess({ unlinked: true });
});
