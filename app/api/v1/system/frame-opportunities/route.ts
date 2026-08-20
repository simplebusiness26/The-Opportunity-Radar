import type { NextRequest } from 'next/server';
import { container } from '../../../../../src/composition/container';
import { errors } from '../../../../../src/domain/types/errors';
import { safeEqual } from '../../../../../src/adapters/crypto/tokens';
import { seedProblemClusters } from '../../../../../src/application/clusters/seed-problem-clusters';
import { frameOpportunitiesFromReadyClusters } from '../../../../../src/application/opportunities/frame-from-clusters';
import { apiError, apiSuccess } from '../../../../../src/web/http/response';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Runs the evidence -> problem -> opportunity bridge for serverless installs.
 *
 * It uses the existing scheduler token, has no browser/session access, and may
 * only frame provisional opportunities. The normal owner-only lifecycle gates
 * still prevent a system actor from committing money or entering execution.
 */
export async function POST(request: NextRequest) {
  try {
    const c = container();

    if (!c.env.RADAR_TICK_TOKEN) {
      throw errors.notConfigured(
        'framing.not_configured',
        'Automatic opportunity framing is disabled.',
        'Set RADAR_TICK_TOKEN to enable scheduler-driven framing.',
      );
    }

    const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!supplied || !safeEqual(supplied, c.env.RADAR_TICK_TOKEN)) {
      throw errors.unauthenticated('Invalid tick token.');
    }

    const workspace = c.env.RADAR_OS_WORKSPACE_ID
      ? await c.repos.tenancy.findWorkspace(c.env.RADAR_OS_WORKSPACE_ID)
      : await c.repos.tenancy.findOnlyWorkspace();

    if (!workspace) {
      throw errors.preconditionFailed(
        'framing.workspace_ambiguous',
        'Radar could not determine which workspace should receive automatic opportunities.',
        'If this install has more than one workspace, set RADAR_OS_WORKSPACE_ID to the intended workspace UUID.',
      );
    }

    const ctx = {
      workspaceId: workspace.id,
      orgId: workspace.orgId,
      actor: 'system' as const,
      requestId: request.headers.get('x-request-id') ?? undefined,
    };
    const deps = { repos: c.repos, tx: c.tx, clock: c.clock };

    const seeded = await seedProblemClusters(deps, ctx, {
      limit: 500,
      maxClusters: 8,
    });
    const framed = await frameOpportunitiesFromReadyClusters(deps, ctx, {
      limit: 100,
      maxOpportunities: 5,
    });

    return apiSuccess({ seeded, framed });
  } catch (error) {
    return apiError(error, request.headers.get('x-request-id') ?? undefined);
  }
}
