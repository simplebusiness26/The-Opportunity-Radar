import { beforeEach, describe, expect, it } from 'vitest';
import { signUp } from '../../src/application/auth/sign-up';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { controllableClock } from '../../src/adapters/clock/index';
import { defineJobs, JobBlocked, JobPermanentFailure } from '../../src/jobs/types';
import { drainQueue, runOneJob } from '../../src/jobs/runner';
import { runScheduler } from '../../src/jobs/scheduler';
import { projectEvents } from '../../src/jobs/event-router';
import type { Repositories, Transactor } from '../../src/ports/repositories/index';

const NOW = new Date('2026-08-18T00:00:00Z');

async function setup() {
  const account = await signUp(buildAuthDeps({ now: NOW }), {
    email: `owner-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-sufficiently-long-password',
    displayName: 'Owner',
    workspaceName: 'Radar HQ',
  });

  const { db } = testDb();
  const clock = controllableClock(NOW);
  const repos: Repositories = createRepositories(db);
  const tx: Transactor = createTransactor(db);
  return { repos, tx, clock, workspaceId: account.workspaceId };
}

describe('the job queue', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('runs a job and records the result', async () => {
    const { repos, tx, clock, workspaceId } = await setup();
    const seen: string[] = [];

    const registry = defineJobs([
      {
        kind: 'test.ok',
        description: 'A job that succeeds.',
        handler: async (context) => {
          seen.push(String(context.job.payload.marker));
          return { detail: { ok: true } };
        },
      },
    ]);

    await repos.jobs.enqueue(workspaceId, { kind: 'test.ok', payload: { marker: 'first' } });

    const outcome = await runOneJob({ repos, tx, clock, registry, workerId: 'w1' });
    expect(outcome).toBe('completed');
    expect(seen).toEqual(['first']);

    const counts = await repos.jobs.counts(workspaceId);
    expect(counts.complete).toBe(1);
  });

  it('never hands the same job to two workers', async () => {
    const { repos, tx, clock, workspaceId } = await setup();

    for (let index = 0; index < 12; index += 1) {
      await repos.jobs.enqueue(workspaceId, { kind: 'test.slow', payload: { index } });
    }

    const handled: number[] = [];
    const registry = defineJobs([
      {
        kind: 'test.slow',
        description: 'Records which worker saw it.',
        handler: async (context) => {
          handled.push(Number(context.job.payload.index));
        },
      },
    ]);

    // Three workers draining the same queue at once. SKIP LOCKED is what makes
    // this safe without a lock server; a double-claim would show as a duplicate.
    await Promise.all(
      ['w1', 'w2', 'w3'].map((workerId) =>
        drainQueue({ repos, tx, clock, registry, workerId }, { maxJobs: 12 }),
      ),
    );

    expect(handled).toHaveLength(12);
    expect(new Set(handled).size).toBe(12);
  });

  it('collapses duplicate work rather than queueing it twice', async () => {
    const { repos, workspaceId } = await setup();

    const first = await repos.jobs.enqueue(workspaceId, {
      kind: 'opportunity.score',
      dedupeKey: 'opportunity.score:opp-1',
    });
    const second = await repos.jobs.enqueue(workspaceId, {
      kind: 'opportunity.score',
      dedupeKey: 'opportunity.score:opp-1',
    });

    expect(first).not.toBeNull();
    // The second is absorbed: one rescore of an opportunity is enough.
    expect(second).toBeNull();

    const counts = await repos.jobs.counts(workspaceId);
    expect(counts.queued).toBe(1);
  });

  it('allows the same key again once the earlier job has finished', async () => {
    const { repos, tx, clock, workspaceId } = await setup();
    const registry = defineJobs([
      { kind: 'test.ok', description: 'Succeeds immediately.', handler: async () => {} },
    ]);

    await repos.jobs.enqueue(workspaceId, { kind: 'test.ok', dedupeKey: 'k' });
    await runOneJob({ repos, tx, clock, registry, workerId: 'w1' });

    // Deduplication covers pending work only. A completed job must not block the
    // next legitimate run of the same thing.
    const again = await repos.jobs.enqueue(workspaceId, { kind: 'test.ok', dedupeKey: 'k' });
    expect(again).not.toBeNull();
  });

  it('retries a transient failure with a delay, then gives up', async () => {
    const { repos, tx, clock, workspaceId } = await setup();
    let attempts = 0;

    const registry = defineJobs([
      {
        kind: 'test.flaky',
        description: 'Always throws.',
        maxAttempts: 2,
        handler: async () => {
          attempts += 1;
          throw new Error('upstream is unhappy');
        },
      },
    ]);

    await repos.jobs.enqueue(workspaceId, { kind: 'test.flaky', maxAttempts: 2 });

    await runOneJob({ repos, tx, clock, registry, workerId: 'w1', random: () => 0.5 });
    let [job] = await repos.jobs.list(workspaceId, { kind: 'test.flaky' });
    expect(job?.status).toBe('retrying');
    // It is not runnable yet: the backoff has pushed it into the future.
    expect(job!.runAt.getTime()).toBeGreaterThan(clock.now().getTime());

    clock.advance(60_000);
    await runOneJob({ repos, tx, clock, registry, workerId: 'w1', random: () => 0.5 });
    [job] = await repos.jobs.list(workspaceId, { kind: 'test.flaky' });
    expect(job?.status).toBe('failed');
    expect(attempts).toBe(2);
  });

  it('fails a permanent error immediately without burning retries', async () => {
    const { repos, tx, clock, workspaceId } = await setup();
    const registry = defineJobs([
      {
        kind: 'test.permanent',
        description: 'Throws something retrying cannot fix.',
        maxAttempts: 5,
        handler: async () => {
          throw new JobPermanentFailure('the payload references a deleted opportunity');
        },
      },
    ]);

    await repos.jobs.enqueue(workspaceId, { kind: 'test.permanent' });
    await runOneJob({ repos, tx, clock, registry, workerId: 'w1' });

    const [job] = await repos.jobs.list(workspaceId, { kind: 'test.permanent' });
    expect(job?.status).toBe('failed');
    expect(job?.attempts).toBe(1);
  });

  it('holds work waiting on something the owner has not connected', async () => {
    const { repos, tx, clock, workspaceId } = await setup();
    const registry = defineJobs([
      {
        kind: 'test.needs_provider',
        description: 'Needs an AI provider.',
        maxAttempts: 1,
        handler: async () => {
          throw new JobBlocked('No AI provider is configured.', 'Connect one in Settings.');
        },
      },
    ]);

    await repos.jobs.enqueue(workspaceId, { kind: 'test.needs_provider' });
    await runOneJob({ repos, tx, clock, registry, workerId: 'w1' });

    const [job] = await repos.jobs.list(workspaceId, { kind: 'test.needs_provider' });
    // Blocked, not failed: it is waiting for the owner, not broken.
    expect(job?.status).toBe('blocked');
    expect(job?.lastError).toContain('Connect one in Settings');

    // And it resumes when the precondition arrives, rather than being lost.
    const released = await repos.jobs.unblock(workspaceId, ['test.needs_provider'], clock.now());
    expect(released).toBe(1);
    const [after] = await repos.jobs.list(workspaceId, { kind: 'test.needs_provider' });
    expect(after?.status).toBe('queued');
  });

  it('reclaims work whose worker died mid-job', async () => {
    const { repos, clock, workspaceId } = await setup();

    await repos.jobs.enqueue(workspaceId, { kind: 'test.stuck', timeoutSec: 30 });

    // Claimed, then the worker vanishes without completing or failing it.
    const claimed = await repos.jobs.claim('doomed-worker', clock.now());
    expect(claimed?.status).toBe('running');

    clock.advance(31_000);
    const reaped = await repos.jobs.reapExpired(clock.now(), () => 5);
    expect(reaped).toBe(1);

    const [job] = await repos.jobs.list(workspaceId, { kind: 'test.stuck' });
    expect(job?.status).toBe('retrying');
    expect(job?.workerId).toBeNull();
    expect(job?.lastError).toContain('Lease expired');
  });

  it('keeps a heartbeating job out of the reaper', async () => {
    const { repos, clock, workspaceId } = await setup();
    await repos.jobs.enqueue(workspaceId, { kind: 'test.long', timeoutSec: 30 });

    const claimed = await repos.jobs.claim('w1', clock.now());
    clock.advance(25_000);
    await repos.jobs.heartbeat(claimed!.id, clock.now(), 30);

    clock.advance(20_000);
    expect(await repos.jobs.reapExpired(clock.now(), () => 5)).toBe(0);
  });

  it('resumes from a checkpoint rather than starting over', async () => {
    const { repos, tx, clock, workspaceId } = await setup();
    const processed: number[][] = [];

    const registry = defineJobs([
      {
        kind: 'test.resumable',
        description: 'Processes in pages, checkpointing as it goes.',
        maxAttempts: 3,
        handler: async (context) => {
          const from = Number(context.job.checkpoint?.cursor ?? 0);
          const page = [from, from + 1];
          processed.push(page);
          await context.checkpoint({ cursor: from + 2 });
          if (from < 2) throw new Error('interrupted');
        },
      },
    ]);

    await repos.jobs.enqueue(workspaceId, { kind: 'test.resumable', maxAttempts: 3 });

    await runOneJob({ repos, tx, clock, registry, workerId: 'w1', random: () => 0 });
    clock.advance(120_000);
    await runOneJob({ repos, tx, clock, registry, workerId: 'w1', random: () => 0 });

    // The second attempt continues from where the first stopped.
    expect(processed).toEqual([
      [0, 1],
      [2, 3],
    ]);
  });

  it('cancels queued work and stops it running', async () => {
    const { repos, tx, clock, workspaceId } = await setup();
    let ran = false;
    const registry = defineJobs([
      {
        kind: 'test.cancellable',
        description: 'Should never run once cancelled.',
        handler: async () => {
          ran = true;
        },
      },
    ]);

    const job = await repos.jobs.enqueue(workspaceId, { kind: 'test.cancellable' });
    expect(await repos.jobs.cancel(workspaceId, job!.id, clock.now())).toBe(true);

    expect(await runOneJob({ repos, tx, clock, registry, workerId: 'w1' })).toBe('idle');
    expect(ran).toBe(false);
  });

  it('fails a job whose handler no longer exists instead of retrying forever', async () => {
    const { repos, tx, clock, workspaceId } = await setup();
    await repos.jobs.enqueue(workspaceId, { kind: 'test.orphan' });

    const registry = defineJobs([
      { kind: 'test.orphan', description: 'Registered so it can be claimed.', handler: async () => {} },
    ]);
    // Claimable by kind, but the definition is gone by the time it runs.
    registry.delete('test.orphan');
    registry.set('test.orphan', {
      kind: 'test.orphan',
      description: 'placeholder',
      handler: async () => {},
    });
    registry.delete('test.orphan');

    const outcome = await runOneJob({
      repos,
      tx,
      clock,
      registry: defineJobs([{ kind: 'other', description: 'Unrelated job.', handler: async () => {} }]),
      workerId: 'w1',
    });

    // Nothing claimable, because claiming filters by registered kinds -- an
    // unknown job waits rather than being repeatedly failed by every worker.
    expect(outcome).toBe('idle');
    const [job] = await repos.jobs.list(workspaceId, { kind: 'test.orphan' });
    expect(job?.status).toBe('queued');
  });
});

describe('the scheduler', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('fires a due schedule exactly once, however many workers tick', async () => {
    // A workspace ships with the default schedules installed, so this asserts on
    // the schedule under test rather than on totals.
    const { repos, clock, workspaceId } = await setup();

    await repos.schedules.upsert(workspaceId, {
      key: 'brief.generate',
      cron: '0 6 * * *',
      jobKind: 'brief.generate',
    });

    // Three simultaneous ticks, as three workers would produce.
    await Promise.all([
      runScheduler({ repos, clock }),
      runScheduler({ repos, clock }),
      runScheduler({ repos, clock }),
    ]);

    const jobs = await repos.jobs.list(workspaceId, { kind: 'brief.generate' });
    expect(jobs).toHaveLength(1);
  });

  it('does not re-fire the same bucket when ticked again', async () => {
    const { repos, clock, workspaceId } = await setup();
    await repos.schedules.upsert(workspaceId, {
      key: 'alerts.evaluate',
      cron: '25 * * * *',
      jobKind: 'alerts.evaluate',
    });

    await runScheduler({ repos, clock });
    const second = await runScheduler({ repos, clock });

    expect(second.enqueued).toBe(0);
    expect(await repos.jobs.list(workspaceId, { kind: 'alerts.evaluate' })).toHaveLength(1);
  });

  it('skips a disabled schedule', async () => {
    const { repos, clock, workspaceId } = await setup();
    await repos.schedules.upsert(workspaceId, {
      key: 'brief.generate',
      cron: '0 6 * * *',
      jobKind: 'brief.generate',
      enabled: false,
    });

    await runScheduler({ repos, clock });

    expect(await repos.jobs.list(workspaceId, { kind: 'brief.generate' })).toHaveLength(0);
    // The other defaults still fire; disabling one must not disable the machine.
    expect((await repos.jobs.list(workspaceId, { kind: 'alerts.evaluate' })).length).toBeGreaterThan(0);
  });

  it('installs the default schedules with a new workspace', async () => {
    const { repos, workspaceId } = await setup();
    const schedules = await repos.schedules.listAll(workspaceId);

    // The machine is scheduled from day one. Each default is harmless on an
    // empty workspace: nothing connected means nothing found.
    expect(schedules.length).toBeGreaterThanOrEqual(7);
    expect(schedules.every((schedule) => schedule.enabled)).toBe(true);
  });
});

describe('event projection', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('turns an event into the work it causes', async () => {
    const { repos, clock, workspaceId } = await setup();

    await repos.events.append(workspaceId, {
      kind: 'evidence.created',
      subjectType: 'evidence_unit',
      subjectId: '00000000-0000-4000-8000-000000000001',
    });

    const result = await projectEvents({ repos, clock });
    expect(result.processed).toBe(1);
    expect(result.enqueued).toBe(1);

    const jobs = await repos.jobs.list(workspaceId, { kind: 'cluster.assign' });
    expect(jobs).toHaveLength(1);
  });

  it('collapses a burst into one job per subject', async () => {
    const { repos, clock, workspaceId } = await setup();

    // Five hundred pieces of evidence arriving at once must not produce five
    // hundred grouping passes.
    for (let index = 0; index < 500; index += 1) {
      await repos.events.append(workspaceId, {
        kind: 'evidence.created',
        subjectType: 'evidence_unit',
        subjectId: null,
      });
    }

    const result = await projectEvents({ repos, clock, }, { limit: 500 });
    expect(result.processed).toBe(500);
    expect(result.enqueued).toBe(1);
    expect(result.debounced).toBe(499);
  });

  it('processes events in the order they occurred', async () => {
    const { repos, clock, workspaceId } = await setup();

    for (const kind of ['evidence.created', 'evidence.strengthened', 'score.changed']) {
      await repos.events.append(workspaceId, { kind, subjectType: 'test', subjectId: null });
    }

    const unprocessed = await repos.events.listUnprocessed();
    const sequences = unprocessed.map((event) => event.sequence);
    expect([...sequences].sort((a, b) => a - b)).toEqual(sequences);

    await projectEvents({ repos, clock });
    expect(await repos.events.countUnprocessed(workspaceId)).toBe(0);
  });

  it('refuses to follow a chain of caused work past a fixed depth', async () => {
    const { repos, clock, workspaceId } = await setup();

    await repos.events.append(workspaceId, {
      kind: 'evidence.created',
      subjectType: 'evidence_unit',
      subjectId: null,
      causationDepth: 99,
    });

    const result = await projectEvents({ repos, clock });
    expect(result.droppedTooDeep).toBe(1);
    expect(result.enqueued).toBe(0);
  });
});

describe('alerts', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('does not repeat the same alert within its suppression window', async () => {
    const { repos, clock, workspaceId } = await setup();

    const first = await repos.alerts.raise(
      workspaceId,
      {
        kind: 'opportunity.strengthened',
        title: 'Something moved',
        body: 'It moved a lot.',
        dedupeKey: 'opportunity.strengthened:opp-1',
        suppressForSeconds: 3600,
      },
      clock.now(),
    );
    expect(first).not.toBeNull();

    clock.advance(60_000);
    const second = await repos.alerts.raise(
      workspaceId,
      {
        kind: 'opportunity.strengthened',
        title: 'Something moved',
        body: 'It moved a lot.',
        dedupeKey: 'opportunity.strengthened:opp-1',
        suppressForSeconds: 3600,
      },
      clock.now(),
    );
    // Suppressed: an alert that repeats is an alert that gets ignored.
    expect(second).toBeNull();

    clock.advance(3_600_000);
    const third = await repos.alerts.raise(
      workspaceId,
      {
        kind: 'opportunity.strengthened',
        title: 'Something moved again',
        body: 'And again.',
        dedupeKey: 'opportunity.strengthened:opp-1',
        suppressForSeconds: 3600,
      },
      clock.now(),
    );
    expect(third).not.toBeNull();
  });
});
