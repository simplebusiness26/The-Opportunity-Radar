import { markUntrusted, revealUntrusted } from '../../domain/types/untrusted';
import type { FetchPage, NormalizedSourceItem, RawSourceItem, SourceAdapter } from '../../ports/source-adapter';
import { detectEntities, detectMoney, detectSignalType } from './shared';

/**
 * GitHub issues and discussions.
 *
 * Works unauthenticated at sixty requests an hour, which is enough to try it
 * out; a token raises that to five thousand. The distinction is stated plainly
 * in the manifest rather than letting the source mysteriously stall.
 */
export function createGitHubAdapter(): SourceAdapter {
  return {
    manifest: {
      adapterKey: 'github',
      name: 'GitHub issues',
      category: 'technology',
      description:
        'Searches GitHub issues and discussions. Good for technology unlocks and for the friction developers hit with existing tools.',
      evidenceClass: 'community',
      defaultSignalType: 'pain',
      configFields: [
        {
          key: 'query',
          label: 'Search query',
          secret: false,
          required: true,
          hint: 'GitHub search syntax, e.g. "booking deposit in:title state:open".',
          placeholder: 'label:bug booking deposit',
        },
        {
          key: 'token',
          label: 'Personal access token',
          secret: true,
          required: false,
          hint: 'Optional. Without one GitHub allows 60 requests an hour; with one, 5,000. A token with no scopes is sufficient for public data.',
        },
      ],
      credentialsUrl: 'https://github.com/settings/tokens',
      termsPolicy:
        'Uses the documented REST search API within its published rate limits. Public repositories only.',
      respectsRobots: false,
      costNote: 'Free.',
    },

    validateConfig(config) {
      if (!config.query?.trim()) {
        return {
          ok: false,
          missing: ['query'],
          message: 'GitHub needs a search query.',
          remedy: 'Add one using GitHub search syntax.',
        };
      }
      return { ok: true };
    },

    async fetch(context, cursor): Promise<FetchPage> {
      const page = cursor ? Number(cursor) : 1;

      const url = new URL('https://api.github.com/search/issues');
      url.searchParams.set('q', context.config.query ?? '');
      url.searchParams.set('sort', 'created');
      url.searchParams.set('order', 'desc');
      url.searchParams.set('per_page', String(Math.min(context.maxItems, 50)));
      url.searchParams.set('page', String(page));

      const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
      if (context.config.token) headers.authorization = `Bearer ${context.config.token}`;

      const outcome = await context.http.fetch({ url: url.toString(), headers, reason: 'github search' });

      if (!outcome.ok) {
        // Rate limiting is the expected failure without a token, so it is named
        // rather than reported as a generic error.
        if (outcome.code === 'http_error' && !context.config.token) {
          throw new Error(
            `${outcome.reason} GitHub allows only 60 requests an hour without a token; add one in the source settings to raise this.`,
          );
        }
        throw new Error(`GitHub: ${outcome.reason}`);
      }

      const payload = JSON.parse(revealUntrusted(outcome.result.body)) as {
        total_count?: number;
        items?: Array<{
          id?: number;
          number?: number;
          title?: string;
          body?: string | null;
          html_url?: string;
          user?: { login?: string };
          created_at?: string;
          repository_url?: string;
          reactions?: { total_count?: number };
        }>;
      };

      const items: RawSourceItem[] = (payload.items ?? []).map((issue) => ({
        externalId: `gh:${issue.id}`,
        url: issue.html_url ?? null,
        title: issue.title ?? 'GitHub issue',
        body: markUntrusted(issue.body ?? issue.title ?? ''),
        author: issue.user?.login ?? null,
        publishedAt: issue.created_at ? new Date(issue.created_at) : null,
        raw: {
          repository: issue.repository_url?.replace('https://api.github.com/repos/', '') ?? null,
          reactions: issue.reactions?.total_count ?? 0,
        },
      }));

      return {
        items,
        cursor: String(page + 1),
        // The search API stops at a thousand results whatever the total says.
        exhausted: items.length === 0 || page * 50 >= Math.min(payload.total_count ?? 0, 1000),
      };
    },

    normalize(item: RawSourceItem): NormalizedSourceItem {
      const text = revealUntrusted(item.body);
      const repository = typeof item.raw.repository === 'string' ? item.raw.repository : null;

      return {
        externalId: item.externalId,
        url: item.url,
        title: item.title.slice(0, 300),
        bodyText: item.body,
        authorHandle: item.author,
        publishedAt: item.publishedAt,
        signalTypeKey: detectSignalType(`${item.title} ${text}`),
        evidenceClass: 'community',
        citesUrl: null,
        entityNames: [...(repository ? [repository] : []), ...detectEntities(text)],
        monetaryEvidence: detectMoney(text),
      };
    },

    async healthCheck(context) {
      const headers: Record<string, string> = { accept: 'application/vnd.github+json' };
      if (context.config.token) headers.authorization = `Bearer ${context.config.token}`;

      const outcome = await context.http.fetch({
        url: 'https://api.github.com/rate_limit',
        headers,
        reason: 'health check',
      });

      if (!outcome.ok) return { ok: false, message: outcome.reason };

      const payload = JSON.parse(revealUntrusted(outcome.result.body)) as {
        resources?: { search?: { remaining?: number; limit?: number } };
      };
      const search = payload.resources?.search;

      return {
        ok: true,
        message: context.config.token
          ? `Authenticated. ${search?.remaining ?? '?'} of ${search?.limit ?? '?'} search requests remaining.`
          : `Unauthenticated: ${search?.remaining ?? '?'} of ${search?.limit ?? '?'} search requests remaining this hour.`,
        remedy: context.config.token
          ? undefined
          : 'Add a personal access token to raise the limit from 60 to 5,000 requests an hour.',
      };
    },
  };
}
