import { readInvestigationLog } from '../../../../../../src/application/opportunities/investigation-log';
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
  const log = await readInvestigationLog(c.repos, ctx, opportunityId(request.nextUrl.pathname));
  return apiSuccess(log);
});

/**
 * Queues an investigation rather than running it inline.
 *
 * A request that spent several minutes and real money before responding would
 * be both a poor interface and a way to bypass the queue's own limits. The
 * work goes through the same path as everything else the machine does.
 */
export const POST = writeRoute('opportunities.write', async ({ request, ctx }) => {
  const c = container();
  const id = opportunityId(request.nextUrl.pathname);

  const opportunity = await c.repos.opportunities.findById(ctx.workspaceId, id);
  if (!opportunity) {
    return apiSuccess({ queued: false, reason: 'That opportunity does not exist.' });
  }

  const job = await c.repos.jobs.enqueue(ctx.workspaceId, {
    kind: 'opportunity.investigate',
    payload: { opportunityId: id },
    // One investigation per opportunity at a time, however often this is asked
    // for. A second request joins the first rather than doubling the spend.
    dedupeKey: `opportunity.investigate:${id}`,
    priority: 4,
  });

  return apiSuccess({
    queued: job !== null,
    jobId: job?.id ?? null,
    reason: job ? null : 'An investigation of this opportunity is already queued.',
  });
});
