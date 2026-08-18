import type { Untrusted } from '../types/untrusted';

/**
 * Double-submit CSRF plus origin verification.
 *
 * The token is derived from a per-session secret rather than stored, so it needs
 * no extra table and cannot be replayed against a different session.
 */

export interface OriginCheckInput {
  method: string;
  /** The Origin header, if the browser sent one. */
  origin: string | null;
  /** Sec-Fetch-Site, which modern browsers always send. */
  secFetchSite: string | null;
  /** The origin this deployment is served from. */
  expectedOrigin: string;
}

export const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

export type OriginVerdict =
  | { ok: true }
  | { ok: false; reason: 'origin_mismatch' | 'origin_missing' | 'cross_site' };

/**
 * A state-changing request must prove it came from our own origin. We accept
 * either a matching Origin header or an explicit same-origin Sec-Fetch-Site;
 * requiring both would break legitimate non-browser clients that send neither,
 * so those are rejected outright instead.
 */
export function verifyOrigin(input: OriginCheckInput): OriginVerdict {
  if (isSafeMethod(input.method)) return { ok: true };

  if (input.secFetchSite && input.secFetchSite !== 'same-origin' && input.secFetchSite !== 'none') {
    return { ok: false, reason: 'cross_site' };
  }

  if (input.origin) {
    return normaliseOrigin(input.origin) === normaliseOrigin(input.expectedOrigin)
      ? { ok: true }
      : { ok: false, reason: 'origin_mismatch' };
  }

  if (input.secFetchSite === 'same-origin') return { ok: true };

  return { ok: false, reason: 'origin_missing' };
}

function normaliseOrigin(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase().replace(/\/$/, '');
  }
}

export type CsrfVerdict = { ok: true } | { ok: false; reason: 'missing' | 'mismatch' };

/**
 * The submitted token is compared against the session secret. `compare` is
 * injected so the constant-time implementation stays in the crypto adapter and
 * this module remains pure.
 */
export function verifyCsrfToken(
  submitted: Untrusted<string> | string | null,
  sessionCsrfSecret: string,
  compare: (a: string, b: string) => boolean,
): CsrfVerdict {
  if (!submitted) return { ok: false, reason: 'missing' };
  const value = typeof submitted === 'string' ? submitted : String(submitted);
  return compare(value, sessionCsrfSecret) ? { ok: true } : { ok: false, reason: 'mismatch' };
}
