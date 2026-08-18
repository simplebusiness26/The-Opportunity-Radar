import { CronExpressionParser } from 'cron-parser';
import { scheduleDedupeKey } from '../domain/jobs/schedule';
import type { Clock } from '../ports/clock';
import type { Repositories } from '../ports/repositories/index';

export interface SchedulerResult {
  due: number;
  enqueued: number;
  /** Runs already claimed by another worker or a previous tick. */
  alreadyQueued: number;
}

/**
 * Turns due schedules into work.
 *
 * There is no "have I fired this yet" bookkeeping. Each due time produces a
 * stable dedupe key, and the queue's uniqueness constraint on pending work
 * makes the result exactly-once per bucket even with several workers, a
 * duplicated tick, or a clock that jumps.
 */
export async function runScheduler(deps: {
  repos: Repositories;
  clock: Clock;
}): Promise<SchedulerResult> {
  const now = deps.clock.now();
  const due = await deps.repos.schedules.listDue(now);

  let enqueued = 0;
  let alreadyQueued = 0;

  for (const schedule of due) {
    const dueAt = schedule.nextDueAt ?? now;

    const job = await deps.repos.jobs.enqueue(schedule.workspaceId, {
      kind: schedule.jobKind,
      payload: { ...schedule.payload, scheduleKey: schedule.key, dueAt: dueAt.toISOString() },
      dedupeKey: scheduleDedupeKey(schedule.key, dueAt),
      runAt: now,
    });

    if (job) enqueued += 1;
    else alreadyQueued += 1;

    await deps.repos.schedules.markFired(schedule.id, now, nextDue(schedule.cron, now, schedule.timezone));
  }

  return { due: due.length, enqueued, alreadyQueued };
}

/**
 * The next firing after `from`. An unparseable expression disables the schedule
 * by returning null rather than throwing and stopping every other schedule.
 */
export function nextDue(cron: string, from: Date, timezone = 'UTC'): Date | null {
  try {
    return CronExpressionParser.parse(cron, { currentDate: from, tz: timezone }).next().toDate();
  } catch {
    return null;
  }
}

export function isValidCron(cron: string): boolean {
  try {
    CronExpressionParser.parse(cron);
    return true;
  } catch {
    return false;
  }
}
