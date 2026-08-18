import type { NextRequest } from 'next/server';
import type { RequestMeta } from '../../application/auth/types';
import { container } from '../../composition/container';

/**
 * The client address, taken from the proxy header only when Radar is actually
 * behind a trusted proxy. Believing `x-forwarded-for` unconditionally would let
 * any caller forge an address and walk around rate limiting.
 */
export function clientIp(request: NextRequest): string | undefined {
  const trustProxy = container().env.RADAR_TRUST_PROXY;
  if (trustProxy) {
    const forwarded = request.headers.get('x-forwarded-for');
    const first = forwarded?.split(',')[0]?.trim();
    if (first) return first;
    const realIp = request.headers.get('x-real-ip')?.trim();
    if (realIp) return realIp;
  }
  return undefined;
}

export function requestMeta(request: NextRequest): RequestMeta {
  return {
    ip: clientIp(request),
    userAgent: request.headers.get('user-agent') ?? undefined,
    requestId: request.headers.get('x-request-id') ?? undefined,
  };
}
