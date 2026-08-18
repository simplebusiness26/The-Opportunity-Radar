import { lookup as dnsLookup } from 'node:dns/promises';
import { Agent } from 'undici';
import { checkAddress } from '../../domain/net/ip-rules';
import { checkUrl, DEFAULT_URL_POLICY, type UrlPolicy } from '../../domain/net/url-rules';
import { isPathAllowed, parseRobots, PERMISSIVE, type RobotsPolicy } from '../../domain/net/robots';
import { consume, newBucket, type BucketState } from '../../domain/auth/rate-limit';
import { markUntrusted } from '../../domain/types/untrusted';
import type { Clock } from '../../ports/clock';
import type { FetchHop, FetchOutcome, FetchRequest, HttpFetcher } from '../../ports/http';

/**
 * The only module in Radar that reaches the network.
 *
 * Two defences matter most here, and the second is the one naive
 * implementations miss:
 *
 *   1. Every URL is checked before use, and every address it resolves to is
 *      checked against the private and metadata ranges.
 *   2. The connection is then pinned to the address that was checked. Without
 *      that, a hostile DNS server can answer the validation lookup with a
 *      public address and the connection lookup with 169.254.169.254 -- the
 *      rebinding attack that defeats validate-then-fetch entirely.
 *
 * Redirects are followed manually so every hop gets the same treatment; a
 * redirect to the metadata endpoint is a standard way past a check that only
 * looks at the first URL.
 */

export interface SafeFetcherOptions {
  clock: Clock;
  userAgent: string;
  policy?: UrlPolicy;
  /** Injected so the hostile-address suite runs without DNS. */
  resolve?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  /** Requests per host per minute. */
  perHostPerMinute?: number;
  maxBytes?: number;
  robotsCacheSeconds?: number;
}

export function createSafeFetcher(options: SafeFetcherOptions): HttpFetcher {
  const policy = options.policy ?? DEFAULT_URL_POLICY;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const perHostPerMinute = options.perHostPerMinute ?? 20;
  const robotsCacheSeconds = options.robotsCacheSeconds ?? 3600;

  const resolve =
    options.resolve ?? ((hostname: string) => dnsLookup(hostname, { all: true, verbatim: true }));

  const buckets = new Map<string, BucketState>();
  const robotsCache = new Map<string, { policy: RobotsPolicy; expiresAtMs: number }>();

  const rateLimitPolicy = { capacity: perHostPerMinute, refillPerSecond: perHostPerMinute / 60 };

  async function validated(
    rawUrl: string,
  ): Promise<
    | { ok: true; url: URL; address: string; family: 4 | 6 }
    | { ok: false; reason: string; code: 'blocked_url' | 'blocked_address' }
  > {
    const verdict = checkUrl(rawUrl, policy);
    if (!verdict.allowed) return { ok: false, reason: verdict.reason, code: 'blocked_url' };

    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = await resolve(verdict.hostname);
    } catch (error) {
      return {
        ok: false,
        reason: `Could not resolve ${verdict.hostname}: ${String(error)}`,
        code: 'blocked_address',
      };
    }

    if (addresses.length === 0) {
      return { ok: false, reason: `${verdict.hostname} resolved to no addresses.`, code: 'blocked_address' };
    }

    // Every answer is checked, not just the first: a host that returns one
    // public and one private address must be refused outright.
    for (const entry of addresses) {
      const check = checkAddress(entry.address, entry.family === 6 ? 6 : 4);
      if (!check.allowed) {
        return {
          ok: false,
          reason: `${verdict.hostname} resolves to a blocked address: ${check.reason}`,
          code: 'blocked_address',
        };
      }
    }

    const chosen = addresses[0]!;
    return {
      ok: true,
      url: verdict.url,
      address: chosen.address,
      family: chosen.family === 6 ? 6 : 4,
    };
  }

  async function fetchOnce(
    target: { url: URL; address: string; family: 4 | 6 },
    request: FetchRequest,
  ): Promise<Response> {
    /*
     * The connection is pinned to the address already validated. Undici would
     * otherwise perform its own lookup, and a hostile resolver can return a
     * different answer the second time -- which is exactly how DNS rebinding
     * gets past a validate-then-fetch implementation.
     */
    const agent = new Agent({
      connect: {
        lookup: (_hostname, _opts, callback) => {
          callback(null, [{ address: target.address, family: target.family }]);
        },
        // The original hostname is kept for SNI and certificate validation, so
        // pinning the address does not weaken TLS.
        servername: target.url.hostname,
      },
      connectTimeout: 5_000,
      headersTimeout: 15_000,
      bodyTimeout: request.timeoutMs ?? 20_000,
    });

    const method = request.method ?? 'GET';
    const headers: Record<string, string> = {
      'user-agent': options.userAgent,
      accept: 'text/html,application/xhtml+xml,application/json,application/xml,text/plain;q=0.9',
      'accept-encoding': 'gzip, deflate',
      ...request.headers,
    };

    let body: string | undefined;
    if (method === 'POST' && request.form) {
      body = new URLSearchParams(request.form).toString();
      headers['content-type'] = 'application/x-www-form-urlencoded';
    } else if (method === 'POST' && request.json !== undefined) {
      body = JSON.stringify(request.json);
      headers['content-type'] = 'application/json';
    }

    try {
      return await fetch(target.url, {
        method,
        redirect: 'manual',
        headers,
        body,
        signal: AbortSignal.timeout(request.timeoutMs ?? 20_000),
        dispatcher: agent,
      } as RequestInit);
    } finally {
      void agent.close();
    }
  }

  return {
    async isAllowedByRobots(rawUrl: string) {
      const verdict = checkUrl(rawUrl, policy);
      if (!verdict.allowed) return { allowed: false, reason: verdict.reason };

      const origin = `${verdict.url.protocol}//${verdict.url.host}`;
      const nowMs = options.clock.epochMs();
      const cached = robotsCache.get(origin);

      let robots = cached && cached.expiresAtMs > nowMs ? cached.policy : null;

      if (!robots) {
        const target = await validated(`${origin}/robots.txt`);
        if (!target.ok) {
          robots = PERMISSIVE;
        } else {
          try {
            const response = await fetchOnce(target, { url: `${origin}/robots.txt`, timeoutMs: 10_000 });
            robots =
              response.status === 200
                ? parseRobots((await response.text()).slice(0, 500_000), options.userAgent)
                : // No robots.txt means no restrictions; a server error means we
                  // do not know, and guessing permissive is the convention.
                  PERMISSIVE;
          } catch {
            robots = PERMISSIVE;
          }
        }
        robotsCache.set(origin, { policy: robots, expiresAtMs: nowMs + robotsCacheSeconds * 1000 });
      }

      const allowed = isPathAllowed(robots, verdict.url.pathname + verdict.url.search);
      return {
        allowed,
        reason: allowed
          ? robots.assumed
            ? 'No robots.txt found, so nothing is disallowed.'
            : 'Permitted by robots.txt.'
          : `robots.txt disallows ${verdict.url.pathname} for ${options.userAgent}.`,
      };
    },

    async fetch(request: FetchRequest): Promise<FetchOutcome> {
      const hops: FetchHop[] = [];
      let currentUrl = request.url;

      for (let hop = 0; hop <= policy.maxRedirects; hop += 1) {
        const target = await validated(currentUrl);
        if (!target.ok) {
          return { ok: false, reason: target.reason, code: target.code, retryable: false };
        }

        const host = target.url.hostname;
        const nowMs = options.clock.epochMs();
        const decision = consume(
          buckets.get(host) ?? newBucket(rateLimitPolicy, nowMs),
          rateLimitPolicy,
          nowMs,
        );
        buckets.set(host, decision.state);

        if (!decision.allowed) {
          return {
            ok: false,
            reason: `Too many requests to ${host}; waiting ${decision.retryAfterSeconds}s.`,
            code: 'rate_limited',
            retryable: true,
          };
        }

        let response: Response;
        try {
          response = await fetchOnce(target, request);
        } catch (error) {
          const timedOut = error instanceof Error && error.name === 'TimeoutError';
          return {
            ok: false,
            reason: timedOut ? `${host} did not respond in time.` : `Could not reach ${host}: ${String(error)}`,
            code: timedOut ? 'timeout' : 'network',
            retryable: true,
          };
        }

        hops.push({ url: target.url.toString(), status: response.status, resolvedAddress: target.address });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            return { ok: false, reason: 'Redirect without a destination.', code: 'http_error', retryable: false };
          }
          // Resolved against the current URL, then re-validated from scratch on
          // the next pass.
          currentUrl = new URL(location, target.url).toString();
          continue;
        }

        if (!response.ok) {
          return {
            ok: false,
            reason: `${host} returned ${response.status}.`,
            code: 'http_error',
            // 5xx and 429 may pass; 4xx will not.
            retryable: response.status >= 500 || response.status === 429,
          };
        }

        const contentType = response.headers.get('content-type');
        if (contentType && !isReadable(contentType)) {
          return {
            ok: false,
            reason: `${host} returned ${contentType}, which Radar does not read.`,
            code: 'unsupported_content',
            retryable: false,
          };
        }

        const read = await readCapped(response, maxBytes);
        if (read.overLimit) {
          return {
            ok: false,
            reason: `${host} returned more than ${Math.round(maxBytes / 1024)}KB.`,
            code: 'too_large',
            retryable: false,
          };
        }

        return {
          ok: true,
          result: {
            finalUrl: target.url.toString(),
            status: response.status,
            contentType,
            // Branded at the boundary: everything downstream is forced to treat
            // it as data rather than as anything it can act on.
            body: markUntrusted(read.text),
            bytes: read.bytes,
            hops,
            fetchedAtMs: options.clock.epochMs(),
            truncated: read.truncated,
          },
        };
      }

      return {
        ok: false,
        reason: `More than ${policy.maxRedirects} redirects.`,
        code: 'too_many_redirects',
        retryable: false,
      };
    },
  };
}

function isReadable(contentType: string): boolean {
  const type = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return (
    type.startsWith('text/') ||
    type === 'application/json' ||
    type === 'application/xml' ||
    type === 'application/rss+xml' ||
    type === 'application/atom+xml' ||
    type === 'application/xhtml+xml' ||
    type === 'application/ld+json'
  );
}

/**
 * Reads a response with a hard byte ceiling.
 *
 * Streamed rather than buffered so a server that advertises a small body and
 * then sends gigabytes -- or a compression bomb -- is cut off at the limit
 * instead of exhausting memory.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; bytes: number; truncated: boolean; overLimit: boolean }> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return { text: '', bytes: declared, truncated: false, overLimit: true };

  const reader = response.body?.getReader();
  if (!reader) return { text: '', bytes: 0, truncated: false, overLimit: false };

  const chunks: Uint8Array[] = [];
  let bytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {});
      return { text: '', bytes, truncated: false, overLimit: true };
    }
    chunks.push(value);
  }

  const buffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  return { text: buffer.toString('utf8'), bytes, truncated: false, overLimit: false };
}
