import {
  createTrigger,
  listTriggers,
  proposeTriggers,
} from '../../../../../../src/application/memory/triggers';
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
  const deps = { repos: c.repos, tx: c.tx, clock: c.clock };
  const id = opportunityId(request.nextUrl.pathname);

  const [triggers, proposals] = await Promise.all([
    listTriggers(deps, ctx, id),
    proposeTriggers(deps, ctx, id),
  ]);

  // Proposals are offered, never armed. A trigger nobody armed never fires.
  return apiSuccess({ triggers, proposals });
});

export const POST = writeRoute('opportunities.write', async ({ request, ctx, body }) => {
  const c = container();
  const trigger = await createTrigger(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    opportunityId(request.nextUrl.pathname),
    body as never,
  );
  return apiSuccess({ trigger });
});
