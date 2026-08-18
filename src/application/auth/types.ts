import type { Clock } from '../../ports/clock';
import type { PasswordHasher, TokenService } from '../../ports/crypto';
import type { RateLimiter } from '../../ports/rate-limiter';
import type { RateLimitName, RateLimitPolicy } from '../../domain/auth/rate-limit';
import type { Repositories, Transactor } from '../../ports/repositories/index';

/**
 * Dependencies arrive from the composition root rather than being imported, so
 * every use-case can be exercised with fakes and none of them reaches for a
 * global. Nothing here names a database.
 */
export interface AuthDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
  rateLimiter: RateLimiter;
  limits: Record<RateLimitName, RateLimitPolicy>;
  passwords: PasswordHasher;
  tokens: TokenService;
  /** Salt for hashing client addresses before they are stored. */
  ipSalt: string;
  /** When true, only the very first account may be created. */
  singleOwner: boolean;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface SessionIssue {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sliding window: a session in active use is extended rather than expiring. */
export const SESSION_REFRESH_AFTER_MS = 24 * 60 * 60 * 1000;
