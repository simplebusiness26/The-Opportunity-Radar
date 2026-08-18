import type { NextRequest } from 'next/server';
import { signIn, signInInput } from '../../../../../src/application/auth/sign-in';
import { authDeps } from '../../../../../src/composition/auth';
import { container } from '../../../../../src/composition/container';
import { apiError, apiSuccess } from '../../../../../src/web/http/response';
import { setSessionCookie } from '../../../../../src/web/http/cookies';
import { requestMeta } from '../../../../../src/web/http/request';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const c = container();
  try {
    const body = signInInput.parse(await request.json());
    const result = await signIn(authDeps(c), body, requestMeta(request));

    const response = apiSuccess({
      userId: result.userId,
      workspaceId: result.workspaceId,
      csrfToken: result.session.csrfToken,
    });
    setSessionCookie(response, c.env.RADAR_PUBLIC_URL, result.session.token, result.session.expiresAt);
    return response;
  } catch (error) {
    return apiError(error, request.headers.get('x-request-id') ?? undefined);
  }
}
