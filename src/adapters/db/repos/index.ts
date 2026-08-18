import type { Repositories, Transactor } from '../../../ports/repositories/index';
import type { Database } from '../client';
import type { Executor } from './_ctx';
import { createAuditRepository } from './audit';
import { createTenancyRepository } from './tenancy';
import {
  createEntityRepository,
  createEvidenceRepository,
  createSignalRepository,
} from './signals';
import {
  createClusterRepository,
  createDecisionRepository,
  createOpportunityRepository,
  createScoreRepository,
} from './opportunities';
import { createSessionRepository, createUserRepository } from './users';

/** Binds every repository to one executor: the pool, or an open transaction. */
export function createRepositories(db: Executor): Repositories {
  return {
    users: createUserRepository(db),
    sessions: createSessionRepository(db),
    tenancy: createTenancyRepository(db),
    audit: createAuditRepository(db),
    signals: createSignalRepository(db),
    evidence: createEvidenceRepository(db),
    entities: createEntityRepository(db),
    clusters: createClusterRepository(db),
    opportunities: createOpportunityRepository(db),
    scores: createScoreRepository(db),
    decisions: createDecisionRepository(db),
  };
}

export function createTransactor(db: Database): Transactor {
  return {
    transaction: (fn) => db.transaction((tx) => fn(createRepositories(tx))),
  };
}
