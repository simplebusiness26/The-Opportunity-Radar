import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkUrl, registrableDomain } from '../../src/domain/net/url-rules';
import { checkAddress } from '../../src/domain/net/ip-rules';

const HOSTILE = JSON.parse(
  readFileSync(new URL('../../fixtures/ssrf/hostile-urls.json', import.meta.url), 'utf8'),
) as {
  cases: Array<{ url: string; technique: string; code: string }>;
  allowed: string[];
};

describe('refusing hostile URLs before any lookup happens', () => {
  // The cases marked `resolved` need DNS to catch; they are covered by the
  // address rules below and by the fetcher's own resolution step.
  const staticCases = HOSTILE.cases.filter((entry) => entry.code !== 'resolved');

  it.each(staticCases)('refuses $url ($technique)', ({ url, code }) => {
    const verdict = checkUrl(url);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.code).toBe(code);
      // The reason has to be useful to whoever reads the source health page.
      expect(verdict.reason.length).toBeGreaterThan(10);
    }
  });

  it.each(HOSTILE.allowed)('permits %s', (url) => {
    const verdict = checkUrl(url);
    expect(verdict.allowed).toBe(true);
  });

  it('permits plain http only for a host explicitly allowed', () => {
    expect(checkUrl('http://intranet.example/feed').allowed).toBe(false);
    expect(
      checkUrl('http://intranet.example/feed', {
        allowHttpHosts: ['intranet.example'],
        allowedPorts: [80, 443],
        maxRedirects: 5,
      }).allowed,
    ).toBe(true);
  });
});

describe('address rules', () => {
  it('blocks every private and special-purpose IPv4 range', () => {
    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.1.1',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(checkAddress(address, 4).allowed, address).toBe(false);
    }
  });

  it('permits ordinary public addresses', () => {
    for (const address of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '192.169.0.1']) {
      expect(checkAddress(address, 4).allowed, address).toBe(true);
    }
  });

  it('blocks IPv4 hidden inside IPv6 notation', () => {
    // A mapped address reaches exactly the same host, so unwrapping it before
    // applying the IPv4 rules is the whole point.
    expect(checkAddress('::ffff:127.0.0.1', 6).allowed).toBe(false);
    expect(checkAddress('::ffff:7f00:1', 6).allowed).toBe(false);
    expect(checkAddress('::ffff:10.0.0.1', 6).allowed).toBe(false);
  });

  it('blocks IPv6 loopback, link-local and unique-local ranges', () => {
    for (const address of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1']) {
      expect(checkAddress(address, 6).allowed, address).toBe(false);
    }
  });

  it('ignores an IPv6 zone identifier when matching', () => {
    expect(checkAddress('fe80::1%eth0', 6).allowed).toBe(false);
  });

  it('rejects octal-looking octets rather than parsing them as decimal', () => {
    // Some resolvers read 0177.0.0.1 as 127.0.0.1. Treating it as invalid is
    // safer than picking an interpretation.
    expect(checkAddress('0177.0.0.1', 4).allowed).toBe(false);
    expect(checkAddress('010.0.0.1', 4).allowed).toBe(false);
  });

  it('explains why an address was refused', () => {
    const verdict = checkAddress('169.254.169.254', 4);
    expect(verdict.reason).toContain('metadata');
  });
});

describe('working out who published something', () => {
  it('collapses subdomains of an ordinary site to one publisher', () => {
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('www.example.com')).toBe('example.com');
    expect(registrableDomain('a.b.c.example.com')).toBe('example.com');
  });

  it('keeps hosting platforms per author', () => {
    // Two personal newsletters are two independent sources; treating them as
    // one publisher would understate genuine corroboration.
    expect(registrableDomain('alice.substack.com')).toBe('alice.substack.com');
    expect(registrableDomain('bob.substack.com')).toBe('bob.substack.com');
    expect(registrableDomain('someone.github.io')).toBe('someone.github.io');
  });

  it('handles multi-part suffixes', () => {
    expect(registrableDomain('shop.example.com.au')).toBe('example.com.au');
    expect(registrableDomain('example.co.nz')).toBe('example.co.nz');
  });
});
