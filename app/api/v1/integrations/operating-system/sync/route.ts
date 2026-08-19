import type { NextRequest } from 'next/server';
import { container } from '../../../../../../src/composition/container';
import { errors } from '../../../../../../src/domain/types/errors';
import { safeEqual } from '../../../../../../src/adapters/crypto/tokens';
import { syncOperatingSystemSnapshot } from '../../../../../../src/application/integrations/os-sync';
import { apiError, apiSuccess } from '../../../../../../src/web/http/response';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_BODY_BYTES = 1_500_000;

/**
 * Machine-to-machine ingress for the owner's personal Operating System.
 *
 * This route intentionally does not accept a browser session. The OS has its
 * own credential, scoped only to importing internal intelligence. With no token
 * configured the endpoint does not exist operationally.
 */
export async function POST(request: NextRequest) {
  try {
    const c = container();
    if (!c.env.RADAR_OS_SYNC_TOKEN) {
      throw errors.notConfigured(
        'os_sync.not_configured',
        'Operating System sync is disabled.',
        'Set RADAR_OS_SYNC_TOKEN in the Radar deployment to enable the bridge.',
      );
    }

    const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!supplied || !safeEqual(supplied, c.env.RADAR_OS_SYNC_TOKEN)) {
      throw errors.unauthenticated('Invalid Operating System sync token.');
    }

    const declaredLength = Number(request.headers.get('content-length') ?? 0);
    if (declaredLength > MAX_BODY_BYTES) {
      throw errors.validation('os_sync.payload_too_large', 'Operating System snapshot is too large.');
    }

    const workspace = c.env.RADAR_OS_WORKSPACE_ID
      ? await c.repos.tenancy.findWorkspace(c.env.RADAR_OS_WORKSPACE_ID)
      : await c.repos.tenancy.findOnlyWorkspace();

    if (!workspace) {
      throw errors.preconditionFailed(
        'os_sync.workspace_ambiguous',
        'Radar could not determine which workspace should receive Operating System data.',
        'If this install has more than one workspace, set RADAR_OS_WORKSPACE_ID to the intended workspace UUID.',
      );
    }

    const rawText = await request.text();
    if (rawText.length > MAX_BODY_BYTES) {
      throw errors.validation('os_sync.payload_too_large', 'Operating System snapshot is too large.');
    }

    let body: unknown;
    try {
      body = JSON.parse(rawText);
    } catch {
      throw errors.validation('os_sync.invalid_json', 'Operating System snapshot must be valid JSON.');
    }

    const result = await syncOperatingSystemSnapshot(
      { repos: c.repos, tx: c.tx, clock: c.clock },
      workspace,
      body,
    );

    return apiSuccess(result);
  } catch (error) {
    return apiError(error, request.headers.get('x-request-id') ?? undefined);
  }
}
