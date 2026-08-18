import type { AuditRepository } from './audit';
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

  /**
   * Introduced with the AI and ingestion layers. Optional here so that code
   * which only needs a count can ask honestly whether the capability exists at
   * all, rather than a stub reporting a fabricated zero as if it were real.
   */
  aiProviders?: CountableRepository;
  sources?: CountableRepository;
  schedules?: CountableRepository;
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
