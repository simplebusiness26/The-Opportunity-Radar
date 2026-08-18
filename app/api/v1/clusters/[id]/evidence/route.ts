import {
  addEvidenceToCluster,
  removeEvidenceFromCluster,
} from '../../../../../../src/application/clusters/cluster-evidence';
import { container } from '../../../../../../src/composition/container';
import { apiSuccess } from '../../../../../../src/web/http/response';
import { writeRoute } from '../../../../../../src/web/http/route';
import { errors } from '../../../../../../src/domain/types/errors';

export const dynamic = 'force-dynamic';

function clusterIdFrom(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const id = parts.at(-2);
  if (!id) throw errors.notFound('cluster');
  return id;
}

function deps() {
  const c = container();
  return { repos: c.repos, tx: c.tx, clock: c.clock };
}

export const POST = writeRoute('clusters.write', async ({ request, ctx, body }) => {
  const input = (body ?? {}) as { evidenceUnitIds?: string[] };
  if (!input.evidenceUnitIds?.length) {
    throw errors.validation('cluster.no_evidence', 'Choose at least one piece of evidence.');
  }

  const cluster = await addEvidenceToCluster(
    deps(),
    ctx,
    clusterIdFrom(request.nextUrl.pathname),
    input.evidenceUnitIds,
  );
  return apiSuccess({ cluster });
});

export const DELETE = writeRoute('clusters.write', async ({ request, ctx, body }) => {
  const input = (body ?? {}) as { evidenceUnitId?: string };
  if (!input.evidenceUnitId) {
    throw errors.validation('cluster.no_evidence', 'Choose the evidence to remove.');
  }

  const cluster = await removeEvidenceFromCluster(
    deps(),
    ctx,
    clusterIdFrom(request.nextUrl.pathname),
    input.evidenceUnitId,
  );
  return apiSuccess({ cluster });
});
