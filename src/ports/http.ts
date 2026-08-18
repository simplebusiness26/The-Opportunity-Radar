import type { Untrusted } from '../domain/types/untrusted';

export interface FetchRequest {
  url: string;
  /**
   * POST exists for authentication endpoints that require it. It goes through
   * exactly the same URL, address and pinning checks as a read: the method
   * changes nothing about what Radar is willing to connect to.
   */
  method?: 'GET' | 'POST';
  /** Form-encoded body, for token endpoints. Only used with POST. */
  form?: Record<string, string>;
  headers?: Record<string, string>;
  /** Purpose, recorded against the fetch for provenance. */
  reason?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface FetchHop {
  url: string;
  status: number;
  resolvedAddress: string | null;
}

export interface FetchResult {
  finalUrl: string;
  status: number;
  contentType: string | null;
  /** Always untrusted: it came from outside, whatever it looks like. */
  body: Untrusted<string>;
  bytes: number;
  hops: FetchHop[];
  fetchedAtMs: number;
  truncated: boolean;
}

export type FetchOutcome =
  | { ok: true; result: FetchResult }
  | { ok: false; reason: string; code: FetchFailureCode; retryable: boolean };

export type FetchFailureCode =
  | 'blocked_url'
  | 'blocked_address'
  | 'blocked_by_robots'
  | 'rate_limited'
  | 'too_many_redirects'
  | 'too_large'
  | 'unsupported_content'
  | 'timeout'
  | 'network'
  | 'http_error';

/**
 * The only way anything in Radar reaches the network.
 *
 * Confined to a single implementation so the SSRF and rate-limit rules cannot
 * be bypassed by a new adapter that reaches for fetch directly. Enforced by the
 * dependency rules and by a test that greps the source.
 */
export interface HttpFetcher {
  fetch(request: FetchRequest): Promise<FetchOutcome>;
  /** Whether robots.txt permits this URL for our user agent. */
  isAllowedByRobots(url: string): Promise<{ allowed: boolean; reason: string }>;
}
