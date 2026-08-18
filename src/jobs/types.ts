import type { Clock } from '../ports/clock';
import type { Repositories, Transactor } from '../ports/repositories/index';
import type { JobRow } from '../ports/repositories/ops';

/**
 * What a handler is given, and what it may do.
 *
 * A handler receives a checkpoint helper rather than being trusted to remember
 * where it was, and a heartbeat rather than an unbounded time budget, so long
 * work stays resumable and observable without each handler reinventing either.
 */
export interface JobContext {
  job: JobRow;
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
  /** Extends the lease. Long handlers must call this or the reaper reclaims them. */
  heartbeat(): Promise<void>;
  /** Persists partial progress. Survives a crash; the retry resumes from it. */
  checkpoint(state: Record<string, unknown>): Promise<void>;
  /** True once cancellation has been requested; honour it at a safe boundary. */
  isCancelled(): Promise<boolean>;
  log(code: string, message?: string, detail?: Record<string, unknown>): Promise<void>;
}

export interface JobResult {
  /** Free-form summary recorded against the job for the machine view. */
  detail?: Record<string, unknown>;
}

/**
 * A precondition the owner has not supplied is not an error.
 *
 * Throwing this holds the job rather than failing it, so work waiting on an AI
 * provider or a source credential resumes when that arrives instead of burning
 * its retries and disappearing into a failed list.
 */
export class JobBlocked extends Error {
  readonly remedy: string;
  constructor(message: string, remedy: string) {
    super(message);
    this.name = 'JobBlocked';
    this.remedy = remedy;
  }
}

/** A failure that will never succeed on retry. Fails immediately. */
export class JobPermanentFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JobPermanentFailure';
  }
}

export type JobHandler = (context: JobContext) => Promise<JobResult | void>;

export interface JobDefinition {
  kind: string;
  handler: JobHandler;
  /** Seconds before the lease expires and the job is reclaimed. */
  timeoutSec?: number;
  maxAttempts?: number;
  /** What this job needs to run at all, for the machine view to explain itself. */
  requires?: 'none' | 'ai' | 'sources';
  description: string;
}

export type JobRegistry = Map<string, JobDefinition>;

export function defineJobs(definitions: JobDefinition[]): JobRegistry {
  const registry: JobRegistry = new Map();
  for (const definition of definitions) {
    if (registry.has(definition.kind)) {
      throw new Error(`Duplicate job kind: ${definition.kind}`);
    }
    registry.set(definition.kind, definition);
  }
  return registry;
}
