import type { NextResponse } from 'next/server';
import { sessionCookieName } from './context';

/**
 * Session cookies are httpOnly (JavaScript cannot read them, so XSS cannot
 * exfiltrate a session), SameSite=Lax (blocks cross-site POSTs while keeping
 * ordinary inbound links working), and Secure whenever the deployment is https.
 */
export function setSessionCookie(
  response: NextResponse,
  publicUrl: string,
  token: string,
  expiresAt: Date,
): void {
  const secure = publicUrl.startsWith('https://');
  response.cookies.set({
    name: sessionCookieName(publicUrl),
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse, publicUrl: string): void {
  response.cookies.set({
    name: sessionCookieName(publicUrl),
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: publicUrl.startsWith('https://'),
    path: '/',
    maxAge: 0,
  });
}
