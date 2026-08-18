import type { Clock } from '../../ports/clock';
import type { RateLimiter } from '../../ports/rate-limiter';
import type { BucketState, RateLimitPolicy } from '../../domain/auth/rate-limit';
import { consume, newBucket } from '../../domain/auth/rate-limit';

/**
 * Process-local rate limiting, which is the right scope for a single-node
 * deployment. A multi-node deployment swaps in a shared-store implementation
 * behind the same port; nothing above this line changes.
 */
export function createInMemoryRateLimiter(clock: Clock, maxKeys = 50_000): RateLimiter {
  const buckets = new Map<string, BucketState>();

  const evictIfNeeded = (): void => {
    if (buckets.size <= maxKeys) return;
    // Oldest-touched first: Map preserves insertion order and entries are
    // re-inserted on use, so the head is the least recently seen.
    const excess = buckets.size - maxKeys;
    let removed = 0;
    for (const key of buckets.keys()) {
      buckets.delete(key);
      if (++removed >= excess) break;
    }
  };

  return {
    async check(key: string, policy: RateLimitPolicy) {
      const nowMs = clock.epochMs();
      const state = buckets.get(key) ?? newBucket(policy, nowMs);
      const decision = consume(state, policy, nowMs);
      buckets.delete(key);
      buckets.set(key, decision.state);
      evictIfNeeded();
      return { allowed: decision.allowed, retryAfterSeconds: decision.retryAfterSeconds };
    },

    async reset(key: string) {
      buckets.delete(key);
    },
  };
}
