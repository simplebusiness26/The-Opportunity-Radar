import { backoffSeconds, decideOutcome, DEFAULT_BACKOFF } from '../domain/jobs/backoff';
import type { Clock } from '../ports/clock';
import type { Repositories, Transactor } from '../ports/repositories/index';
import type { IngestDeps } from '../application/sources/ingest';
import { JobBlocked, JobPermanentFailure, type JobContext, type JobRegistry } from './types';

export interface RunnerDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
  registry: JobRegistry;
  workerId: string;
  /** Supplied by workers that are allowed to reach the network. */
  ingest?: IngestDeps;
  /** Injected so retry timing is deterministic under test. */
  random?: () => number;
}

export interface DrainResult {
  claimed: number;
  completed: number;
  failed: number;
  blocked: number;
  reaped: number;
}

/**
 * Runs one job, if any is due.
 *
 * Returns false when the queue is empty, which is how both the worker loop and
 * the HTTP tick know to stop rather than spinning.
 */
export async function runOneJob(deps: RunnerDeps): Promise<'idle' | 'completed' | 'failed' | 'blocked'> {
  const now = deps.clock.now();
  const job = await deps.repos.jobs.claim(deps.workerId, now, {
    kinds: [...deps.registry.keys()],
  });
  if (!job) return 'idle';

  const definition = deps.registry.get(job.kind);
  if (!definition) {
    // A queued job whose handler no longer exists must not retry forever.
    await deps.repos.jobs.fail(job.id, deps.clock.now(), {
      status: 'failed',
      error: `No handler is registered for job kind "${job.kind}".`,
    });
    return 'failed';
  }

  const context: JobContext = {
    job,
    repos: deps.repos,
    tx: deps.tx,
    clock: deps.clock,
    ingest: deps.ingest,
    heartbeat: () =>
      deps.repos.jobs.heartbeat(job.id, deps.clock.now(), definition.timeoutSec ?? job.timeoutSec),
    checkpoint: (state) => deps.repos.jobs.saveCheckpoint(job.id, state),
    isCancelled: async () => {
      const current = await deps.repos.jobs.findById(job.workspaceId, job.id);
      return current?.status === 'cancelled';
    },
    log: (code, message, detail) =>
      deps.repos.jobs.recordEvent(job.id, { code, message, detail }),
  };

  try {
    const result = await definition.handler(context);
    await deps.repos.jobs.complete(job.id, deps.clock.now(), result?.detail);
    return 'completed';
  } catch (error) {
    const finishedAt = deps.clock.now();

    if (error instanceof JobBlocked) {
      // Held, not failed: the owner has not connected something yet.
      await deps.repos.jobs.fail(job.id, finishedAt, {
        status: 'blocked',
        error: `${error.message} — ${error.remedy}`,
      });
      return 'blocked';
    }

    const outcome = decideOutcome({
      attempts: job.attempts,
      maxAttempts: definition.maxAttempts ?? job.maxAttempts,
      retryable: !(error instanceof JobPermanentFailure),
      blocked: false,
    });

    await deps.repos.jobs.fail(job.id, finishedAt, {
      status: outcome.status,
      error: error instanceof Error ? error.message : String(error),
      retryAt: outcome.shouldRetry
        ? new Date(
            finishedAt.getTime() +
              backoffSeconds(job.attempts, DEFAULT_BACKOFF, deps.random ?? Math.random) * 1000,
          )
        : undefined,
    });

    return 'failed';
  }
}

/**
 * Drains the queue until it is empty, a limit is reached, or the time budget is
 * spent. The budget is what lets the same code serve a long-running worker and
 * a serverless cron invocation that must return promptly.
 */
export async function drainQueue(
  deps: RunnerDeps,
  options: { maxJobs?: number; budgetMs?: number } = {},
): Promise<DrainResult> {
  const maxJobs = options.maxJobs ?? 50;
  const budgetMs = options.budgetMs ?? 25_000;
  const startedAt = deps.clock.epochMs();

  const reaped = await deps.repos.jobs.reapExpired(deps.clock.now(), (attempt) =>
    backoffSeconds(attempt, DEFAULT_BACKOFF, deps.random ?? Math.random),
  );

  const result: DrainResult = { claimed: 0, completed: 0, failed: 0, blocked: 0, reaped };

  while (result.claimed < maxJobs) {
    // The clock is injected, so a controllable clock in a test does not advance
    // and the budget check never trips spuriously.
    if (deps.clock.epochMs() - startedAt > budgetMs) break;

    const outcome = await runOneJob(deps);
    if (outcome === 'idle') break;

    result.claimed += 1;
    if (outcome === 'completed') result.completed += 1;
    if (outcome === 'failed') result.failed += 1;
    if (outcome === 'blocked') result.blocked += 1;
  }

  return result;
}
