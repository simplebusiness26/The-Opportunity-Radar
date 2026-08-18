import { assignUnclusteredEvidence } from '../../../../../src/application/clusters/cluster-evidence';
import { container } from '../../../../../src/composition/container';
import { apiSuccess } from '../../../../../src/web/http/response';
import { writeRoute } from '../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

/**
 * Places unclustered evidence into the clusters it fits. Evidence that matches
 * nothing is reported as unassigned rather than given a cluster of its own.
 */
export const POST = writeRoute('clusters.write', async ({ ctx, body }) => {
  const c = container();
  const input = (body ?? {}) as { limit?: number };

  const outcomes = await assignUnclusteredEvidence(
    { repos: c.repos, tx: c.tx, clock: c.clock },
    ctx,
    { limit: input.limit },
  );

  return apiSuccess({
    considered: outcomes.length,
    assigned: outcomes.filter((outcome) => outcome.clusterId !== null).length,
    unassigned: outcomes.filter((outcome) => outcome.clusterId === null).length,
    outcomes,
  });
});
