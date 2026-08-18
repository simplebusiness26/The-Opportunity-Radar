import { NextResponse, type NextRequest } from 'next/server';

/**
 * Middleware runs in the Edge runtime, which has no node:crypto. Web Crypto is
 * available there and gives the same randomness guarantees.
 */
function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Security headers and a per-request id, applied to every response.
 *
 * Next 16 calls this the proxy layer (formerly middleware). It runs in the Edge
 * runtime on every matched request, before any route handler.
 *
 * The Content-Security-Policy is nonce-based rather than allowing
 * 'unsafe-inline': Radar renders content derived from fetched web pages, so a
 * policy that permits inline script would undermine the rest of the untrusted
 * content handling.
 */
export default function proxy(request: NextRequest): NextResponse {
  const nonce = randomNonce();
  const isDev = process.env.NODE_ENV !== 'production';

  const csp = [
    "default-src 'self'",
    // Next injects its runtime inline; the nonce is what makes that safe.
    // 'strict-dynamic' lets that bootstrap load chunks without widening the policy.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    // Tailwind emits a stylesheet, but Next still inlines critical CSS.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // The browser never talks to third parties; all fetching is server-side
    // through the SSRF-guarded fetcher.
    `connect-src 'self'${isDev ? ' ws: http://127.0.0.1:*' : ''}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('x-request-id', request.headers.get('x-request-id') ?? crypto.randomUUID());

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  );
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (!isDev) {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  response.headers.set('x-request-id', requestHeaders.get('x-request-id') ?? '');

  return response;
}

export const config = {
  matcher: [
    // Everything except static assets, which need no dynamic headers.
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons/).*)',
  ],
};
