import { beforeEach, describe, expect, it } from 'vitest';
import { signUp } from '../../src/application/auth/sign-up';
import { recordSignal } from '../../src/application/signals/record-signal';
import { seedProblemClusters } from '../../src/application/clusters/seed-problem-clusters';
import { frameOpportunitiesFromReadyClusters } from '../../src/application/opportunities/frame-from-clusters';
import type { SystemCtx, WorkspaceCtx } from '../../src/domain/types/identity';
import { controllableClock } from '../../src/adapters/clock/index';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';

const NOW = new Date('2026-08-20T00:00:00Z');

async function setup() {
  const account = await signUp(buildAuthDeps({ now: NOW }), {
    email: `owner-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-sufficiently-long-password',
    displayName: 'Owner',
    workspaceName: 'Radar HQ',
  });

  const { db } = testDb();
  const clock = controllableClock(NOW);
  const deps = { repos: createRepositories(db), tx: createTransactor(db), clock };
  const ownerCtx: WorkspaceCtx = {
    workspaceId: account.workspaceId,
    orgId: 'unused',
    userId: account.userId,
    role: 'owner',
  };
  const systemCtx: SystemCtx = {
    workspaceId: account.workspaceId,
    orgId: 'unused',
    actor: 'system',
  };

  return { deps, ownerCtx, systemCtx };
}

const repeatedProblem = [
  {
    title: 'Small businesses lose leads because enquiries are scattered',
    bodyText:
      'We get customer enquiries across WhatsApp, email and website forms and lose track of follow-ups because everything is scattered between inboxes.',
    url: 'https://forum-one.example/thread/1',
    signalTypeKey: 'pain' as const,
    evidenceClass: 'direct_customer' as const,
  },
  {
    title: 'Need one place for WhatsApp email and web leads',
    bodyText:
      'Looking for a simple system that puts WhatsApp, email and website enquiries in one place so our small team stops missing customer follow-ups.',
    url: 'https://community-two.example/post/2',
    signalTypeKey: 'demand' as const,
    evidenceClass: 'community' as const,
  },
  {
    title: 'Admin role to chase missed enquiries',
    bodyText:
      'Hiring an administrator because customer enquiries arrive through WhatsApp, email and web forms and the team keeps missing follow-ups and losing leads.',
    url: 'https://jobs-three.example/ad/3',
    signalTypeKey: 'labour' as const,
    evidenceClass: 'primary' as const,
  },
];

describe('automatic evidence-to-opportunity framing', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('creates a problem and provisional opportunity only after independent corroboration', async () => {
    const { deps, ownerCtx, systemCtx } = await setup();

    for (const signal of repeatedProblem) {
      await recordSignal(deps, ownerCtx, { ...signal, observedAt: NOW });
    }

    const seeded = await seedProblemClusters(deps, systemCtx);
    expect(seeded.created).toBe(1);

    const framed = await frameOpportunitiesFromReadyClusters(deps, systemCtx);
    expect(framed.created).toBe(1);

    const opportunities = await deps.repos.opportunities.list(ownerCtx.workspaceId, {
      includeDemo: false,
    });
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]?.createdBy).toBe('auto');
    expect(opportunities[0]?.state).toBe('detected');
    expect(opportunities[0]?.clusterId).toBe(seeded.createdClusterIds[0]);

    const evidence = await deps.repos.opportunities.evidenceFor(opportunities[0]!.id);
    expect(evidence).toHaveLength(3);

    const cluster = await deps.repos.clusters.findById(
      ownerCtx.workspaceId,
      seeded.createdClusterIds[0]!,
    );
    expect(cluster?.status).toBe('promoted');
    expect(cluster?.independentSourceCount).toBeGreaterThanOrEqual(2);
  });

  it('does not turn a lone observation into an opportunity', async () => {
    const { deps, ownerCtx, systemCtx } = await setup();

    await recordSignal(deps, ownerCtx, {
      title: 'One isolated complaint',
      bodyText: 'A single customer says a particular reporting screen is awkward to use.',
      url: 'https://single.example/post/1',
      signalTypeKey: 'pain',
      evidenceClass: 'community',
      observedAt: NOW,
    });

    const seeded = await seedProblemClusters(deps, systemCtx);
    const framed = await frameOpportunitiesFromReadyClusters(deps, systemCtx);

    expect(seeded.created).toBe(0);
    expect(framed.created).toBe(0);
    expect(await deps.repos.opportunities.list(ownerCtx.workspaceId, {})).toHaveLength(0);
  });

  it('is idempotent and never creates a second opportunity for the same promoted cluster', async () => {
    const { deps, ownerCtx, systemCtx } = await setup();

    for (const signal of repeatedProblem) {
      await recordSignal(deps, ownerCtx, { ...signal, observedAt: NOW });
    }

    await seedProblemClusters(deps, systemCtx);
    expect((await frameOpportunitiesFromReadyClusters(deps, systemCtx)).created).toBe(1);
    expect((await frameOpportunitiesFromReadyClusters(deps, systemCtx)).created).toBe(0);

    expect(await deps.repos.opportunities.list(ownerCtx.workspaceId, {})).toHaveLength(1);
  });

  it('rotates through a bounded working set instead of processing the whole pool at once', async () => {
    const { deps, ownerCtx, systemCtx } = await setup();

    for (let index = 0; index < 5; index += 1) {
      await recordSignal(deps, ownerCtx, {
        title: `Unrelated observation ${index}`,
        bodyText: `Distinct market observation number ${index} about category-${index} with no shared problem language.`,
        url: `https://source-${index}.example/post/${index}`,
        signalTypeKey: 'pain',
        evidenceClass: 'community',
        observedAt: new Date(NOW.getTime() + index * 1000),
      });
    }

    const seeded = await seedProblemClusters(deps, systemCtx, {
      limit: 10,
      batchSize: 2,
      batchIndex: 1,
    });

    expect(seeded.available).toBe(5);
    expect(seeded.considered).toBe(2);
    expect(seeded.batches).toBe(3);
    expect(seeded.batch).toBe(1);
    expect(seeded.created).toBe(0);
  });
});
