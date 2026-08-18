/**
 * The long-running worker.
 *
 * Deployments that can keep a process alive run this; deployments that cannot
 * drive the identical code through POST /api/v1/system/tick on a platform cron.
 * Neither path is a lesser version of the other -- they call the same tick.
 */
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from '../composition/load-env-file';
import { buildContainer } from '../composition/container';
import { jobDependencies } from '../composition/jobs';
import { JOB_REGISTRY } from '../jobs/handlers/index';
import { tick } from '../jobs/tick';

const IDLE_DELAY_MS = 2_000;
const BUSY_DELAY_MS = 100;

async function main(): Promise<void> {
  loadEnvFile();
  const c = buildContainer();
  const workerId = `${process.env.HOSTNAME ?? 'worker'}-${randomUUID().slice(0, 8)}`;

  let running = true;
  const stop = (signal: string): void => {
    process.stdout.write(`opportunity-radar worker: ${signal} received, finishing current job\n`);
    running = false;
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  process.stdout.write(
    `opportunity-radar worker ${workerId} started, ${JOB_REGISTRY.size} job kinds registered\n`,
  );

  while (running) {
    try {
      const result = await tick(
        {
          repos: c.repos,
          tx: c.tx,
          clock: c.clock,
          registry: JOB_REGISTRY,
          workerId,
          ...jobDependencies(c),
        },
        { maxJobs: c.env.RADAR_WORKER_CONCURRENCY * 5, budgetMs: 20_000 },
      );

      if (result.jobs.failed > 0 || result.jobs.blocked > 0) {
        process.stdout.write(
          `worker: ${result.jobs.completed} done, ${result.jobs.failed} failed, ${result.jobs.blocked} blocked\n`,
        );
      }

      // Idle politely rather than spinning; a busy queue is drained tightly.
      await sleep(result.jobs.claimed > 0 ? BUSY_DELAY_MS : IDLE_DELAY_MS);
    } catch (error) {
      // A failure in the loop itself -- typically the database being briefly
      // unreachable -- must not kill the worker; it backs off and continues.
      process.stderr.write(`worker: tick failed, retrying shortly: ${String(error)}\n`);
      await sleep(5_000);
    }
  }

  await c.db.close();
  process.stdout.write('opportunity-radar worker: stopped\n');
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error: unknown) => {
  process.stderr.write(`opportunity-radar worker failed to start: ${String(error)}\n`);
  process.exit(1);
});
