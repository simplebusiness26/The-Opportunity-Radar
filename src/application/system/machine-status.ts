import { deriveMode, type ModeStatus } from '../../domain/config/mode';
import type { ActorCtx } from '../../domain/types/identity';
import type { Clock } from '../../ports/clock';
import type { Repositories } from '../../ports/repositories/index';
import type { JobRow, ScheduleRow } from '../../ports/repositories/ops';
import type { JobStatus } from '../../domain/jobs/backoff';

export interface MachineStatus {
  mode: ModeStatus;
  jobs: {
    counts: Record<JobStatus, number>;
    recent: JobRow[];
    /** Work held because the owner has not connected something. */
    blocked: JobRow[];
    oldestRunnableAgeSeconds: number | null;
  };
  schedules: Array<ScheduleRow & { valid: boolean }>;
  events: { unprocessed: number };
  alerts: { unacknowledged: number };
  throughput: Array<{ kind: string; itemsSeen: number; itemsRetained: number; duplicatesDropped: number; runs: number }>;
  /** What is stopping the next operating mode, in plain words. */
  missing: string[];
  lastBriefAt: Date | null;
}

/**
 * Everything the machine view shows.
 *
 * The point of this screen is that the system is never mysterious: what ran,
 * what failed, what is waiting and why, and exactly which preconditions are
 * unmet. Nothing here is estimated or rounded up -- a count of zero is shown as
 * zero rather than hidden.
 */
export async function readMachineStatus(
  deps: { repos: Repositories; clock: Clock },
  ctx: ActorCtx,
): Promise<MachineStatus> {
  const now = deps.clock.now();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [counts, recent, blocked, schedules, unprocessed, unacknowledged, throughput, brief] =
    await Promise.all([
      deps.repos.jobs.counts(ctx.workspaceId),
      deps.repos.jobs.list(ctx.workspaceId, { limit: 25 }),
      deps.repos.jobs.list(ctx.workspaceId, { status: ['blocked'], limit: 25 }),
      deps.repos.schedules.listAll(ctx.workspaceId),
      deps.repos.events.countUnprocessed(ctx.workspaceId),
      deps.repos.alerts.countUnacknowledged(ctx.workspaceId),
      deps.repos.runStats.summary(ctx.workspaceId, dayAgo),
      deps.repos.briefs.latest(ctx.workspaceId),
    ]);

  const enabledProviders = deps.repos.aiProviders ? await deps.repos.aiProviders.countEnabled() : 0;
  const enabledSources = deps.repos.sources ? await deps.repos.sources.countEnabled() : 0;
  const enabledSchedules = schedules.filter((schedule) => schedule.enabled).length;

  const mode = deriveMode({ enabledProviders, enabledSources, enabledSchedules });

  const runnable = recent
    .filter((job) => job.status === 'queued' || job.status === 'retrying')
    .map((job) => job.runAt.getTime())
    .filter((runAt) => runAt <= now.getTime());

  return {
    mode,
    jobs: {
      counts,
      recent,
      blocked,
      // A queue backing up is the earliest visible sign that the worker has
      // stopped, so the age of the oldest runnable job is reported directly.
      oldestRunnableAgeSeconds: runnable.length
        ? Math.round((now.getTime() - Math.min(...runnable)) / 1000)
        : null,
    },
    schedules: schedules.map((schedule) => ({ ...schedule, valid: schedule.nextDueAt !== null || schedule.lastFiredAt === null })),
    events: { unprocessed },
    alerts: { unacknowledged },
    throughput,
    missing: mode.missingForNext,
    lastBriefAt: brief?.generatedAt ?? null,
  };
}
