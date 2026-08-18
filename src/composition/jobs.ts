import type { IngestDeps } from '../application/sources/ingest';
import type { InvestigationDeps } from '../pipeline/investigations/runner';
import { deterministicNonce, randomNonce } from '../pipeline/prompts/nonce';
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
      // Fixture replay needs byte-identical prompts between runs; everything
      // else gets a fresh random nonce per call.
      nonce:
        c.env.RADAR_AI_PROVIDER === 'fixture'
          ? deterministicNonce('radar-fixture')
          : randomNonce(),
    },
  };
}
