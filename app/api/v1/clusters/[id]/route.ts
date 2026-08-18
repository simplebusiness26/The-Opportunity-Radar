import { recomputeCluster } from '../../../../../src/application/clusters/cluster-evidence';
import { container } from '../../../../../src/composition/container';
import { apiSuccess } from '../../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../../src/web/http/route';
import { errors } from '../../../../../src/domain/types/errors';

export const dynamic = 'force-dynamic';

function idFrom(pathname: string): string {
  const id = pathname.split('/').filter(Boolean).at(-1);
  if (!id) throw errors.notFound('cluster');
  return id;
}

export const GET = readRoute('signals.read', async ({ request, ctx }) => {
  const c = container();
  const clusterId = idFrom(request.nextUrl.pathname);

  const cluster = await c.repos.clusters.findById(ctx.workspaceId, clusterId);
  if (!cluster) throw errors.notFound('cluster');

  const evidenceUnitIds = await c.repos.clusters.memberEvidenceIds(clusterId);
  const evidence = evidenceUnitIds.length
    ? await c.repos.evidence.listByIds(ctx.workspaceId, evidenceUnitIds)
    : [];

  return apiSuccess({ cluster, evidence });
});

/** Recomputes the cluster's metrics from its current membership. */
export const POST = writeRoute('clusters.write', async ({ request, ctx }) => {
  const c = container();
  const cluster = await recomputeCluster(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    idFrom(request.nextUrl.pathname.replace(/\/recompute$/, '')),
  );
  return apiSuccess({ cluster });
});
