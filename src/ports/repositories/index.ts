import type { AuditRepository, SecretRepository } from './audit';
import type { AiRepository, BudgetRepository } from './ai';
import type { SourceRepository } from './sources';
import type {
  InvestigationRepository,
  UncertaintyRepository,
  ValidationRepository,
} from './investigation';
import type { ExecutionHistoryRepository, GraphRepository } from './graph';
import type { HandoffRepository } from './execution';
import type { RelationshipRepository, TriggerRepository } from './memory';
import type {
  AlertRepository,
  BriefRepository,
  DomainEventRepository,
  JobRepository,
  RunStatsRepository,
  ScheduleRepository,
  VisitRepository,
} from './ops';
import type {
  EntityRepository,
  EvidenceRepository,
  SignalRepository,
} from './intelligence';
import type {
  ClusterRepository,
  DecisionRepository,
  OpportunityRepository,
  ScoreRepository,
} from './opportunities';
import type { SessionRepository, TenancyRepository, UserRepository } from './auth';

/**
 * The persistence surface available to use-cases. Grows one aggregate at a time
 * as the product does; a use-case can only reach what is declared here, which is
 * what keeps `src/application` free of database concerns.
 */
export interface Repositories {
  users: UserRepository;
  sessions: SessionRepository;
  tenancy: TenancyRepository;
  audit: AuditRepository;
  signals: SignalRepository;
  evidence: EvidenceRepository;
  entities: EntityRepository;
  clusters: ClusterRepository;
  opportunities: OpportunityRepository;
  scores: ScoreRepository;
  decisions: DecisionRepository;
  jobs: JobRepository;
  schedules: ScheduleRepository;
  events: DomainEventRepository;
  alerts: AlertRepository;
  briefs: BriefRepository;
  visits: VisitRepository;
  runStats: RunStatsRepository;
  graph: GraphRepository;
  ai: AiRepository;
  budgets: BudgetRepository;
  secrets: SecretRepository;
  sources: SourceRepository;
  investigations: InvestigationRepository;
  uncertainty: UncertaintyRepository;
  validation: ValidationRepository;
  executionHistory: ExecutionHistoryRepository;
  triggers: TriggerRepository;
  handoffs: HandoffRepository;
  relationships: RelationshipRepository;

  /**
   * Introduced with the AI and ingestion layers. Optional here so that code
   * which only needs a count can ask honestly whether the capability exists at
   * all, rather than a stub reporting a fabricated zero as if it were real.
   */
}

export interface CountableRepository {
  countEnabled(): Promise<number>;
}

/**
 * Runs a unit of work atomically. A use-case that must write several tables and
 * an audit row does so through this, so the log can never disagree with the data.
 */
export interface Transactor {
  transaction<T>(fn: (repos: Repositories) => Promise<T>): Promise<T>;
}

export * from './audit';
export * from './auth';
export * from './intelligence';
export * from './opportunities';

export * from './ops';

export * from './graph';

export * from './ai';

export * from './sources';

export * from './investigation';

export * from './memory';

export * from './execution';
