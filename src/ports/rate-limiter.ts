import type { RateLimitPolicy } from '../domain/auth/rate-limit';

export interface RateLimiter {
  /** Consumes one token for `key`. Never throws; a broken limiter fails open
   *  for reads and is reported through machine status rather than blocking use. */
  check(key: string, policy: RateLimitPolicy): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  reset(key: string): Promise<void>;
}
