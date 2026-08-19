import { beforeEach, describe, expect, it } from 'vitest';
import { signUp } from '../../src/application/auth/sign-up';
import { syncOperatingSystemSnapshot } from '../../src/application/integrations/os-sync';
import { readOwnedCapabilities } from '../../src/application/intelligence/capability-profile';
import { controllableClock } from '../../src/adapters/clock/index';
import { createRepositories, createTransactor } from '../../src/adapters/db/repos/index';
import { buildAuthDeps } from './helpers/deps';
import { resetTestDatabase, testDb } from './helpers/db';

const NOW = new Date('2026-08-19T00:00:00Z');

async function setup() {
  const account = await signUp(buildAuthDeps({ now: NOW }), {
    email: `os-sync-${Math.random().toString(36).slice(2)}@example.com`,
    password: 'a-sufficiently-long-password',
    displayName: 'Owner',
    workspaceName: 'Radar HQ',
  });
  const { db } = testDb();
  const deps = {
    repos: createRepositories(db),
    tx: createTransactor(db),
    clock: controllableClock(NOW),
  };
  const workspace = await deps.repos.tenancy.findWorkspace(account.workspaceId);
  if (!workspace) throw new Error('workspace missing in test setup');
  return { deps, workspace };
}

const snapshot = {
  version: 1 as const,
  source: 'operating-system' as const,
  generatedAt: '2026-08-19T00:00:00Z',
  projects: [
    {
      id: 'os-project-explorer',
      name: 'Explorer',
      status: 'active',
      summary: 'Mobile discovery product',
      goal: 'Ship the Brighton pilot',
      updatedAt: '2026-08-18T23:00:00Z',
      reuseReadiness: 'lift_and_shift' as const,
    },
  ],
  capabilities: [
    {
      name: 'Maps and geospatial',
      capability: 'maps',
      maturity: 'working' as const,
      evidenceStrength: 0.82,
      notes: 'Inferred from MapLibre implementation commits.',
      providedBy: ['Explorer'],
      evidenceRefs: ['os-event:commit-maplibre'],
    },
    {
      name: 'Future mystery capability',
      capability: 'telepathic widgets',
      maturity: 'working' as const,
      evidenceStrength: 0.7,
      notes: null,
      providedBy: ['Explorer'],
      evidenceRefs: ['os-event:mystery'],
    },
  ],
  resources: [
    {
      name: 'Build time',
      resourceKind: 'time' as const,
      amount: 7,
      unit: 'days',
      period: 'week' as const,
      committed: 2,
    },
  ],
  goals: [
    {
      name: 'Reach a working pilot',
      horizon: 'quarter' as const,
      priority: 8,
      metric: 'pilot',
      target: '1',
      evidenceRefs: ['os-project:os-project-explorer'],
    },
  ],
};

describe('Operating System intelligence sync', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('imports internal intelligence without downgrading project assets or guessing unknown capabilities', async () => {
    const { deps, workspace } = await setup();

    const result = await syncOperatingSystemSnapshot(deps, workspace, snapshot);

    expect(result.projectsSynced).toBe(1);
    expect(result.capabilitiesSynced).toBe(1);
    expect(result.unresolvedCapabilities).toEqual([
      { name: 'Future mystery capability', declaredAs: 'telepathic widgets' },
    ]);

    const assets = await deps.repos.graph.listAssets(workspace.id);
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({
      name: 'Explorer',
      assetKind: 'project',
      reuseReadiness: 'lift_and_shift',
    });

    const owned = await readOwnedCapabilities(deps.repos, workspace.id);
    expect(owned).toHaveLength(1);
    expect(owned[0]).toMatchObject({
      taxonomyKey: 'interface.maps',
      maturity: 'working',
      evidenceStrength: 0.82,
    });
    expect(owned[0]?.assetNames).toEqual(['Explorer']);

    expect(await deps.repos.graph.listResources(workspace.id)).toHaveLength(1);
    expect(await deps.repos.graph.listGoals(workspace.id)).toHaveLength(1);
    expect(await deps.repos.audit.countActions(workspace.id, 'integration.operating_system_synced')).toBe(1);
  });

  it('is idempotent for graph records across repeated snapshots', async () => {
    const { deps, workspace } = await setup();

    await syncOperatingSystemSnapshot(deps, workspace, snapshot);
    await syncOperatingSystemSnapshot(deps, workspace, {
      ...snapshot,
      generatedAt: '2026-08-19T00:05:00Z',
    });

    expect(await deps.repos.graph.listAssets(workspace.id)).toHaveLength(1);
    expect(await deps.repos.graph.listCapabilities(workspace.id)).toHaveLength(1);
    expect(await deps.repos.graph.listResources(workspace.id)).toHaveLength(1);
    expect(await deps.repos.graph.listGoals(workspace.id)).toHaveLength(1);
    expect(await deps.repos.audit.countActions(workspace.id, 'integration.operating_system_synced')).toBe(2);
  });
});
