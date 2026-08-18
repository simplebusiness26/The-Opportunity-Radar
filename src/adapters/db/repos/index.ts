import type { Repositories, Transactor } from '../../../ports/repositories/index';
import type { Database } from '../client';
import type { Executor } from './_ctx';
import { createAuditRepository, createSecretRepository } from './audit';
import { createAiRepository, createBudgetRepository } from './ai';
import { createSourceRepository } from './sources';
import {
  createInvestigationRepository,
  createUncertaintyRepository,
  createValidationRepository,
} from './investigation';
import { createExecutionHistoryRepository, createGraphRepository } from './graph';
import { createRelationshipRepository, createTriggerRepository } from './memory';
import {
  createAlertRepository,
  createBriefRepository,
  createDomainEventRepository,
  createJobRepository,
  createRunStatsRepository,
  createScheduleRepository,
  createVisitRepository,
} from './ops';
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
    triggers: createTriggerRepository(db),
    relationships: createRelationshipRepository(db),
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
    jobs: createJobRepository(db),
    schedules: createScheduleRepository(db),
    events: createDomainEventRepository(db),
    alerts: createAlertRepository(db),
    briefs: createBriefRepository(db),
    visits: createVisitRepository(db),
    runStats: createRunStatsRepository(db),
    graph: createGraphRepository(db),
    ai: createAiRepository(db),
    budgets: createBudgetRepository(db),
    secrets: createSecretRepository(db),
    sources: createSourceRepository(db),
    investigations: createInvestigationRepository(db),
    uncertainty: createUncertaintyRepository(db),
    validation: createValidationRepository(db),
    executionHistory: createExecutionHistoryRepository(db),
  };
}

export function createTransactor(db: Database): Transactor {
  return {
    transaction: (fn) => db.transaction((tx) => fn(createRepositories(tx))),
  };
}
