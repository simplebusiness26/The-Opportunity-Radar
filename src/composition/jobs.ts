import type { IngestDeps } from '../application/sources/ingest';
import type { AskDeps } from '../pipeline/ask/answer';
import type { InvestigationDeps } from '../pipeline/investigations/runner';
import { deterministicNonce, randomNonce, type NonceSource } from '../pipeline/prompts/nonce';
import { aiGateway } from './ai';
import type { Container } from './container';

/**
 * What a worker is handed.
 *
 * Built in one place so the long-running worker and the HTTP tick are given
 * exactly the same capabilities. A deployment that runs one rather than the
 * other should not quietly be able to do less.
 */
export interface JobDependencies {
  ingest: IngestDeps;
  investigation: InvestigationDeps;
}

export function jobDependencies(c: Container): JobDependencies {
  return {
    ingest: {
      repos: c.repos,
      tx: c.tx,
      clock: c.clock,
      http: c.http,
      adapters: c.adapters,
      secretBox: c.secretBox,
      userAgent: c.userAgent,
    },
    investigation: {
      repos: c.repos,
      tx: c.tx,
      clock: c.clock,
      gateway: aiGateway(c),
      nonce: promptNonce(c),
    },
  };
}

/**
 * Fixture replay needs byte-identical prompts between runs, because a
 * recording is keyed by the prompt's hash. Everything else gets a fresh random
 * nonce per call.
 */
export function promptNonce(c: Container): NonceSource {
  return c.env.RADAR_AI_PROVIDER === 'fixture' ? deterministicNonce('radar-fixture') : randomNonce();
}

export function askDependencies(c: Container): AskDeps {
  return { repos: c.repos, clock: c.clock, gateway: aiGateway(c), nonce: promptNonce(c) };
}
