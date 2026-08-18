import { describe, expect, it } from 'vitest';
import { ADAPTER_REGISTRY, adaptersNeedingNoCredentials } from '../../src/adapters/sources/registry';
import { EVIDENCE_CLASSES } from '../../src/domain/taxonomy/evidence-class';
import { SIGNAL_TYPES } from '../../src/domain/taxonomy/signal-types';
import { detectMoney, detectSignalType, stripHtml } from '../../src/adapters/sources/shared';
import { createRecordedFetcher } from './helpers/recorded-fetcher';
import type { AdapterContext } from '../../src/ports/source-adapter';

function contextWith(
  fetcher: ReturnType<typeof createRecordedFetcher>,
  config: Record<string, string>,
): AdapterContext {
  return { http: fetcher, config, maxItems: 25, userAgent: 'OpportunityRadar/1.0 (test)' };
}

/**
 * Every adapter is held to the same contract, so a new one cannot be added
 * that quietly skips validation, mislabels its evidence, or claims a config
 * field the interface cannot render.
 */
describe('the adapter contract', () => {
  const adapters = [...ADAPTER_REGISTRY.values()];

  it.each(adapters.map((adapter) => [adapter.manifest.adapterKey, adapter] as const))(
    '%s declares a complete, honest manifest',
    (_key, adapter) => {
      const manifest = adapter.manifest;

      expect(manifest.name.length).toBeGreaterThan(2);
      expect(manifest.description.length).toBeGreaterThan(40);
      // The evidence class and signal type must exist in the taxonomies, or
      // scoring downstream would receive a value it cannot interpret.
      expect(EVIDENCE_CLASSES[manifest.evidenceClass]).toBeDefined();
      expect(SIGNAL_TYPES[manifest.defaultSignalType]).toBeDefined();
      // Terms are recorded honestly rather than left implicit.
      expect(manifest.termsPolicy.length).toBeGreaterThan(20);
      expect(manifest.costNote.length).toBeGreaterThan(3);
    },
  );

  it.each(adapters.map((adapter) => [adapter.manifest.adapterKey, adapter] as const))(
    '%s describes every config field well enough to render a form',
    (_key, adapter) => {
      for (const field of adapter.manifest.configFields) {
        expect(field.key).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
        expect(field.label.length).toBeGreaterThan(2);
        expect(field.hint.length).toBeGreaterThan(10);
      }
    },
  );

  it.each(adapters.map((adapter) => [adapter.manifest.adapterKey, adapter] as const))(
    '%s refuses an empty configuration and says what is missing',
    (_key, adapter) => {
      const required = adapter.manifest.configFields.filter((field) => field.required);
      const status = adapter.validateConfig({});

      if (required.length === 0) {
        expect(status.ok).toBe(true);
        return;
      }

      expect(status.ok).toBe(false);
      if (!status.ok) {
        expect(status.missing.length).toBeGreaterThan(0);
        // The remedy has to tell the owner what to actually do.
        expect(status.remedy.length).toBeGreaterThan(15);
      }
    },
  );

  it('names any adapter that needs a secret, so the checklist can be generated', () => {
    const needingSecrets = adapters.filter((adapter) =>
      adapter.manifest.configFields.some((field) => field.secret && field.required),
    );

    for (const adapter of needingSecrets) {
      // If it needs a credential, it must say where to get one.
      expect(adapter.manifest.credentialsUrl, adapter.manifest.adapterKey).toBeTruthy();
    }
  });

  it('offers at least two sources that work with no credentials at all', () => {
    // A new installation must have something real to ingest on day one.
    const free = adaptersNeedingNoCredentials();
    expect(free.length).toBeGreaterThanOrEqual(2);
    expect(free.map((adapter) => adapter.manifest.adapterKey)).toEqual(
      expect.arrayContaining(['hacker_news', 'rss']),
    );
  });
});

describe('Hacker News', () => {
  const adapter = ADAPTER_REGISTRY.get('hacker_news')!;

  it('reads a recorded search response', async () => {
    const fetcher = createRecordedFetcher([{ match: 'hn.algolia.com', file: 'hacker-news.json' }]);
    const page = await adapter.fetch(contextWith(fetcher, { query: 'booking deposit' }), null);

    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.externalId).toBe('hn:39001234');
    expect(page.items[0]?.title).toContain('no-shows');
  });

  it('classifies observed spending and extracts the amount', async () => {
    const fetcher = createRecordedFetcher([{ match: 'hn.algolia.com', file: 'hacker-news.json' }]);
    const page = await adapter.fetch(contextWith(fetcher, { query: 'x' }), null);

    const spending = adapter.normalize(page.items[0]!);
    expect(spending.signalTypeKey).toBe('spending');
    expect(spending.monetaryEvidence?.monthlyAmount).toBe(180);
    expect(spending.monetaryEvidence?.currency).toBe('USD');

    const demand = adapter.normalize(page.items[1]!);
    expect(demand.signalTypeKey).toBe('demand');
  });

  it('never claims a forum post is direct customer evidence', async () => {
    const fetcher = createRecordedFetcher([{ match: 'hn.algolia.com', file: 'hacker-news.json' }]);
    const page = await adapter.fetch(contextWith(fetcher, { query: 'x' }), null);

    // However convincing a comment reads, it is community evidence. Promoting
    // it would inflate confidence on the strength of tone alone.
    for (const item of page.items) {
      expect(adapter.normalize(item).evidenceClass).toBe('community');
    }
  });

  it('applies the minimum-points filter the owner configured', async () => {
    const fetcher = createRecordedFetcher([{ match: 'hn.algolia.com', file: 'hacker-news.json' }]);
    await adapter.fetch(contextWith(fetcher, { query: 'x', minPoints: '50' }), null);
    expect(fetcher.requests[0]?.url).toContain('points%3E%3D50');
  });
});

describe('RSS and Atom', () => {
  const adapter = ADAPTER_REGISTRY.get('rss')!;

  it('reads entries, strips markup and keeps the link', async () => {
    const fetcher = createRecordedFetcher([{ match: 'regulator.example', file: 'feed.xml' }]);
    const page = await adapter.fetch(
      contextWith(fetcher, { feedUrl: 'https://regulator.example/feed.xml' }),
      null,
    );

    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.url).toBe('https://regulator.example/announcements/deposit-rules');
    // The CDATA-wrapped HTML body is unwrapped and stripped.
    expect(page.items[0]?.body).toContain('separate client account');
    expect(page.items[0]?.body).not.toContain('<p>');
  });

  it('recognises a regulatory change from the wording', async () => {
    const fetcher = createRecordedFetcher([{ match: 'regulator.example', file: 'feed.xml' }]);
    const page = await adapter.fetch(
      contextWith(fetcher, { feedUrl: 'https://regulator.example/feed.xml' }),
      null,
    );

    expect(adapter.normalize(page.items[0]!).signalTypeKey).toBe('regulation');
  });

  it('refuses to fetch when robots.txt disallows it', async () => {
    const fetcher = createRecordedFetcher([{ match: 'blocked.example', file: 'feed.xml' }]);
    fetcher.isAllowedByRobots = async () => ({ allowed: false, reason: 'Disallow: /feed' });

    await expect(
      adapter.fetch(contextWith(fetcher, { feedUrl: 'https://blocked.example/feed' }), null),
    ).rejects.toThrow(/robots/i);
  });

  it('reports an unreadable feed rather than silently returning nothing', async () => {
    const fetcher = createRecordedFetcher([
      { match: 'empty.example', body: '<html><body>not a feed</body></html>', contentType: 'text/html' },
    ]);

    const health = await adapter.healthCheck(
      contextWith(fetcher, { feedUrl: 'https://empty.example/feed' }),
    );
    expect(health.ok).toBe(false);
    expect(health.remedy).toContain('points at the feed');
  });
});

describe('GitHub', () => {
  const adapter = ADAPTER_REGISTRY.get('github')!;

  it('reads issues and keeps the repository as an entity', async () => {
    const fetcher = createRecordedFetcher([{ match: 'api.github.com/search', file: 'github-issues.json' }]);
    const page = await adapter.fetch(contextWith(fetcher, { query: 'deposit' }), null);

    expect(page.items).toHaveLength(2);
    const normalized = adapter.normalize(page.items[0]!);
    expect(normalized.entityNames).toContain('example/bookings');
    expect(normalized.signalTypeKey).toBe('workaround');
  });

  it('works without a token but explains the limit', async () => {
    const fetcher = createRecordedFetcher([
      { match: 'rate_limit', body: JSON.stringify({ resources: { search: { remaining: 8, limit: 10 } } }) },
    ]);

    const health = await adapter.healthCheck(contextWith(fetcher, { query: 'x' }));
    expect(health.ok).toBe(true);
    expect(health.remedy).toContain('60 to 5,000');
  });

  it('sends the token when one is configured', async () => {
    const fetcher = createRecordedFetcher([{ match: 'api.github.com/search', file: 'github-issues.json' }]);
    await adapter.fetch(contextWith(fetcher, { query: 'x', token: 'ghp_example' }), null);
    expect(fetcher.requests[0]?.headers?.authorization).toBe('Bearer ghp_example');
  });
});

describe('Reddit', () => {
  const adapter = ADAPTER_REGISTRY.get('reddit')!;

  it('authenticates and then searches', async () => {
    const fetcher = createRecordedFetcher([
      { match: 'access_token', body: JSON.stringify({ access_token: 'token-123' }) },
      { match: 'oauth.reddit.com', file: 'reddit-search.json' },
    ]);

    const page = await adapter.fetch(
      contextWith(fetcher, {
        subreddits: 'restaurateur',
        query: 'no-show',
        clientId: 'id',
        clientSecret: 'secret',
      }),
      null,
    );

    // The token request is a POST through the same guarded fetcher.
    expect(fetcher.requests[0]?.method).toBe('POST');
    expect(fetcher.requests[1]?.headers?.authorization).toBe('Bearer token-123');
    expect(page.items).toHaveLength(1);
  });

  it('extracts the amount someone says they are losing', async () => {
    const fetcher = createRecordedFetcher([
      { match: 'access_token', body: JSON.stringify({ access_token: 't' }) },
      { match: 'oauth.reddit.com', file: 'reddit-search.json' },
    ]);

    const page = await adapter.fetch(
      contextWith(fetcher, { subreddits: 'x', query: 'y', clientId: 'a', clientSecret: 'b' }),
      null,
    );

    const normalized = adapter.normalize(page.items[0]!);
    expect(normalized.monetaryEvidence?.monthlyAmount).toBe(400);
    expect(normalized.monetaryEvidence?.currency).toBe('GBP');
    expect(normalized.entityNames).toContain('r/restaurateur');
  });

  it('says exactly what is missing when it is not configured', () => {
    const status = adapter.validateConfig({ subreddits: 'x' });
    expect(status.ok).toBe(false);
    if (!status.ok) {
      expect(status.missing).toEqual(expect.arrayContaining(['query', 'clientId', 'clientSecret']));
      expect(status.remedy).toContain('reddit.com/prefs/apps');
    }
  });

  it('states plainly that it does not scrape as a fallback', () => {
    expect(adapter.manifest.termsPolicy).toContain('does not scrape');
  });
});

describe('job boards', () => {
  const adapter = ADAPTER_REGISTRY.get('job_board')!;

  it('treats every advert as labour evidence from a primary source', async () => {
    const fetcher = createRecordedFetcher([{ match: 'jobs.example', file: 'feed.xml' }]);
    const page = await adapter.fetch(contextWith(fetcher, { feedUrl: 'https://jobs.example/feed' }), null);

    const normalized = adapter.normalize(page.items[0]!);
    // An employer describing their own hiring need is a primary source about
    // their own situation, whatever the advert happens to say.
    expect(normalized.signalTypeKey).toBe('labour');
    expect(normalized.evidenceClass).toBe('primary');
  });

  it('filters to adverts mentioning the terms that matter', async () => {
    const fetcher = createRecordedFetcher([{ match: 'jobs.example', file: 'feed.xml' }]);

    const all = await adapter.fetch(contextWith(fetcher, { feedUrl: 'https://jobs.example/feed' }), null);
    const filtered = await adapter.fetch(
      contextWith(fetcher, { feedUrl: 'https://jobs.example/feed', mustMention: 'deposit' }),
      null,
    );

    expect(filtered.items.length).toBeLessThan(all.items.length);
  });
});

describe('deterministic classification', () => {
  it('recognises the signal types that matter most, by rule', () => {
    expect(detectSignalType('We pay $200/month for this and it still cannot do X')).toBe('spending');
    expect(detectSignalType('Is there a tool that does this automatically?')).toBe('demand');
    expect(detectSignalType('We do it manually in a spreadsheet every week')).toBe('workaround');
    expect(detectSignalType('We are hiring a coordinator to handle this')).toBe('labour');
    expect(detectSignalType('New regulation requires disclosure at booking')).toBe('regulation');
    expect(detectSignalType('This is losing us money every week')).toBe('pain');
  });

  it('does not mistake time for money', () => {
    // "We spend six hours a week" is a real cost, but it is not evidence of
    // willingness to pay -- and willingness to pay is the dimension the scoring
    // engine leans on hardest, so inflating it would distort every score.
    expect(detectSignalType('We spend about 6 hours a week on this manually')).toBe('workaround');
    expect(detectSignalType('They spend days chasing this every month')).toBe('workaround');

    // With an actual amount attached, it is spending.
    expect(detectSignalType('We spend £400 a month on this')).toBe('spending');
  });

  it('reads monthly, annual and one-off amounts', () => {
    expect(detectMoney('we pay £400/month')?.monthlyAmount).toBe(400);
    expect(detectMoney('costs us $1,200 per year')?.monthlyAmount).toBe(100);
    expect(detectMoney('a one-off €5,000 setup fee')?.oneOffAmount).toBe(5000);
    expect(detectMoney('no numbers here')).toBeUndefined();
  });

  it('understands the article forms people actually write', () => {
    // "£400 a month" is at least as common as "£400 per month"; missing it
    // would lose a large share of the strongest evidence Radar handles.
    expect(detectMoney('we lose £400 a month')?.monthlyAmount).toBe(400);
    expect(detectMoney('$99 each month')?.monthlyAmount).toBe(99);
    expect(detectMoney('€120 every year')?.monthlyAmount).toBe(10);
  });

  it('normalises weekly amounts to a monthly figure', () => {
    // Comparing amounts across sources requires one unit; doing the arithmetic
    // here means no reader has to.
    expect(detectMoney('£100 a week')?.monthlyAmount).toBeCloseTo(433.33, 2);
  });

  it('keeps the surrounding words as a quote, so the figure has context', () => {
    const money = detectMoney('Our booking system costs £180/month and cannot take deposits');
    expect(money?.quote).toContain('booking system');
  });

  it('strips markup without losing the text', () => {
    expect(stripHtml('<p>Hello <b>there</b></p>')).toBe('Hello there');
    expect(stripHtml('<script>bad()</script>Safe')).toBe('Safe');
    expect(stripHtml('a &amp; b &lt;c&gt;')).toBe('a & b <c>');
  });
});
