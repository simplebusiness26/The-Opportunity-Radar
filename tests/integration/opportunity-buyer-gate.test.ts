import { beforeEach, describe, expect, it } from 'vitest';
import { signUp } from '../../src/application/auth/sign-up';
import { recordSignal } from '../../src/application/signals/record-signal';
import { createCluster } from '../../src/application/clusters/cluster-evidence';
import { frameOpportunitiesFromReadyClusters } from '../../src/application/opportunities/frame-from-clusters';
import type { SystemCtx, WorkspaceCtx } from '../../src/domain/types/identity';
import { controllableClock } from '../../src/adapters/clock/index';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';

const NOW = new Date('2026-08-21T00:00:00Z');

async function setup() {
  const account = await signUp(buildAuthDeps({ now: NOW }), {
    email: `buyer-gate-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-sufficiently-long-password',
    displayName: 'Owner',
    workspaceName: 'Buyer Gate',
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

describe('automatic opportunity buyer gate', () => {
  beforeEach(async () => resetTestDatabase());

  it('keeps commercially suggestive evidence in Problems when Radar cannot name who buys', async () => {
    const { deps, ownerCtx, systemCtx } = await setup();

    const signals = [
      {
        title: 'Invoice approval queue wastes hours every week',
        bodyText: 'The invoice approval queue is handled manually and takes hours every week before anything can be paid.',
        url: 'https://source-one.example/invoice-queue',
        signalTypeKey: 'workaround' as const,
        evidenceClass: 'community' as const,
      },
      {
        title: 'Invoice approval workflow already costs money',
        bodyText: 'We pay $500 per month for the current invoice approval workflow but still copy approval details by hand.',
        url: 'https://source-two.example/invoice-queue',
        signalTypeKey: 'spending' as const,
        evidenceClass: 'direct_customer' as const,
      },
      {
        title: 'Manual invoice approval keeps causing missed payments',
        bodyText: 'The same invoice approval queue keeps failing because approvals are copied manually and payments get missed.',
        url: 'https://source-three.example/invoice-queue',
        signalTypeKey: 'pain' as const,
        evidenceClass: 'primary' as const,
      },
    ];

    for (const signal of signals) {
      await recordSignal(deps, ownerCtx, { ...signal, observedAt: NOW });
    }

    const evidence = await deps.repos.evidence.listClusterable(ownerCtx.workspaceId, {});
    expect(evidence.length).toBeGreaterThanOrEqual(2);

    await createCluster(deps, ownerCtx, {
      title: 'Manual invoice approval wastes time and money',
      problemStatement: 'Repeated independent evidence indicates this problem: invoice approvals are handled manually, take hours and cause missed payments.',
      targetCustomer: null,
      evidenceUnitIds: evidence.map((row) => row.id),
    });

    const framed = await frameOpportunitiesFromReadyClusters(deps, systemCtx);
    expect(framed.created).toBe(0);
    expect(framed.blocked).toBeGreaterThanOrEqual(1);
    expect(await deps.repos.opportunities.list(ownerCtx.workspaceId, {})).toHaveLength(0);
  });
});
