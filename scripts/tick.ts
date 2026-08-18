/**
 * One pass of the machine, from the command line.
 *
 * For deployments driven by cron or a systemd timer rather than a long-running
 * worker or an HTTP scheduler. It calls exactly the same `tick()` as both, so
 * there is no third code path to keep working.
 */
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from '../src/composition/load-env-file';
import { buildContainer } from '../src/composition/container';
import { jobDependencies } from '../src/composition/jobs';
import { JOB_REGISTRY } from '../src/jobs/handlers/index';
import { tick } from '../src/jobs/tick';

async function main(): Promise<void> {
  loadEnvFile();
  const c = buildContainer();

  const result = await tick(
    {
      repos: c.repos,
      tx: c.tx,
      clock: c.clock,
      registry: JOB_REGISTRY,
      workerId: `tick-${randomUUID().slice(0, 8)}`,
      ...jobDependencies(c),
    },
    { maxJobs: 100, budgetMs: 60_000 },
  );

  process.stdout.write(
    `${JSON.stringify({
      scheduled: result.scheduler.enqueued,
      events: result.events.processed,
      completed: result.jobs.completed,
      failed: result.jobs.failed,
      blocked: result.jobs.blocked,
      pending: result.pending,
    })}\n`,
  );

  await c.db.close();

  // A non-zero exit when work failed, so a cron wrapper can alert on it.
  process.exit(result.jobs.failed > 0 ? 1 : 0);
}

await main();
