import type { NextRequest } from 'next/server';
import { container } from '../../../../../src/composition/container';
import { errors } from '../../../../../src/domain/types/errors';
import { safeEqual } from '../../../../../src/adapters/crypto/tokens';
import { scoreUnscoredOpportunities } from '../../../../../src/application/opportunities/auto-score';
import { apiError, apiSuccess } from '../../../../../src/web/http/response';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Scores a bounded backlog of opportunities after the framing heartbeat.
 * Uses the same private scheduler token and never advances lifecycle state or
 * commits money. It only writes deterministic score records from stored data.
 */
export async function POST(request: NextRequest) {
  try {
    const c = container();

    if (!c.env.RADAR_TICK_TOKEN) {
      throw errors.notConfigured(
        'scoring.not_configured',
        'Automatic opportunity scoring is disabled.',
        'Set RADAR_TICK_TOKEN to enable scheduler-driven scoring.',
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
        'scoring.workspace_ambiguous',
        'Radar could not determine which workspace should receive automatic scores.',
        'If this install has more than one workspace, set RADAR_OS_WORKSPACE_ID to the intended workspace UUID.',
      );
    }

    const result = await scoreUnscoredOpportunities(
      { repos: c.repos, tx: c.tx, clock: c.clock },
      {
        workspaceId: workspace.id,
        orgId: workspace.orgId,
        actor: 'system',
        requestId: request.headers.get('x-request-id') ?? undefined,
      },
      { limit: 12 },
    );

    return apiSuccess(result);
  } catch (error) {
    return apiError(error, request.headers.get('x-request-id') ?? undefined);
  }
}
