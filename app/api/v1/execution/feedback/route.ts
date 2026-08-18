import type { NextRequest } from 'next/server';
import { recordHandoffFeedback } from '../../../../../src/application/execution/feedback';
import { container } from '../../../../../src/composition/container';
import { apiError, apiSuccess } from '../../../../../src/web/http/response';
import { errors } from '../../../../../src/domain/types/errors';
import { safeEqual } from '../../../../../src/adapters/crypto/tokens';
import type { SystemCtx } from '../../../../../src/domain/types/identity';

export const dynamic = 'force-dynamic';

/**
 * How whoever built a handed-off opportunity reports what actually happened.
 *
 * Authenticated by a bearer token rather than a session, because the caller is
 * another system. With no token configured the endpoint is disabled outright
 * rather than left open.
 *
 * The workspace is derived from the handoff, not supplied by the caller: a
 * token holder can close the loop on work that was actually sent to them and
 * on nothing else.
 */
export async function POST(request: NextRequest) {
  try {
    const c = container();

    if (!c.env.RADAR_FEEDBACK_TOKEN) {
      throw errors.notConfigured(
        'feedback.not_configured',
        'The execution feedback endpoint is disabled.',
        'Set RADAR_FEEDBACK_TOKEN to enable it, or record outcomes in the interface.',
      );
    }

    const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
    if (!supplied || !safeEqual(supplied, c.env.RADAR_FEEDBACK_TOKEN)) {
      throw errors.unauthenticated('Invalid feedback token.');
    }

    const body = (await request.json().catch(() => ({}))) as {
      handoffId?: string;
      externalRef?: string;
    };

    const handoffId = typeof body.handoffId === 'string' ? body.handoffId : null;
    const externalRef = typeof body.externalRef === 'string' ? body.externalRef : null;
    if (!handoffId && !externalRef) {
      throw errors.preconditionFailed(
        'feedback.no_subject',
        'Feedback must name the handoff it concerns.',
        'Send either handoffId or externalRef.',
      );
    }

    const workspaceId = await resolveWorkspace(c, { handoffId, externalRef });
    if (!workspaceId) throw errors.notFound('Handoff');

    const ctx: SystemCtx = { workspaceId, orgId: '', actor: 'system' };
    const result = await recordHandoffFeedback(
      { repos: c.repos, tx: c.tx, clock: c.clock },
      ctx,
      body as never,
    );

    return apiSuccess(result);
  } catch (error) {
    return apiError(error, request.headers.get('x-request-id') ?? undefined);
  }
}

/**
 * Finds which workspace a handoff belongs to.
 *
 * The lookup is deliberately unscoped -- see the port -- and the workspace is
 * then taken from the row rather than from anything the caller said.
 */
async function resolveWorkspace(
  c: ReturnType<typeof container>,
  input: { handoffId: string | null; externalRef: string | null },
): Promise<string | null> {
  const handoff = await c.repos.handoffs.findAcrossWorkspaces({
    id: input.handoffId ?? undefined,
    externalRef: input.externalRef ?? undefined,
  });

  return handoff?.workspaceId ?? null;
}
