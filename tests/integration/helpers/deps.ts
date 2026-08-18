import { createInMemoryRateLimiter } from '../../../src/adapters/crypto/rate-limiter';
import { scaledLimits } from '../../../src/domain/auth/rate-limit';
import { tokenService } from '../../../src/adapters/crypto/tokens';
import { createRepositories, createTransactor } from '../../../src/adapters/db/repos/index';
import { controllableClock } from '../../../src/adapters/clock/index';
import type { AuthDeps } from '../../../src/application/auth/types';
import type { PasswordHasher } from '../../../src/ports/crypto';
import { testDb } from './db';

/**
 * A deliberately cheap hasher for tests. Real scrypt is exercised by its own
 * unit suite; paying for it on every fixture user would make the integration
 * suite slow enough that people stop running it.
 */
export const fakeHasher: PasswordHasher = {
  hash: async (password) => ({ hash: `fake:${password}`, salt: 'salt', algo: 'fake-v1' }),
  verify: async (password, record) => record.hash === `fake:${password}`,
  needsRehash: (algo) => algo !== 'fake-v1',
  dummyVerify: async () => {},
};

export function buildAuthDeps(
  overrides: Partial<AuthDeps> & { now?: Date } = {},
): AuthDeps & { clock: ReturnType<typeof controllableClock> } {
  const clock = controllableClock(overrides.now ?? new Date('2026-08-18T00:00:00Z'));
  const { db } = testDb();
  return {
    repos: createRepositories(db),
    tx: createTransactor(db),
    clock,
    rateLimiter: createInMemoryRateLimiter(clock),
    limits: scaledLimits(1),
    passwords: fakeHasher,
    tokens: tokenService,
    ipSalt: 'test-salt',
    singleOwner: false,
    ...overrides,
    // The controllable clock must survive an override of unrelated fields.
    ...(overrides.clock ? {} : {}),
  } as AuthDeps & { clock: ReturnType<typeof controllableClock> };
}
