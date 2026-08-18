import { createCluster, listClustersWithReadiness } from '../../../../src/application/clusters/cluster-evidence';
import { container } from '../../../../src/composition/container';
import { apiCreated, apiSuccess } from '../../../../src/web/http/response';
import { readRoute, writeRoute } from '../../../../src/web/http/route';
import type { ClusterRow } from '../../../../src/ports/repositories/opportunities';

export const dynamic = 'force-dynamic';

function clusterDeps() {
  const c = container();
  return { repos: c.repos, tx: c.tx, clock: c.clock };
}

export const GET = readRoute('signals.read', async ({ request, ctx }) => {
  const params = request.nextUrl.searchParams;
  const status = params.getAll('status') as ClusterRow['status'][];

  const clusters = await listClustersWithReadiness(clusterDeps(), ctx, {
    limit: Number(params.get('limit') ?? 100),
    status: status.length ? status : undefined,
  });

  return apiSuccess({ clusters });
});

export const POST = writeRoute('clusters.write', async ({ ctx, body }) => {
  const cluster = await createCluster(clusterDeps(), ctx, body as never);
  return apiCreated({ cluster });
});
