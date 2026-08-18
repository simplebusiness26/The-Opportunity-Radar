import type { NextRequest } from 'next/server';
import { signOut } from '../../../../../src/application/auth/session';
import { authDeps } from '../../../../../src/composition/auth';
import { container } from '../../../../../src/composition/container';
import { apiError, apiSuccess } from '../../../../../src/web/http/response';
import { clearSessionCookie } from '../../../../../src/web/http/cookies';
import { readRequestContext } from '../../../../../src/web/http/context';

export const dynamic = 'force-dynamic';

/**
 * Signing out always succeeds from the caller's point of view: an already
 * invalid session still results in a cleared cookie rather than an error the
 * user cannot act on.
 */
export async function POST(request: NextRequest) {
  const c = container();
  try {
    const { session } = await readRequestContext();
    if (session) await signOut(authDeps(c), session.sessionId);

    const response = apiSuccess({ signedOut: true });
    clearSessionCookie(response, c.env.RADAR_PUBLIC_URL);
    return response;
  } catch (error) {
    return apiError(error, request.headers.get('x-request-id') ?? undefined);
  }
}
