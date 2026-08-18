import { describe, expect, it } from 'vitest';
import { isSafeMethod, verifyCsrfToken, verifyOrigin } from '../../src/domain/auth/csrf';

const expectedOrigin = 'https://radar.example.com';
const exact = (a: string, b: string) => a === b;

describe('origin verification', () => {
  it('never blocks a read', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(verifyOrigin({ method, origin: 'https://evil.test', secFetchSite: 'cross-site', expectedOrigin }).ok).toBe(true);
    }
  });

  it('accepts a write from our own origin', () => {
    expect(
      verifyOrigin({ method: 'POST', origin: expectedOrigin, secFetchSite: 'same-origin', expectedOrigin }).ok,
    ).toBe(true);
  });

  it('rejects a write from another origin even when the header looks plausible', () => {
    for (const origin of [
      'https://radar.example.com.evil.test',
      'https://evil.test',
      'http://radar.example.com',
      'https://radar.example.com:8443',
    ]) {
      const verdict = verifyOrigin({ method: 'POST', origin, secFetchSite: null, expectedOrigin });
      expect(verdict.ok).toBe(false);
    }
  });

  it('rejects a cross-site write regardless of the Origin header', () => {
    const verdict = verifyOrigin({
      method: 'POST',
      origin: expectedOrigin,
      secFetchSite: 'cross-site',
      expectedOrigin,
    });
    expect(verdict).toEqual({ ok: false, reason: 'cross_site' });
  });

  it('rejects a write that proves nothing about where it came from', () => {
    expect(verifyOrigin({ method: 'POST', origin: null, secFetchSite: null, expectedOrigin })).toEqual({
      ok: false,
      reason: 'origin_missing',
    });
  });

  it('ignores a trailing slash but not a differing host', () => {
    expect(
      verifyOrigin({ method: 'POST', origin: `${expectedOrigin}/`, secFetchSite: null, expectedOrigin }).ok,
    ).toBe(true);
  });

  it('treats method casing consistently', () => {
    expect(isSafeMethod('get')).toBe(true);
    expect(isSafeMethod('post')).toBe(false);
  });
});

describe('csrf token verification', () => {
  it('accepts the session token', () => {
    expect(verifyCsrfToken('secret-value', 'secret-value', exact)).toEqual({ ok: true });
  });

  it('rejects a missing token', () => {
    expect(verifyCsrfToken(null, 'secret-value', exact)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyCsrfToken('', 'secret-value', exact)).toEqual({ ok: false, reason: 'missing' });
  });

  it('rejects a token belonging to a different session', () => {
    expect(verifyCsrfToken('other-session', 'secret-value', exact)).toEqual({
      ok: false,
      reason: 'mismatch',
    });
  });
});
