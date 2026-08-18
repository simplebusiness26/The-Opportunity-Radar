import { markUntrusted, revealUntrusted } from '../../domain/types/untrusted';
import type {
  FetchPage,
  NormalizedSourceItem,
  RawSourceItem,
  SourceAdapter,
} from '../../ports/source-adapter';
import { detectEntities, detectMoney, detectSignalType, stripHtml } from './shared';

/**
 * Any RSS or Atom feed.
 *
 * The most useful adapter in practice, because almost everything worth watching
 * publishes one: competitor blogs, changelogs, regulator announcements, funding
 * trackers, industry press. It needs no credentials and respects robots.
 */
export function createRssAdapter(): SourceAdapter {
  return {
    manifest: {
      adapterKey: 'rss',
      name: 'RSS or Atom feed',
      category: 'trend',
      description:
        'Reads any RSS or Atom feed. Point it at competitor changelogs, regulator announcements, industry press or funding trackers.',
      evidenceClass: 'reliable_secondary',
      defaultSignalType: 'trend',
      configFields: [
        {
          key: 'feedUrl',
          label: 'Feed URL',
          secret: false,
          required: true,
          hint: 'The address of the RSS or Atom feed itself, not the site.',
          placeholder: 'https://example.com/feed.xml',
        },
        {
          key: 'evidenceClass',
          label: 'What kind of source is this',
          secret: false,
          required: false,
          hint: 'primary for an official announcement, reliable_secondary for reporting. Default reliable_secondary.',
        },
        {
          key: 'signalType',
          label: 'Default signal type',
          secret: false,
          required: false,
          hint: 'Used when the text gives no better clue. Default trend.',
        },
      ],
      termsPolicy: 'Reads a feed the publisher offers for syndication. Respects robots.txt.',
      respectsRobots: true,
      costNote: 'Free.',
    },

    validateConfig(config) {
      const url = config.feedUrl?.trim();
      if (!url) {
        return {
          ok: false,
          missing: ['feedUrl'],
          message: 'This source needs a feed address.',
          remedy: 'Paste the URL of the RSS or Atom feed.',
        };
      }
      try {
        new URL(url);
      } catch {
        return {
          ok: false,
          missing: ['feedUrl'],
          message: 'That feed address is not a valid URL.',
          remedy: 'Check the address and try again.',
        };
      }
      return { ok: true };
    },

    async fetch(context): Promise<FetchPage> {
      const feedUrl = context.config.feedUrl ?? '';

      const robots = await context.http.isAllowedByRobots(feedUrl);
      if (!robots.allowed) throw new Error(`Refused by robots.txt: ${robots.reason}`);

      const outcome = await context.http.fetch({ url: feedUrl, reason: 'feed poll' });
      if (!outcome.ok) throw new Error(`Feed: ${outcome.reason}`);

      const items = parseFeed(revealUntrusted(outcome.result.body)).slice(0, context.maxItems);

      // A feed is a complete snapshot each time; dedupe is what stops a re-read
      // counting as new evidence, so there is no cursor to keep.
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
        signalTypeKey: detectSignalType(`${item.title} ${text}`),
        evidenceClass: 'reliable_secondary',
        citesUrl: null,
        entityNames: detectEntities(`${item.title} ${text}`),
        monetaryEvidence: detectMoney(text),
      };
    },

    async healthCheck(context) {
      const feedUrl = context.config.feedUrl ?? '';
      if (!feedUrl) return { ok: false, message: 'No feed address configured.', remedy: 'Add one in the source settings.' };

      const outcome = await context.http.fetch({ url: feedUrl, reason: 'health check' });
      if (!outcome.ok) return { ok: false, message: outcome.reason };

      const items = parseFeed(revealUntrusted(outcome.result.body));
      return items.length > 0
        ? { ok: true, message: `Feed reachable, ${items.length} entries.` }
        : {
            ok: false,
            message: 'The feed was reachable but contained no entries Radar could read.',
            remedy: 'Check that the URL points at the feed rather than the web page.',
          };
    },
  };
}

/**
 * Parses RSS and Atom with regular expressions rather than an XML library.
 *
 * Feeds in the wild are frequently not well-formed, and a strict parser rejects
 * a meaningful share of them outright. The fields being extracted are simple
 * and the content is treated as untrusted regardless, so tolerance costs
 * nothing here and buys noticeably better coverage.
 */
export function parseFeed(xml: string): RawSourceItem[] {
  const items: RawSourceItem[] = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];

  for (const block of blocks) {
    const title = stripHtml(tag(block, 'title') ?? '') || 'Untitled';
    const link = attr(block, 'link', 'href') ?? tag(block, 'link') ?? tag(block, 'guid');

    const body = stripHtml(
      tag(block, 'content:encoded') ??
        tag(block, 'content') ??
        tag(block, 'description') ??
        tag(block, 'summary') ??
        '',
    );

    const published = tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated');
    const parsed = published ? new Date(published) : null;

    const guid = tag(block, 'guid') ?? tag(block, 'id') ?? link ?? title;

    items.push({
      externalId: `feed:${guid}`.slice(0, 400),
      url: link?.trim() ?? null,
      title,
      body: markUntrusted(body || title),
      author: stripHtml(tag(block, 'dc:creator') ?? tag(block, 'author') ?? '') || null,
      publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed : null,
      raw: {},
    });
  }

  return items;
}

function tag(block: string, name: string): string | null {
  const escaped = name.replace(/[:]/g, '\\:');
  const pattern = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i');
  const match = pattern.exec(block);
  if (!match?.[1]) return null;
  return match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function attr(block: string, name: string, attribute: string): string | null {
  const pattern = new RegExp(`<${name}\\b[^>]*\\b${attribute}=["']([^"']+)["']`, 'i');
  return pattern.exec(block)?.[1] ?? null;
}
