import { describe, expect, it } from 'vitest';
import { RATE_LIMITS, consume, newBucket } from '../../src/domain/auth/rate-limit';

const policy = { capacity: 3, refillPerSecond: 1 };

describe('token bucket', () => {
  it('allows a burst up to capacity then refuses', () => {
    let state = newBucket(policy, 0);
    for (let i = 0; i < 3; i += 1) {
      const decision = consume(state, policy, 0);
      expect(decision.allowed).toBe(true);
      state = decision.state;
    }
    expect(consume(state, policy, 0).allowed).toBe(false);
  });

  it('reports how long the caller must actually wait', () => {
    let state = newBucket(policy, 0);
    for (let i = 0; i < 3; i += 1) state = consume(state, policy, 0).state;

    const refused = consume(state, policy, 0);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(1);

    // After exactly that wait, the caller is allowed through.
    expect(consume(refused.state, policy, refused.retryAfterSeconds * 1000).allowed).toBe(true);
  });

  it('refills over time without ever exceeding capacity', () => {
    let state = newBucket(policy, 0);
    for (let i = 0; i < 3; i += 1) state = consume(state, policy, 0).state;

    // An hour of quiet must not bank an hour's worth of requests.
    const afterIdle = consume(state, policy, 3_600_000);
    expect(afterIdle.state.tokens).toBeLessThanOrEqual(policy.capacity);
    expect(afterIdle.allowed).toBe(true);
  });

  it('never grants tokens for time running backwards', () => {
    const state = { tokens: 0, lastRefillMs: 10_000 };
    const decision = consume(state, policy, 0);
    expect(decision.allowed).toBe(false);
    expect(decision.state.tokens).toBe(0);
  });
});

describe('configured limits', () => {
  it('keeps sign-in tight enough to make password guessing impractical', () => {
    const perHour = RATE_LIMITS.signIn.refillPerSecond * 3600;
    expect(RATE_LIMITS.signIn.capacity).toBeLessThanOrEqual(5);
    expect(perHour).toBeLessThanOrEqual(60);
  });

  it('leaves ordinary reads comfortably usable', () => {
    expect(RATE_LIMITS.api.capacity).toBeGreaterThanOrEqual(60);
  });
});

describe('deployment scaling', () => {
  it('raises capacity and refill together, so the shape of the limit is preserved', async () => {
    const { scalePolicy } = await import('../../src/domain/auth/rate-limit');
    const scaled = scalePolicy({ capacity: 5, refillPerSecond: 0.5 }, 10);
    expect(scaled.capacity).toBe(50);
    expect(scaled.refillPerSecond).toBe(5);
  });

  it('never scales a limit out of existence', async () => {
    const { scalePolicy } = await import('../../src/domain/auth/rate-limit');
    const scaled = scalePolicy({ capacity: 5, refillPerSecond: 0.5 }, 0.001);
    expect(scaled.capacity).toBeGreaterThanOrEqual(1);
  });

  it('ignores a nonsensical scale rather than disabling limiting', async () => {
    const { scalePolicy } = await import('../../src/domain/auth/rate-limit');
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const scaled = scalePolicy({ capacity: 5, refillPerSecond: 0.5 }, bad);
      expect(scaled.capacity).toBe(5);
      expect(scaled.refillPerSecond).toBe(0.5);
    }
  });
});
