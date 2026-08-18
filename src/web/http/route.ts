import type { NextRequest } from 'next/server';
import type { Permission } from '../../domain/types/permissions';
import type { WorkspaceCtx } from '../../domain/types/identity';
import { apiError } from './response';
import { requireAuth, requireWorkspace } from './context';
import type { NextResponse } from 'next/server';

/**
 * Removes the boilerplate every route would otherwise repeat: authorisation,
 * CSRF, and turning any thrown value into the one error envelope. A route body
 * only ever contains what that route is actually about.
 */
export function readRoute<T>(
  permission: Permission,
  handler: (input: { request: NextRequest; ctx: WorkspaceCtx }) => Promise<NextResponse<T>>,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { ctx } = await requireWorkspace(permission);
      return await handler({ request, ctx });
    } catch (error) {
      return apiError(error, request.headers.get('x-request-id') ?? undefined);
    }
  };
}

export function writeRoute<T>(
  permission: Permission,
  handler: (input: { request: NextRequest; ctx: WorkspaceCtx; body: unknown }) => Promise<NextResponse<T>>,
) {
  return async (request: NextRequest): Promise<NextResponse> => {
    try {
      const { ctx } = await requireAuth({ permission, method: request.method });
      const body = await readJson(request);
      return await handler({ request, ctx, body });
    } catch (error) {
      return apiError(error, request.headers.get('x-request-id') ?? undefined);
    }
  };
}

async function readJson(request: NextRequest): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return {};
  try {
    return await request.json();
  } catch {
    return {};
  }
}
