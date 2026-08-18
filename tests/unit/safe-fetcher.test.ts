import { describe, expect, it } from 'vitest';
import { createSafeFetcher } from '../../src/adapters/http/safe-fetcher';
import { controllableClock } from '../../src/adapters/clock/index';
import { isPathAllowed, parseRobots } from '../../src/domain/net/robots';

const NOW = new Date('2026-08-18T00:00:00Z');

function fetcherWith(answers: Record<string, Array<{ address: string; family: number }>>) {
  return createSafeFetcher({
    clock: controllableClock(NOW),
    userAgent: 'OpportunityRadar/1.0 (+https://example.com/radar)',
    resolve: async (hostname) => {
      const answer = answers[hostname];
      if (!answer) throw new Error(`no test answer for ${hostname}`);
      return answer;
    },
  });
}

describe('resolution is checked, not just the URL', () => {
  it('refuses a perfectly ordinary hostname that resolves somewhere private', async () => {
    // Nothing about "feeds.example.com" looks suspicious. The address it
    // resolves to is the only thing that gives it away.
    const fetcher = fetcherWith({
      'feeds.example.com': [{ address: '169.254.169.254', family: 4 }],
    });

    const outcome = await fetcher.fetch({ url: 'https://feeds.example.com/latest' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('blocked_address');
      expect(outcome.reason).toContain('metadata');
      expect(outcome.retryable).toBe(false);
    }
  });

  it('refuses a host that answers with both a public and a private address', async () => {
    // Accepting the first usable answer would let this through; every answer
    // has to be clean.
    const fetcher = fetcherWith({
      'mixed.example.com': [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ],
    });

    const outcome = await fetcher.fetch({ url: 'https://mixed.example.com/' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('blocked_address');
  });

  it('refuses a host that resolves to loopback over IPv6', async () => {
    const fetcher = fetcherWith({ 'v6.example.com': [{ address: '::1', family: 6 }] });
    const outcome = await fetcher.fetch({ url: 'https://v6.example.com/' });
    expect(outcome.ok).toBe(false);
  });

  it('reports a resolution failure rather than proceeding', async () => {
    const fetcher = createSafeFetcher({
      clock: controllableClock(NOW),
      userAgent: 'test',
      resolve: async () => {
        throw new Error('NXDOMAIN');
      },
    });

    const outcome = await fetcher.fetch({ url: 'https://nowhere.example/' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('Could not resolve');
  });

  it('refuses a host that resolves to nothing at all', async () => {
    const fetcher = fetcherWith({ 'empty.example.com': [] });
    const outcome = await fetcher.fetch({ url: 'https://empty.example.com/' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('no addresses');
  });
});

/**
 * The attack that defeats validate-then-fetch implementations: answer the
 * validation lookup with a public address, then answer the connection's own
 * lookup with a private one.
 *
 * Radar resolves once and pins the connection to the address it checked, so a
 * second answer is never consulted. This test proves the second answer would
 * have been different -- and that it never got the chance to matter.
 */
describe('DNS rebinding', () => {
  it('never consults DNS a second time for the same request', async () => {
    let lookups = 0;

    const fetcher = createSafeFetcher({
      clock: controllableClock(NOW),
      userAgent: 'test',
      resolve: async () => {
        lookups += 1;
        // First answer public, every later answer the metadata endpoint.
        return lookups === 1
          ? [{ address: '93.184.216.34', family: 4 }]
          : [{ address: '169.254.169.254', family: 4 }];
      },
    });

    // The connection itself will fail in this environment, which is fine: what
    // matters is that only one lookup was made, so the rebinding answer could
    // never have been used.
    await fetcher.fetch({ url: 'https://rebind.example/', timeoutMs: 1000 });
    expect(lookups).toBe(1);
  });
});

describe('URL rules are applied before anything else', () => {
  it('never resolves a URL the rules already refused', async () => {
    let resolved = false;
    const fetcher = createSafeFetcher({
      clock: controllableClock(NOW),
      userAgent: 'test',
      resolve: async () => {
        resolved = true;
        return [{ address: '93.184.216.34', family: 4 }];
      },
    });

    const outcome = await fetcher.fetch({ url: 'file:///etc/passwd' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe('blocked_url');
    expect(resolved).toBe(false);
  });
});

describe('rate limiting', () => {
  it('refuses further requests to a host that has had its share', async () => {
    const clock = controllableClock(NOW);
    const fetcher = createSafeFetcher({
      clock,
      userAgent: 'test',
      perHostPerMinute: 2,
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    // The connections fail in this environment, but the bucket is consumed
    // before the request is attempted, which is what is under test.
    await fetcher.fetch({ url: 'https://example.com/a', timeoutMs: 500 });
    await fetcher.fetch({ url: 'https://example.com/b', timeoutMs: 500 });
    const third = await fetcher.fetch({ url: 'https://example.com/c', timeoutMs: 500 });

    expect(third.ok).toBe(false);
    if (!third.ok) {
      expect(third.code).toBe('rate_limited');
      // Retryable: this is politeness, not refusal.
      expect(third.retryable).toBe(true);
    }
  });

  it('limits each host separately', async () => {
    const fetcher = createSafeFetcher({
      clock: controllableClock(NOW),
      userAgent: 'test',
      perHostPerMinute: 1,
      resolve: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    await fetcher.fetch({ url: 'https://one.example/', timeoutMs: 500 });
    const other = await fetcher.fetch({ url: 'https://two.example/', timeoutMs: 500 });

    // A busy host must not stop Radar reading a quiet one.
    if (!other.ok) expect(other.code).not.toBe('rate_limited');
  });
});

describe('robots.txt', () => {
  const agent = 'OpportunityRadar/1.0';

  it('honours a disallow for our agent', () => {
    const policy = parseRobots(
      ['User-agent: OpportunityRadar', 'Disallow: /private', '', 'User-agent: *', 'Disallow: /'].join('\n'),
      agent,
    );

    expect(isPathAllowed(policy, '/public/page')).toBe(true);
    expect(isPathAllowed(policy, '/private/page')).toBe(false);
  });

  it('falls back to the wildcard group when we are not named', () => {
    const policy = parseRobots(['User-agent: *', 'Disallow: /admin'].join('\n'), agent);
    expect(isPathAllowed(policy, '/admin/x')).toBe(false);
    expect(isPathAllowed(policy, '/blog')).toBe(true);
  });

  it('lets a longer allow override a shorter disallow', () => {
    const policy = parseRobots(
      ['User-agent: *', 'Disallow: /blog', 'Allow: /blog/public'].join('\n'),
      agent,
    );
    expect(isPathAllowed(policy, '/blog/private')).toBe(false);
    expect(isPathAllowed(policy, '/blog/public/post')).toBe(true);
  });

  it('treats an empty disallow as permitting everything', () => {
    const policy = parseRobots(['User-agent: *', 'Disallow:'].join('\n'), agent);
    expect(isPathAllowed(policy, '/anything')).toBe(true);
  });

  it('understands wildcards and end anchors', () => {
    const policy = parseRobots(
      ['User-agent: *', 'Disallow: /*.pdf$', 'Disallow: /search?*'].join('\n'),
      agent,
    );
    expect(isPathAllowed(policy, '/files/report.pdf')).toBe(false);
    expect(isPathAllowed(policy, '/files/report.pdf.html')).toBe(true);
    expect(isPathAllowed(policy, '/search?q=x')).toBe(false);
  });

  it('reads a crawl delay when one is set', () => {
    const policy = parseRobots(['User-agent: *', 'Crawl-delay: 10'].join('\n'), agent);
    expect(policy.crawlDelaySeconds).toBe(10);
  });

  it('groups consecutive user-agent lines together', () => {
    const policy = parseRobots(
      ['User-agent: SomeBot', 'User-agent: OpportunityRadar', 'Disallow: /shared'].join('\n'),
      agent,
    );
    expect(isPathAllowed(policy, '/shared/x')).toBe(false);
  });

  it('ignores comments and malformed lines', () => {
    const policy = parseRobots(
      ['# a comment', 'User-agent: *', 'nonsense line', 'Disallow: /x # trailing'].join('\n'),
      agent,
    );
    expect(isPathAllowed(policy, '/x')).toBe(false);
    expect(isPathAllowed(policy, '/y')).toBe(true);
  });
});
