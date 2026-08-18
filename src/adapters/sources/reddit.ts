import { markUntrusted, revealUntrusted } from '../../domain/types/untrusted';
import type {
  AdapterContext,
  FetchPage,
  NormalizedSourceItem,
  RawSourceItem,
  SourceAdapter,
} from '../../ports/source-adapter';
import { detectEntities, detectMoney, detectSignalType } from './shared';

/**
 * Reddit, through the official API.
 *
 * Reddit requires OAuth credentials and enforces its terms strictly, so this
 * adapter is complete but disabled until the owner supplies them. It never
 * falls back to scraping the HTML site: doing so would breach the terms, and a
 * source that works by breaking rules is not a source anyone should build on.
 */
export function createRedditAdapter(): SourceAdapter {
  return {
    manifest: {
      adapterKey: 'reddit',
      name: 'Reddit',
      category: 'community',
      description:
        'Searches subreddits you name for the terms you specify. The best source of unfiltered customer complaint in the product, and the one most likely to contain real spending figures.',
      evidenceClass: 'community',
      defaultSignalType: 'pain',
      configFields: [
        {
          key: 'subreddits',
          label: 'Subreddits',
          secret: false,
          required: true,
          hint: 'Comma separated, without the r/ prefix.',
          placeholder: 'smallbusiness, restaurateur',
        },
        { key: 'query', label: 'Search terms', secret: false, required: true, hint: 'What to look for.' },
        {
          key: 'clientId',
          label: 'Client ID',
          secret: false,
          required: true,
          hint: 'From a "script" app created in your Reddit account.',
        },
        { key: 'clientSecret', label: 'Client secret', secret: true, required: true, hint: 'From the same app.' },
      ],
      credentialsUrl: 'https://www.reddit.com/prefs/apps',
      termsPolicy:
        'Uses the official API under Reddit’s developer terms. Radar does not scrape the HTML site as a fallback: that would breach those terms.',
      respectsRobots: true,
      costNote: 'Free for the low request volumes Radar makes. Reddit charges for high-volume commercial use.',
    },

    validateConfig(config) {
      const missing = ['subreddits', 'query', 'clientId', 'clientSecret'].filter(
        (field) => !config[field]?.trim(),
      );

      return missing.length === 0
        ? { ok: true }
        : {
            ok: false,
            missing,
            message: `Reddit is missing ${missing.length} setting(s).`,
            remedy:
              'Create a "script" application at reddit.com/prefs/apps, then paste its client ID and secret here.',
          };
    },

    async fetch(context, cursor): Promise<FetchPage> {
      const token = await authenticate(context);

      const subreddits = (context.config.subreddits ?? '')
        .split(',')
        .map((value) => value.trim().replace(/^r\//, ''))
        .filter(Boolean)
        .join('+');

      const url = new URL(`https://oauth.reddit.com/r/${subreddits}/search`);
      url.searchParams.set('q', context.config.query ?? '');
      url.searchParams.set('restrict_sr', 'true');
      url.searchParams.set('sort', 'new');
      url.searchParams.set('limit', String(Math.min(context.maxItems, 100)));
      if (cursor) url.searchParams.set('after', cursor);

      const outcome = await context.http.fetch({
        url: url.toString(),
        headers: { authorization: `Bearer ${token}`, 'user-agent': context.userAgent },
        reason: 'reddit search',
      });
      if (!outcome.ok) throw new Error(`Reddit: ${outcome.reason}`);

      const payload = JSON.parse(revealUntrusted(outcome.result.body)) as {
        data?: {
          after?: string | null;
          children?: Array<{
            data?: {
              id?: string;
              title?: string;
              selftext?: string;
              permalink?: string;
              author?: string;
              created_utc?: number;
              subreddit?: string;
              score?: number;
              num_comments?: number;
            };
          }>;
        };
      };

      const items: RawSourceItem[] = (payload.data?.children ?? []).map((child) => {
        const post = child.data ?? {};
        return {
          externalId: `reddit:${post.id}`,
          url: post.permalink ? `https://www.reddit.com${post.permalink}` : null,
          title: post.title ?? 'Reddit post',
          body: markUntrusted(post.selftext ?? post.title ?? ''),
          author: post.author ?? null,
          publishedAt: post.created_utc ? new Date(post.created_utc * 1000) : null,
          raw: { subreddit: post.subreddit, score: post.score, comments: post.num_comments },
        };
      });

      const after = payload.data?.after ?? null;
      return { items, cursor: after, exhausted: !after || items.length === 0 };
    },

    normalize(item: RawSourceItem): NormalizedSourceItem {
      const text = revealUntrusted(item.body);
      const subreddit = typeof item.raw.subreddit === 'string' ? `r/${item.raw.subreddit}` : null;

      return {
        externalId: item.externalId,
        url: item.url,
        title: item.title.slice(0, 300),
        bodyText: item.body,
        authorHandle: item.author,
        publishedAt: item.publishedAt,
        signalTypeKey: detectSignalType(`${item.title} ${text}`),
        // Someone describing their own business is closer to direct customer
        // evidence, but only AI extraction can tell that reliably. The adapter
        // claims the lower tier and lets a later stage promote it.
        evidenceClass: 'community',
        citesUrl: null,
        entityNames: [...(subreddit ? [subreddit] : []), ...detectEntities(text)],
        monetaryEvidence: detectMoney(text),
      };
    },

    async healthCheck(context) {
      const status = this.validateConfig(context.config);
      if (!status.ok) return { ok: false, message: status.message, remedy: status.remedy };

      try {
        await authenticate(context);
        return { ok: true, message: 'Reddit credentials accepted.' };
      } catch (error) {
        return {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          remedy: 'Check the client ID and secret at reddit.com/prefs/apps.',
        };
      }
    },
  };
}

/**
 * Exchanges the client credentials for an access token.
 *
 * The request goes through the same fetcher as everything else, so it is
 * subject to the identical address checks -- authentication is not a reason to
 * open a second, less careful path to the network.
 */
async function authenticate(context: AdapterContext): Promise<string> {
  const credentials = Buffer.from(
    `${context.config.clientId ?? ''}:${context.config.clientSecret ?? ''}`,
  ).toString('base64');

  const outcome = await context.http.fetch({
    url: 'https://www.reddit.com/api/v1/access_token',
    method: 'POST',
    form: { grant_type: 'client_credentials' },
    headers: {
      authorization: `Basic ${credentials}`,
      'user-agent': context.userAgent,
    },
    reason: 'reddit authentication',
  });

  if (!outcome.ok) {
    throw new Error(
      outcome.code === 'http_error'
        ? 'Reddit rejected the credentials. Check the client ID and secret.'
        : `Reddit authentication failed: ${outcome.reason}`,
    );
  }

  const payload = JSON.parse(revealUntrusted(outcome.result.body)) as {
    access_token?: string;
    error?: string;
  };

  if (!payload.access_token) {
    throw new Error(`Reddit did not return a token${payload.error ? `: ${payload.error}` : '.'}`);
  }

  return payload.access_token;
}
