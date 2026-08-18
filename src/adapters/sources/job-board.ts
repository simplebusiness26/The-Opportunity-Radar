import { revealUntrusted } from '../../domain/types/untrusted';
import type { FetchPage, NormalizedSourceItem, RawSourceItem, SourceAdapter } from '../../ports/source-adapter';
import { detectEntities, detectMoney } from './shared';
import { parseFeed } from './rss';

/**
 * Job adverts, read from the feeds boards publish.
 *
 * Hiring is one of the most honest signals available: a company paying a salary
 * to have something done by hand every week has told you the problem is real,
 * recurring and already costing them money. That is stronger evidence than most
 * complaints.
 */
export function createJobBoardAdapter(): SourceAdapter {
  return {
    manifest: {
      adapterKey: 'job_board',
      name: 'Job board feed',
      category: 'labour',
      description:
        'Reads a job board’s feed. A company paying someone to do a task manually every week is strong evidence the problem is real and already costing money.',
      evidenceClass: 'primary',
      defaultSignalType: 'labour',
      configFields: [
        {
          key: 'feedUrl',
          label: 'Feed URL',
          secret: false,
          required: true,
          hint: 'Most boards publish an RSS feed for a saved search.',
          placeholder: 'https://weworkremotely.com/categories/remote-programming-jobs.rss',
        },
        {
          key: 'mustMention',
          label: 'Only keep adverts mentioning',
          secret: false,
          required: false,
          hint: 'Comma separated. Leave blank to keep everything the feed returns.',
        },
      ],
      termsPolicy: 'Reads a feed the board publishes for syndication. Respects robots.txt.',
      respectsRobots: true,
      costNote: 'Free.',
    },

    validateConfig(config) {
      if (!config.feedUrl?.trim()) {
        return {
          ok: false,
          missing: ['feedUrl'],
          message: 'This source needs a job feed address.',
          remedy: 'Save a search on the job board and copy its RSS URL.',
        };
      }
      return { ok: true };
    },

    async fetch(context): Promise<FetchPage> {
      const feedUrl = context.config.feedUrl ?? '';

      const robots = await context.http.isAllowedByRobots(feedUrl);
      if (!robots.allowed) throw new Error(`Refused by robots.txt: ${robots.reason}`);

      const outcome = await context.http.fetch({ url: feedUrl, reason: 'job feed poll' });
      if (!outcome.ok) throw new Error(`Job feed: ${outcome.reason}`);

      const terms = (context.config.mustMention ?? '')
        .split(',')
        .map((term) => term.trim().toLowerCase())
        .filter(Boolean);

      const items = parseFeed(revealUntrusted(outcome.result.body))
        .filter((item) => {
          if (terms.length === 0) return true;
          const haystack = `${item.title} ${revealUntrusted(item.body)}`.toLowerCase();
          return terms.some((term) => haystack.includes(term));
        })
        .slice(0, context.maxItems)
        .map((item) => ({ ...item, externalId: item.externalId.replace('feed:', 'job:') }));

      return { items, cursor: null, exhausted: true };
    },

    normalize(item: RawSourceItem): NormalizedSourceItem {
      const text = revealUntrusted(item.body);
      return {
        externalId: item.externalId,
        url: item.url,
        title: item.title.slice(0, 300),
        bodyText: item.body,
        authorHandle: item.author,
        publishedAt: item.publishedAt,
        // Always a labour signal: that is what a job advert is, whatever words
        // happen to appear in the description.
        signalTypeKey: 'labour',
        // The employer published it themselves, so it is a primary source about
        // their own situation.
        evidenceClass: 'primary',
        citesUrl: null,
        entityNames: detectEntities(`${item.title} ${text}`),
        monetaryEvidence: detectMoney(text),
      };
    },

    async healthCheck(context) {
      const feedUrl = context.config.feedUrl ?? '';
      if (!feedUrl) return { ok: false, message: 'No feed address configured.' };

      const outcome = await context.http.fetch({ url: feedUrl, reason: 'health check' });
      if (!outcome.ok) return { ok: false, message: outcome.reason };

      const count = parseFeed(revealUntrusted(outcome.result.body)).length;
      return count > 0
        ? { ok: true, message: `${count} adverts available.` }
        : { ok: false, message: 'The feed returned no adverts Radar could read.' };
    },
  };
}

