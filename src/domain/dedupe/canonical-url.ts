/**
 * URL canonicalisation for duplicate detection.
 *
 * The same article reached through a newsletter, a share link and a search
 * result must resolve to one identity, or forty reposts of one story would look
 * like forty independent observations.
 */

const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^dclid$/i,
  /^msclkid$/i,
  /^mc_(cid|eid)$/i,
  /^igshid$/i,
  /^ref$/i,
  /^referrer$/i,
  /^source$/i,
  /^campaign$/i,
  /^_hs(enc|mi)$/i,
  /^yclid$/i,
  /^si$/i,
];

/** Hosts where a query parameter is the identity of the content, not tracking. */
const SIGNIFICANT_PARAMS: Record<string, readonly string[]> = {
  'youtube.com': ['v', 't'],
  'news.ycombinator.com': ['id'],
  'reddit.com': [],
  'github.com': [],
  'stackoverflow.com': [],
};

export function canonicaliseUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  // Scheme is normalised because http and https serve the same document.
  url.protocol = 'https:';
  url.hash = '';
  url.username = '';
  url.password = '';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  if ((url.port === '80' || url.port === '443')) url.port = '';

  const registrable = registrableDomain(url.hostname);
  const significant = SIGNIFICANT_PARAMS[registrable];

  const params = [...url.searchParams.entries()]
    .filter(([key]) => {
      if (significant) return significant.includes(key);
      return !TRACKING_PARAMS.some((pattern) => pattern.test(key));
    })
    // Ordering must not create two identities for one document.
    .sort(([a], [b]) => a.localeCompare(b));

  url.search = '';
  for (const [key, value] of params) url.searchParams.append(key, value);

  // A trailing slash is not a different page, except at the root.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  url.pathname = url.pathname.replace(/\/{2,}/g, '/');

  return url.toString();
}

/**
 * A small public-suffix list covering the multi-part suffixes that actually
 * appear in the sources Radar reads. The bundled full list is deliberately not
 * pulled in: this stays auditable and has no network or update dependency.
 */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'com.br', 'net.br', 'org.br', 'gov.br',
  'co.za', 'org.za', 'gov.za',
  'com.sg', 'com.hk', 'com.tw', 'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'co.in', 'net.in', 'org.in', 'gov.in',
  'com.mx', 'com.ar', 'com.tr', 'com.pl', 'com.ua',
  'co.il', 'co.kr', 'or.kr',
]);

/**
 * Hosts where each subdomain is a different author, so they must not collapse
 * into one apparent source. Two Substack newsletters are two sources.
 */
const PER_SUBDOMAIN_HOSTS = new Set([
  'substack.com',
  'medium.com',
  'wordpress.com',
  'blogspot.com',
  'github.io',
  'netlify.app',
  'vercel.app',
  'notion.site',
  'tumblr.com',
]);

export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;

  const lastTwo = parts.slice(-2).join('.');
  const lastThree = parts.slice(-3).join('.');

  if (PER_SUBDOMAIN_HOSTS.has(lastTwo)) {
    return parts.slice(-3).join('.');
  }

  if (MULTI_PART_SUFFIXES.has(lastTwo)) {
    return parts.length >= 3 ? lastThree : host;
  }

  return lastTwo;
}

/**
 * The identity used for counting independent sources. Derived from the upstream
 * origin when a piece is syndicated, so a wire story republished by fifty
 * outlets still counts once.
 */
export function originKey(canonicalUrl: string | null, upstreamUrl?: string | null): string | null {
  const target = upstreamUrl ?? canonicalUrl;
  if (!target) return null;
  try {
    return registrableDomain(new URL(target).hostname);
  } catch {
    return null;
  }
}
