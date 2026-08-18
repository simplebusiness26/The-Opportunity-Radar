import type { NextRequest } from 'next/server';
import { permissionsFor } from '../../../../../src/domain/types/permissions';
import { apiError, apiSuccess } from '../../../../../src/web/http/response';
import { readRequestContext } from '../../../../../src/web/http/context';
import { container } from '../../../../../src/composition/container';
import { readModeStatus } from '../../../../../src/application/system/mode';

export const dynamic = 'force-dynamic';

/**
 * What the client needs to render the shell: who is signed in, where they are,
 * what they may do, and which operating mode the installation is actually in.
 */
export async function GET(request: NextRequest) {
  try {
    const c = container();
    const { session, ctx } = await readRequestContext();

    if (!session) {
      return apiSuccess({
        authenticated: false,
        setupRequired: (await c.repos.users.count()) === 0,
      });
    }

    return apiSuccess({
      authenticated: true,
      userId: session.userId,
      csrfToken: session.csrfSecret,
      workspaces: session.memberships.map((m) => ({
        id: m.workspaceId,
        name: m.workspaceName,
        slug: m.workspaceSlug,
        role: m.role,
      })),
      activeWorkspaceId: ctx?.workspaceId ?? null,
      role: ctx?.role ?? null,
      permissions: ctx ? [...permissionsFor(ctx.role)] : [],
      mode: await readModeStatus(c.repos),
    });
  } catch (error) {
    return apiError(error, request.headers.get('x-request-id') ?? undefined);
  }
}
