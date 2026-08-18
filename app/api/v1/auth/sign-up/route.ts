import type { NextRequest } from 'next/server';
import { signUp, signUpInput } from '../../../../../src/application/auth/sign-up';
import { authDeps } from '../../../../../src/composition/auth';
import { container } from '../../../../../src/composition/container';
import { apiCreated, apiError } from '../../../../../src/web/http/response';
import { setSessionCookie } from '../../../../../src/web/http/cookies';
import { requestMeta } from '../../../../../src/web/http/request';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const c = container();
  try {
    const body = signUpInput.parse(await request.json());
    const result = await signUp(authDeps(c), body, requestMeta(request));

    const response = apiCreated({
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
