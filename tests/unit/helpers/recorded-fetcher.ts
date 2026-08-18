import { readFileSync } from 'node:fs';
import { markUntrusted } from '../../../src/domain/types/untrusted';
import type { FetchOutcome, FetchRequest, HttpFetcher } from '../../../src/ports/http';

/**
 * Replays recorded responses in place of the network.
 *
 * Adapter tests must not depend on a third party being up, on rate limits, or
 * on the content of a live feed today. A request with no recording fails
 * loudly naming the URL, so a test cannot quietly pass against nothing.
 */
export function createRecordedFetcher(
  routes: Array<{ match: string | RegExp; file?: string; body?: string; contentType?: string; status?: number }>,
): HttpFetcher & { requests: FetchRequest[] } {
  const requests: FetchRequest[] = [];

  return {
    requests,

    async fetch(request: FetchRequest): Promise<FetchOutcome> {
      requests.push(request);

      const route = routes.find((entry) =>
        typeof entry.match === 'string' ? request.url.includes(entry.match) : entry.match.test(request.url),
      );

      if (!route) {
        return {
          ok: false,
          reason: `No recorded response for ${request.url}. Add one to the test's route table.`,
          code: 'network',
          retryable: false,
        };
      }

      const body = route.file
        ? readFileSync(new URL(`../../../fixtures/sources/${route.file}`, import.meta.url), 'utf8')
        : (route.body ?? '');

      const status = route.status ?? 200;
      if (status >= 400) {
        return { ok: false, reason: `Returned ${status}.`, code: 'http_error', retryable: status >= 500 };
      }

      return {
        ok: true,
        result: {
          finalUrl: request.url,
          status,
          contentType: route.contentType ?? (route.file?.endsWith('.xml') ? 'application/rss+xml' : 'application/json'),
          body: markUntrusted(body),
          bytes: body.length,
          hops: [{ url: request.url, status, resolvedAddress: '93.184.216.34' }],
          fetchedAtMs: 0,
          truncated: false,
        },
      };
    },

    async isAllowedByRobots() {
      return { allowed: true, reason: 'Permitted in tests.' };
    },
  };
}
