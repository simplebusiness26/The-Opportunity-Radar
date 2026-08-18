import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { TokenService } from '../../ports/crypto';

/** Opaque 256-bit token, URL-safe. Used for sessions and the tick bearer token. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Sessions are looked up by digest; the raw token exists only in the cookie. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

/** Length-safe constant-time comparison for secrets supplied by a caller. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Still compare, so the failure costs the same regardless of why it failed.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Hashes a client address for rate limiting and audit without retaining the
 * address itself. The salt keeps hashes from being reversible across instances.
 */
export function hashIp(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32);
}

export const tokenService: TokenService = {
  generate: generateToken,
  hash: hashToken,
  safeEqual,
  hashIp,
};
