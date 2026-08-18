import { beforeEach, describe, expect, it } from 'vitest';
import { recordSignal } from '../../src/application/signals/record-signal';
import {
  addEvidenceToCluster,
  assignUnclusteredEvidence,
  createCluster,
  listClustersWithReadiness,
  removeEvidenceFromCluster,
} from '../../src/application/clusters/cluster-evidence';
import { signUp } from '../../src/application/auth/sign-up';
import type { WorkspaceCtx } from '../../src/domain/types/identity';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { controllableClock } from '../../src/adapters/clock/index';

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
  const deps = { repos: createRepositories(db), tx: createTransactor(db), clock };
  const ctx: WorkspaceCtx = {
    workspaceId: account.workspaceId,
    orgId: 'unused',
    userId: account.userId,
    role: 'owner',
  };
  return { deps, ctx, clock };
}

const noShowSignals = [
  {
    title: 'Restaurants lose money to no-shows',
    bodyText:
      'We lose four or five covers every Friday to diners who book a table and never turn up, and our booking system makes taking a deposit almost impossible.',
    url: 'https://forum.example/thread/1',
    signalTypeKey: 'pain' as const,
    evidenceClass: 'direct_customer' as const,
  },
  {
    title: 'Booking tool that charges a deposit',
    bodyText:
      'Looking for a restaurant booking tool that charges a deposit up front so diners who book a table actually turn up. Losing covers every week.',
    url: 'https://community.example/post/9',
    signalTypeKey: 'demand' as const,
    evidenceClass: 'community' as const,
  },
  {
    title: 'Reservations administrator wanted',
    bodyText:
      'Hiring a reservations administrator to chase diners who book a table and never turn up, and to handle deposit taking for covers we would otherwise lose.',
    url: 'https://jobs.example/ad/44',
    signalTypeKey: 'labour' as const,
    evidenceClass: 'primary' as const,
  },
];

describe('grouping evidence into problems', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('creates a problem and materialises its metrics from the evidence attached', async () => {
    const { deps, ctx } = await setup();

    const evidenceIds: string[] = [];
    for (const signal of noShowSignals) {
      const result = await recordSignal(deps, ctx, { ...signal, observedAt: NOW });
      evidenceIds.push(result.evidenceUnitId);
    }

    const cluster = await createCluster(deps, ctx, {
      title: 'Restaurant no-shows',
      problemStatement: 'Restaurants lose covers when diners book and do not turn up.',
      targetCustomer: 'Independent restaurants',
      evidenceUnitIds: evidenceIds,
    });

    expect(cluster.uniqueEvidenceCount).toBe(3);
    // Three different domains, so three independent origins.
    expect(cluster.independentSourceCount).toBe(3);
    expect(cluster.sourceDiversity).toBeGreaterThan(0);
    expect(cluster.confidence).toBeGreaterThan(0.4);
  });

  it('reports a problem as ready only once independent sources corroborate it', async () => {
    const { deps, ctx } = await setup();

    const single = await recordSignal(deps, ctx, { ...noShowSignals[0]!, observedAt: NOW });
    const cluster = await createCluster(deps, ctx, {
      title: 'Restaurant no-shows',
      problemStatement: 'Restaurants lose covers when diners book and do not turn up.',
      evidenceUnitIds: [single.evidenceUnitId],
    });

    let listed = await listClustersWithReadiness(deps, ctx);
    expect(listed[0]?.readiness.ready).toBe(false);

    for (const signal of noShowSignals.slice(1)) {
      const result = await recordSignal(deps, ctx, { ...signal, observedAt: NOW });
      await addEvidenceToCluster(deps, ctx, cluster.id, [result.evidenceUnitId]);
    }

    listed = await listClustersWithReadiness(deps, ctx);
    expect(listed[0]?.readiness.ready).toBe(true);
  });

  it('places new evidence into the problem it matches', async () => {
    const { deps, ctx } = await setup();

    const seed = await recordSignal(deps, ctx, { ...noShowSignals[0]!, observedAt: NOW });
    const cluster = await createCluster(deps, ctx, {
      title: 'Restaurant no-shows',
      problemStatement:
        'Restaurants lose covers when diners book a table and never turn up, and cannot take a deposit.',
      evidenceUnitIds: [seed.evidenceUnitId],
    });

    await recordSignal(deps, ctx, { ...noShowSignals[1]!, observedAt: NOW });

    const outcomes = await assignUnclusteredEvidence(deps, ctx);
    const assigned = outcomes.filter((outcome) => outcome.clusterId === cluster.id);

    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.method).toBe('semantic');

    const refreshed = await deps.repos.clusters.findById(ctx.workspaceId, cluster.id);
    expect(refreshed?.uniqueEvidenceCount).toBe(2);
  });

  it('leaves unrelated evidence unassigned instead of inventing a problem for it', async () => {
    const { deps, ctx } = await setup();

    const seed = await recordSignal(deps, ctx, { ...noShowSignals[0]!, observedAt: NOW });
    await createCluster(deps, ctx, {
      title: 'Restaurant no-shows',
      problemStatement: 'Restaurants lose covers when diners book and do not turn up.',
      evidenceUnitIds: [seed.evidenceUnitId],
    });

    await recordSignal(deps, ctx, {
      title: 'Customs paperwork errors',
      bodyText:
        'Freight forwarders keep getting customs declarations wrong and shipments sit at the port for days waiting for corrected paperwork.',
      url: 'https://logistics.example/post/3',
      signalTypeKey: 'pain',
      evidenceClass: 'community',
      observedAt: NOW,
    });

    const outcomes = await assignUnclusteredEvidence(deps, ctx);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.clusterId).toBeNull();
    expect(outcomes[0]?.method).toBe('unassigned');

    // One cluster still, not two. A lone observation is not a problem.
    const clusters = await deps.repos.clusters.list(ctx.workspaceId, {});
    expect(clusters).toHaveLength(1);
  });

  it('recomputes metrics downward when evidence is removed', async () => {
    const { deps, ctx } = await setup();

    const ids: string[] = [];
    for (const signal of noShowSignals) {
      const result = await recordSignal(deps, ctx, { ...signal, observedAt: NOW });
      ids.push(result.evidenceUnitId);
    }

    const cluster = await createCluster(deps, ctx, {
      title: 'Restaurant no-shows',
      problemStatement: 'Restaurants lose covers when diners book and do not turn up.',
      evidenceUnitIds: ids,
    });
    expect(cluster.independentSourceCount).toBe(3);

    const after = await removeEvidenceFromCluster(deps, ctx, cluster.id, ids[0]!);
    expect(after.uniqueEvidenceCount).toBe(2);
    expect(after.independentSourceCount).toBe(2);
    expect(after.confidence).toBeLessThan(cluster.confidence);
  });

  it('does not let repeated mentions of one story buy confidence', async () => {
    const { deps, ctx } = await setup();

    // The same story, reprinted. Dedupe folds them into one piece of evidence
    // and one origin, so the cluster stays weak however many times it appears.
    const first = await recordSignal(deps, ctx, {
      ...noShowSignals[0]!,
      url: 'https://press.example/story',
      observedAt: NOW,
    });

    for (let index = 0; index < 8; index += 1) {
      await recordSignal(deps, ctx, {
        ...noShowSignals[0]!,
        url: `https://press.example/story?utm_source=repost-${index}`,
        observedAt: NOW,
      });
    }

    const cluster = await createCluster(deps, ctx, {
      title: 'Restaurant no-shows',
      problemStatement: 'Restaurants lose covers when diners book and do not turn up.',
      evidenceUnitIds: [first.evidenceUnitId],
    });

    expect(cluster.rawMentions).toBeGreaterThan(1);
    expect(cluster.uniqueEvidenceCount).toBe(1);
    expect(cluster.independentSourceCount).toBe(1);
    expect(cluster.confidence).toBeLessThanOrEqual(0.45);
  });
});
