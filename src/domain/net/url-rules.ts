import { checkAddress, ipv4ToNumber } from './ip-rules';

/**
 * What Radar will consider fetching, before any DNS lookup happens.
 *
 * This layer catches the tricks that never need a resolver: decimal and hex
 * encodings of loopback, credentials embedded in the authority, unusual
 * schemes, and ports that only ever belong to internal services. Anything that
 * survives here still has its resolved addresses checked, because a hostname
 * that looks ordinary can point anywhere.
 */

export interface UrlPolicy {
  /** http is refused by default; only an explicit allowlist may use it. */
  allowHttpHosts: string[];
  /** Ports beyond 80 and 443 that are permitted. */
  allowedPorts: number[];
  maxRedirects: number;
}

export const DEFAULT_URL_POLICY: UrlPolicy = {
  allowHttpHosts: [],
  allowedPorts: [80, 443],
  maxRedirects: 5,
};

export type UrlVerdict =
  | { allowed: true; url: URL; hostname: string }
  | { allowed: false; reason: string; code: UrlRejectionCode };

export type UrlRejectionCode =
  | 'malformed'
  | 'scheme'
  | 'credentials'
  | 'port'
  | 'literal_address'
  | 'hostname';

export function checkUrl(input: string, policy: UrlPolicy = DEFAULT_URL_POLICY): UrlVerdict {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { allowed: false, reason: 'That is not a valid URL.', code: 'malformed' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    // file:, gopher: and data: have no business here, and blob:/javascript:
    // would be actively dangerous.
    return {
      allowed: false,
      reason: `Only http and https are fetched; ${url.protocol.replace(':', '')} is not.`,
      code: 'scheme',
    };
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (url.protocol === 'http:' && !policy.allowHttpHosts.includes(hostname)) {
    return {
      allowed: false,
      reason: 'Plain http is not fetched unless the host is explicitly allowed.',
      code: 'scheme',
    };
  }

  if (url.username || url.password) {
    // Credentials in a URL are both a leak risk and a way to make an authority
    // read as one host to a person and another to a parser.
    return {
      allowed: false,
      reason: 'URLs containing credentials are refused.',
      code: 'credentials',
    };
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!policy.allowedPorts.includes(port)) {
    return {
      allowed: false,
      reason: `Port ${port} is not fetched; only ${policy.allowedPorts.join(' and ')} are.`,
      code: 'port',
    };
  }

  if (!hostname) {
    return { allowed: false, reason: 'The URL has no hostname.', code: 'hostname' };
  }

  const literal = checkLiteralAddress(hostname);
  if (literal) return literal;

  return { allowed: true, url, hostname };
}

/**
 * Rejects addresses written directly into the URL, including the encodings that
 * exist specifically to slip past a naive check: 2130706433, 0x7f000001 and
 * 0177.0.0.1 all mean 127.0.0.1.
 */
function checkLiteralAddress(hostname: string): UrlVerdict | null {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    const verdict = checkAddress(hostname, 4);
    return verdict.allowed
      ? null
      : { allowed: false, reason: verdict.reason ?? 'Blocked address.', code: 'literal_address' };
  }

  if (hostname.includes(':')) {
    const verdict = checkAddress(hostname, 6);
    return verdict.allowed
      ? null
      : { allowed: false, reason: verdict.reason ?? 'Blocked address.', code: 'literal_address' };
  }

  // A bare number is a valid IPv4 address in dotted-decimal's less common
  // relatives, and browsers and resolvers will happily accept it.
  const decimal = /^\d+$/.test(hostname) ? Number(hostname) : null;
  if (decimal !== null && decimal <= 0xffffffff) {
    const dotted = [
      (decimal >>> 24) & 0xff,
      (decimal >>> 16) & 0xff,
      (decimal >>> 8) & 0xff,
      decimal & 0xff,
    ].join('.');
    const verdict = checkAddress(dotted, 4);
    return {
      allowed: false,
      reason: verdict.allowed
        ? `${hostname} is a numeric address (${dotted}); use a hostname.`
        : (verdict.reason ?? 'Blocked address.'),
      code: 'literal_address',
    };
  }

  if (/^0x[0-9a-f]+$/i.test(hostname) || /^0\d+(\.\d+)*$/.test(hostname)) {
    return {
      allowed: false,
      reason: `${hostname} is an obfuscated numeric address.`,
      code: 'literal_address',
    };
  }

  // Mixed forms such as 127.1 or 0x7f.0.0.1 that are not plain dotted-decimal
  // but that a resolver may still accept.
  if (/^[\dx.]+$/i.test(hostname) && ipv4ToNumber(hostname) === null) {
    return {
      allowed: false,
      reason: `${hostname} looks like an address in a non-standard form.`,
      code: 'literal_address',
    };
  }

  return null;
}

/**
 * The registrable domain, used to decide whether two pieces of evidence came
 * from genuinely different parties.
 *
 * Uses a small suffix list rather than a full public-suffix database: it covers
 * the multi-part suffixes that actually appear in the sources Radar reads, and
 * the consequence of missing one is a slightly conservative independence count
 * rather than an incorrect claim.
 */
const MULTI_PART_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  'co.za', 'org.za',
  'com.br', 'com.mx', 'com.ar', 'com.sg', 'com.hk', 'com.tw', 'com.tr',
  'co.jp', 'ne.jp', 'or.jp', 'go.jp',
  'co.kr', 'or.kr',
  'co.in', 'net.in', 'org.in', 'gov.in',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'gov.us', 'k12.us',
]);

/**
 * Hosts where a subdomain belongs to a different author, so two subdomains are
 * two independent sources rather than one.
 */
const PER_SUBDOMAIN_AUTHORS = new Set([
  'substack.com',
  'medium.com',
  'wordpress.com',
  'blogspot.com',
  'github.io',
  'notion.site',
  'tumblr.com',
  'weebly.com',
  'squarespace.com',
]);

export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;

  const lastTwo = parts.slice(-2).join('.');

  // A personal Substack is not the same publisher as another personal Substack,
  // so the subdomain is kept as part of the identity.
  if (PER_SUBDOMAIN_AUTHORS.has(lastTwo)) return parts.slice(-3).join('.');

  if (MULTI_PART_SUFFIXES.has(lastTwo)) {
    const lastThree = parts.slice(-3).join('.');
    return PER_SUBDOMAIN_AUTHORS.has(lastThree) ? parts.slice(-4).join('.') : lastThree;
  }

  return lastTwo;
}
