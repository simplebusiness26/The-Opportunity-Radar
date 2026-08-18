import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { switchWorkspace } from '../../../../../src/application/auth/session';
import { authDeps } from '../../../../../src/composition/auth';
import { container } from '../../../../../src/composition/container';
import { apiError, apiSuccess } from '../../../../../src/web/http/response';
import { requireAuth } from '../../../../../src/web/http/context';

export const dynamic = 'force-dynamic';

const input = z.object({ workspaceId: z.string().uuid() });

export async function POST(request: NextRequest) {
  try {
    const { session } = await requireAuth({ method: 'POST' });
    const { workspaceId } = input.parse(await request.json());
    const ctx = await switchWorkspace(authDeps(container()), session, workspaceId);
    return apiSuccess({ workspaceId: ctx.workspaceId, role: ctx.role });
  } catch (error) {
    return apiError(error, request.headers.get('x-request-id') ?? undefined);
  }
}
