import type { AuthDeps } from '../application/auth/types';
import type { Container } from './container';

export function authDeps(c: Container): AuthDeps {
  return {
    repos: c.repos,
    tx: c.tx,
    clock: c.clock,
    rateLimiter: c.rateLimiter,
    limits: c.limits,
    passwords: c.passwords,
    tokens: c.tokens,
    ipSalt: c.ipSalt,
    singleOwner: c.singleOwner,
  };
}
