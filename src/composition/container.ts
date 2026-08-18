import { clockFromEnv } from '../adapters/clock/index';
import { scryptPasswordHasher } from '../adapters/crypto/password';
import { createInMemoryRateLimiter } from '../adapters/crypto/rate-limiter';
import { createSecretBox, unavailableSecretBox } from '../adapters/crypto/secret-box';
import { sha256, tokenService } from '../adapters/crypto/tokens';
import { createSafeFetcher } from '../adapters/http/safe-fetcher';
import { ADAPTER_REGISTRY } from '../adapters/sources/registry';
import { createRepositories, createTransactor } from '../adapters/db/repos/index';
import { sharedDb, type DbHandle } from '../adapters/db/client';
import type { Clock } from '../ports/clock';
import type { PasswordHasher, TokenService } from '../ports/crypto';
import type { RateLimiter } from '../ports/rate-limiter';
import { scaledLimits } from '../domain/auth/rate-limit';
import type { RateLimitName, RateLimitPolicy } from '../domain/auth/rate-limit';
import type { Repositories, Transactor } from '../ports/repositories/index';
import type { HttpFetcher } from '../ports/http';
import type { SecretBox } from '../ports/secret-box';
import type { SourceAdapter } from '../ports/source-adapter';
import { env, type Env } from './env';

/**
 * The composition root. This is the only place that reads configuration and
 * chooses concrete adapters; everything above it receives what it needs.
 */
export interface Container {
  env: Env;
  clock: Clock;
  db: DbHandle;
  repos: Repositories;
  tx: Transactor;
  rateLimiter: RateLimiter;
  limits: Record<RateLimitName, RateLimitPolicy>;
  passwords: PasswordHasher;
  tokens: TokenService;
  secretBox: SecretBox;
  http: HttpFetcher;
  adapters: Map<string, SourceAdapter>;
  userAgent: string;
  ipSalt: string;
  singleOwner: boolean;
}

/**
 * Identifies Radar to the sites it reads, with a contact address. A crawler
 * that will not say who it is deserves to be blocked.
 */
const USER_AGENT = 'OpportunityRadar/1.0 (+https://github.com/simplebusiness26/The-Opportunity-Radar)';

export function buildContainer(config: Env = env()): Container {
  const clock = clockFromEnv(config.RADAR_CLOCK);
  const db = sharedDb(config.DATABASE_URL, config.DATABASE_POOL_MAX);

  return {
    env: config,
    clock,
    db,
    repos: createRepositories(db.db),
    tx: createTransactor(db.db),
    rateLimiter: createInMemoryRateLimiter(clock),
    limits: scaledLimits(config.RADAR_RATE_LIMIT_SCALE),
    passwords: scryptPasswordHasher,
    tokens: tokenService,
    // Credential storage fails loudly when no key is configured rather than
    // silently writing secrets in the clear.
    secretBox: config.RADAR_SECRET_KEY
      ? createSecretBox(config.RADAR_SECRET_KEY)
      : unavailableSecretBox(),
    http: createSafeFetcher({ clock, userAgent: USER_AGENT }),
    adapters: ADAPTER_REGISTRY,
    userAgent: USER_AGENT,
    // Derived from the secret key so address hashes are stable for one
    // deployment and not comparable across deployments.
    ipSalt: sha256(config.RADAR_SECRET_KEY ?? config.DATABASE_URL).slice(0, 32),
    singleOwner: config.RADAR_SINGLE_OWNER,
  };
}

const globalRef = globalThis as { __radarContainer?: Container };

/** Memoised so Next's hot reload does not build a new pool on every request. */
export function container(): Container {
  globalRef.__radarContainer ??= buildContainer();
  return globalRef.__radarContainer;
}
