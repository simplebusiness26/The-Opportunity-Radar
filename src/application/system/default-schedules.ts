import type { Repositories } from '../../ports/repositories/index';

/**
 * What a workspace does on its own, once it has anything to do it with.
 *
 * These are installed at sign-up so the machine is running from the first day,
 * but every one of them is harmless on an empty workspace: with no sources and
 * no AI, the scans find nothing and the brief says nothing changed. Nothing here
 * pretends to work that is not connected.
 *
 * Times are spread rather than all landing on the hour, so a single-node
 * deployment is not asked to do everything at once.
 */
export const DEFAULT_SCHEDULES = [
  {
    key: 'events.project',
    cron: '*/5 * * * *',
    jobKind: 'events.project',
    description: 'Drains the domain event outbox so changes propagate.',
  },
  {
    key: 'jobs.reap',
    cron: '*/10 * * * *',
    jobKind: 'jobs.reap',
    description: 'Reclaims work whose worker stopped reporting.',
  },
  {
    key: 'cluster.assign',
    cron: '17 * * * *',
    jobKind: 'cluster.assign',
    description: 'Groups loose evidence into the problems it belongs to.',
  },
  {
    key: 'evidence.refresh_decay',
    cron: '40 3 * * *',
    jobKind: 'evidence.refresh_decay',
    description: 'Ages stored evidence and flags what has gone stale.',
  },
  {
    key: 'brief.generate',
    cron: '0 6 * * *',
    jobKind: 'brief.generate',
    description: 'Writes the daily brief.',
  },
  {
    key: 'alerts.evaluate',
    cron: '25 * * * *',
    jobKind: 'alerts.evaluate',
    description: 'Raises alerts for changes that warrant attention.',
  },
  {
    key: 'sessions.purge',
    cron: '10 4 * * *',
    jobKind: 'sessions.purge',
    description: 'Deletes expired and revoked sessions.',
  },
] as const;

/** Installs the default schedules. Safe to run repeatedly. */
export async function installDefaultSchedules(
  repos: Repositories,
  workspaceId: string,
): Promise<number> {
  for (const schedule of DEFAULT_SCHEDULES) {
    await repos.schedules.upsert(workspaceId, {
      key: schedule.key,
      cron: schedule.cron,
      jobKind: schedule.jobKind,
      enabled: true,
    });
  }
  return DEFAULT_SCHEDULES.length;
}
