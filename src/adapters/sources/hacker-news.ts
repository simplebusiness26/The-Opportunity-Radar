import { markUntrusted, revealUntrusted } from '../../domain/types/untrusted';
import type {
  AdapterContext,
  FetchPage,
  NormalizedSourceItem,
  RawSourceItem,
  SourceAdapter,
} from '../../ports/source-adapter';
import { detectMoney, detectSignalType, stripHtml } from './shared';

/**
 * Hacker News, through the public Algolia search API.
 *
 * Needs no credentials, which makes it the source a new installation can
 * actually use on day one. Search terms come from the workspace, so what it
 * returns depends on what the owner is looking for rather than on a firehose.
 */
export function createHackerNewsAdapter(): SourceAdapter {
  return {
    manifest: {
      adapterKey: 'hacker_news',
      name: 'Hacker News',
      category: 'community',
      description:
        'Searches Hacker News stories and comments for the terms you specify. Strong for technology shifts and developer pain; weak for anything a general business audience would discuss.',
      evidenceClass: 'community',
      defaultSignalType: 'pain',
      configFields: [
        {
          key: 'query',
          label: 'Search terms',
          secret: false,
          required: true,
          hint: 'What to look for, e.g. "booking deposits no-show".',
          placeholder: 'restaurant booking deposit',
        },
        {
          key: 'minPoints',
          label: 'Minimum points',
          secret: false,
          required: false,
          hint: 'Filters out threads nobody engaged with. Default 5.',
          placeholder: '5',
        },
      ],
      termsPolicy:
        'Uses the public Algolia API that Hacker News provides for this purpose. No scraping, no authentication required.',
      respectsRobots: true,
      costNote: 'Free.',
    },

    validateConfig(config) {
      if (!config.query?.trim()) {
        return {
          ok: false,
          missing: ['query'],
          message: 'Hacker News needs something to search for.',
          remedy: 'Add search terms describing the problem you are watching.',
        };
      }
      return { ok: true };
    },

    async fetch(context: AdapterContext, cursor): Promise<FetchPage> {
      const page = cursor ? Number(cursor) : 0;
      const minPoints = Number(context.config.minPoints ?? 5);

      const url = new URL('https://hn.algolia.com/api/v1/search_by_date');
      url.searchParams.set('query', context.config.query ?? '');
      url.searchParams.set('tags', '(story,comment)');
      url.searchParams.set('numericFilters', `points>=${Number.isFinite(minPoints) ? minPoints : 5}`);
      url.searchParams.set('hitsPerPage', String(Math.min(context.maxItems, 50)));
      url.searchParams.set('page', String(page));

      const outcome = await context.http.fetch({ url: url.toString(), reason: 'hacker news search' });
      if (!outcome.ok) throw new Error(`Hacker News: ${outcome.reason}`);

      const payload = JSON.parse(revealUntrusted(outcome.result.body)) as {
        hits?: Array<{
          objectID?: string;
          title?: string | null;
          story_title?: string | null;
          comment_text?: string | null;
          story_text?: string | null;
          url?: string | null;
          story_url?: string | null;
          author?: string | null;
          created_at?: string;
          points?: number | null;
        }>;
        nbPages?: number;
      };

      const items: RawSourceItem[] = (payload.hits ?? []).map((hit) => ({
        externalId: `hn:${hit.objectID}`,
        url: hit.url ?? hit.story_url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
        title: hit.title ?? hit.story_title ?? 'Hacker News comment',
        body: markUntrusted(stripHtml(hit.comment_text ?? hit.story_text ?? hit.title ?? '')),
        author: hit.author ?? null,
        publishedAt: hit.created_at ? new Date(hit.created_at) : null,
        raw: { points: hit.points ?? null, objectID: hit.objectID },
      }));

      const nextPage = page + 1;
      return {
        items,
        cursor: String(nextPage),
        exhausted: nextPage >= (payload.nbPages ?? 1) || items.length === 0,
      };
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
        signalTypeKey: detectSignalType(`${item.title} ${text}`),
        // A forum comment is community evidence, however convincing it reads.
        // Calling it direct customer evidence would overstate what it is.
        evidenceClass: 'community',
        citesUrl: null,
        entityNames: [],
        monetaryEvidence: detectMoney(text),
      };
    },

    async healthCheck(context) {
      const outcome = await context.http.fetch({
        url: 'https://hn.algolia.com/api/v1/search?query=test&hitsPerPage=1',
        reason: 'health check',
      });
      return outcome.ok
        ? { ok: true, message: 'Hacker News search is reachable.' }
        : { ok: false, message: outcome.reason };
    },
  };
}
