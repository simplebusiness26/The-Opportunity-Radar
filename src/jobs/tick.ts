import { drainQueue, type DrainResult } from './runner';
import { runScheduler, type SchedulerResult } from './scheduler';
import { projectEvents, type ProjectionResult } from './event-router';
import type { Clock } from '../ports/clock';
import type { Repositories, Transactor } from '../ports/repositories/index';
import type { JobRegistry } from './types';

export interface TickResult {
  scheduler: SchedulerResult;
  events: ProjectionResult;
  jobs: DrainResult;
  pending: number;
}

/**
 * One full pass of the machine: fire due schedules, project the outbox, then
 * drain the queue.
 *
 * The same function serves three callers -- the long-running worker's loop, the
 * HTTP endpoint a platform cron calls, and the acceptance tests. Tests drive it
 * directly until nothing is pending, which is why they need no sleeping and
 * produce the same result every run.
 */
export async function tick(
  deps: {
    repos: Repositories;
    tx: Transactor;
    clock: Clock;
    registry: JobRegistry;
    workerId: string;
    random?: () => number;
  },
  options: { maxJobs?: number; budgetMs?: number } = {},
): Promise<TickResult> {
  const scheduler = await runScheduler(deps);
  const events = await projectEvents(deps);
  const jobs = await drainQueue(deps, options);

  // Reported so a caller can loop until the machine is genuinely idle rather
  // than guessing how many passes are needed.
  const pending = await deps.repos.jobs.countRunnable(deps.clock.now());

  return { scheduler, events, jobs, pending };
}
