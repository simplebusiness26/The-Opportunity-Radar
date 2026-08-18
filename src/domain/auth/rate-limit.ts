/**
 * A pure token-bucket. Keeping it free of storage and time means the limits can
 * be exhaustively tested, and the same implementation serves in-memory limiting
 * for a single node and database-backed limiting for a cluster.
 */

export interface BucketState {
  tokens: number;
  lastRefillMs: number;
}

export interface RateLimitPolicy {
  /** Bucket capacity: the largest burst allowed. */
  capacity: number;
  /** Tokens replenished per second. */
  refillPerSecond: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  state: BucketState;
  /** Seconds until one token is available. Zero when allowed. */
  retryAfterSeconds: number;
}

export function newBucket(policy: RateLimitPolicy, nowMs: number): BucketState {
  return { tokens: policy.capacity, lastRefillMs: nowMs };
}

export function consume(
  state: BucketState,
  policy: RateLimitPolicy,
  nowMs: number,
  cost = 1,
): RateLimitDecision {
  const elapsedSeconds = Math.max(0, (nowMs - state.lastRefillMs) / 1000);
  const tokens = Math.min(policy.capacity, state.tokens + elapsedSeconds * policy.refillPerSecond);

  if (tokens >= cost) {
    return {
      allowed: true,
      state: { tokens: tokens - cost, lastRefillMs: nowMs },
      retryAfterSeconds: 0,
    };
  }

  const deficit = cost - tokens;
  return {
    allowed: false,
    state: { tokens, lastRefillMs: nowMs },
    retryAfterSeconds: Math.ceil(deficit / policy.refillPerSecond),
  };
}

/**
 * Sign-in is deliberately strict: brute force is the realistic attack against a
 * self-hosted product with one owner account.
 */
export const RATE_LIMITS = {
  signIn: { capacity: 5, refillPerSecond: 5 / 300 },
  signUp: { capacity: 3, refillPerSecond: 3 / 3600 },
  api: { capacity: 120, refillPerSecond: 2 },
  mutation: { capacity: 40, refillPerSecond: 1 },
  expensive: { capacity: 6, refillPerSecond: 6 / 600 },
} as const satisfies Record<string, RateLimitPolicy>;

export type RateLimitName = keyof typeof RATE_LIMITS;

/**
 * Scales every limit for a deployment. Raise it when many legitimate users share
 * one apparent address (a corporate NAT, a proxy Radar is not configured to
 * trust) or when running a load test. Values below 1 tighten the limits.
 */
export function scalePolicy(policy: RateLimitPolicy, scale: number): RateLimitPolicy {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    capacity: Math.max(1, Math.round(policy.capacity * factor)),
    refillPerSecond: policy.refillPerSecond * factor,
  };
}

export function scaledLimits(scale: number): Record<RateLimitName, RateLimitPolicy> {
  return {
    signIn: scalePolicy(RATE_LIMITS.signIn, scale),
    signUp: scalePolicy(RATE_LIMITS.signUp, scale),
    api: scalePolicy(RATE_LIMITS.api, scale),
    mutation: scalePolicy(RATE_LIMITS.mutation, scale),
    expensive: scalePolicy(RATE_LIMITS.expensive, scale),
  };
}
