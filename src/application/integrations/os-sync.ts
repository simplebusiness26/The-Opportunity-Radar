import { z } from 'zod';
import { resolveCapability } from '../../domain/taxonomy/capabilities';
import type { SystemCtx } from '../../domain/types/identity';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { WorkspaceSummary } from '../../ports/repositories/auth';

const maturity = z.enum(['experimental', 'working', 'production', 'battle_tested']);
const reuseReadiness = z.enum(['concept', 'needs_work', 'lift_and_shift', 'drop_in']);

export const osProjectSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(160),
  status: z.string().trim().max(80).default('active'),
  summary: z.string().trim().max(4000).default(''),
  goal: z.string().trim().max(1000).default(''),
  updatedAt: z.string().trim().max(80).optional(),
  reuseReadiness: reuseReadiness.default('needs_work'),
});

export const osCapabilitySchema = z.object({
  name: z.string().trim().min(2).max(160),
  capability: z.string().trim().min(2).max(160),
  maturity: maturity.default('working'),
  evidenceStrength: z.number().min(0).max(1).default(0.6),
  notes: z.string().trim().max(2000).optional().nullable(),
  providedBy: z.array(z.string().trim().min(1).max(160)).max(50).default([]),
  evidenceRefs: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
});

export const osResourceSchema = z.object({
  name: z.string().trim().min(2).max(160),
  resourceKind: z.enum(['budget', 'time', 'compute', 'team']),
  amount: z.number().min(0).max(1_000_000_000),
  unit: z.string().trim().min(1).max(40),
  period: z.enum(['week', 'month', 'quarter', 'once']).default('month'),
  committed: z.number().min(0).default(0),
});

export const osGoalSchema = z.object({
  name: z.string().trim().min(3).max(200),
  horizon: z.enum(['month', 'quarter', 'year', 'long_term']).default('quarter'),
  priority: z.number().int().min(1).max(10).default(5),
  metric: z.string().trim().max(200).optional().nullable(),
  target: z.string().trim().max(200).optional().nullable(),
  evidenceRefs: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
});

export const operatingSystemSnapshotSchema = z.object({
  version: z.literal(1),
  source: z.literal('operating-system'),
  generatedAt: z.string().trim().min(1).max(80),
  projects: z.array(osProjectSchema).max(500).default([]),
  capabilities: z.array(osCapabilitySchema).max(500).default([]),
  resources: z.array(osResourceSchema).max(100).default([]),
  goals: z.array(osGoalSchema).max(200).default([]),
});

export type OperatingSystemSnapshot = z.infer<typeof operatingSystemSnapshotSchema>;

export interface OsSyncDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export interface OsSyncResult {
  workspaceId: string;
  projectsSynced: number;
  capabilitiesSynced: number;
  resourcesSynced: number;
  goalsSynced: number;
  unresolvedCapabilities: Array<{ name: string; declaredAs: string }>;
}

/**
 * Imports the user's own operating picture into Radar's internal-intelligence
 * graph. The OS is evidence about what this particular owner has already built;
 * it is never treated as external market evidence and therefore cannot inflate
 * opportunity confidence or independent-source counts.
 *
 * The sync is upsert-only in v1. Disappearing OS records are not silently
 * deleted from Radar because absence from one snapshot is not proof an asset no
 * longer exists. A later reconciliation pass can make staleness explicit.
 */
export async function syncOperatingSystemSnapshot(
  deps: OsSyncDeps,
  workspace: WorkspaceSummary,
  raw: unknown,
): Promise<OsSyncResult> {
  const snapshot = operatingSystemSnapshotSchema.parse(raw);
  const now = deps.clock.now();
  const ctx: SystemCtx = {
    workspaceId: workspace.id,
    orgId: workspace.orgId,
    actor: 'system',
    requestId: `os-sync:${snapshot.generatedAt}`,
  };

  const unresolvedCapabilities: OsSyncResult['unresolvedCapabilities'] = [];

  await deps.tx.transaction(async (repos) => {
    for (const project of snapshot.projects) {
      const node = await repos.graph.upsertNode(workspace.id, {
        kind: 'asset',
        name: project.name,
        summary: project.summary || null,
        source: 'derived',
        confidence: 1,
        verifiedAt: now,
        attrs: {
          origin: 'operating-system',
          osProjectId: project.id,
          osStatus: project.status,
          osUpdatedAt: project.updatedAt ?? null,
          snapshotGeneratedAt: snapshot.generatedAt,
        },
      });
      await repos.graph.setAsset(workspace.id, node.id, {
        assetKind: 'project',
        reuseReadiness: project.reuseReadiness,
        location: `os://project/${encodeURIComponent(project.id)}`,
        lastChangeAt: now,
      });
    }

    for (const capability of snapshot.capabilities) {
      const resolution = resolveCapability(capability.capability);
      const node = await repos.graph.upsertNode(workspace.id, {
        kind: 'capability',
        name: capability.name,
        summary: capability.notes ?? null,
        source: 'derived',
        confidence: capability.evidenceStrength,
        verifiedAt: now,
        attrs: {
          origin: 'operating-system',
          declaredAs: capability.capability,
          resolvedBy: resolution.method,
          evidenceRefs: capability.evidenceRefs,
          snapshotGeneratedAt: snapshot.generatedAt,
        },
      });

      if (!resolution.key) {
        unresolvedCapabilities.push({ name: capability.name, declaredAs: capability.capability });
        continue;
      }

      await repos.graph.setCapability(workspace.id, node.id, {
        taxonomyKey: resolution.key,
        maturity: capability.maturity,
        evidenceStrength: capability.evidenceStrength,
        notes: capability.notes ?? null,
        lastVerifiedAt: now,
      });

      for (const assetName of capability.providedBy) {
        const assetNode = await repos.graph.upsertNode(workspace.id, {
          kind: 'asset',
          name: assetName,
          source: 'derived',
          confidence: capability.evidenceStrength,
          verifiedAt: now,
          attrs: { origin: 'operating-system' },
        });
        await repos.graph.setAsset(workspace.id, assetNode.id, {
          assetKind: 'project_or_component',
          reuseReadiness: 'needs_work',
          lastChangeAt: now,
        });
        await repos.graph.connect(workspace.id, {
          fromNodeId: assetNode.id,
          toNodeId: node.id,
          kind: 'provides_capability',
          evidence: { origin: 'operating-system', refs: capability.evidenceRefs },
        });
      }
    }

    for (const resource of snapshot.resources) {
      const node = await repos.graph.upsertNode(workspace.id, {
        kind: 'resource',
        name: resource.name,
        source: 'derived',
        confidence: 1,
        verifiedAt: now,
        attrs: { origin: 'operating-system', snapshotGeneratedAt: snapshot.generatedAt },
      });
      await repos.graph.setResource(workspace.id, node.id, resource);
    }

    for (const goal of snapshot.goals) {
      const node = await repos.graph.upsertNode(workspace.id, {
        kind: 'goal',
        name: goal.name,
        source: 'derived',
        confidence: 1,
        verifiedAt: now,
        attrs: {
          origin: 'operating-system',
          evidenceRefs: goal.evidenceRefs,
          snapshotGeneratedAt: snapshot.generatedAt,
        },
      });
      await repos.graph.setGoal(workspace.id, node.id, {
        horizon: goal.horizon,
        priority: goal.priority,
        metric: goal.metric ?? null,
        target: goal.target ?? null,
      });
    }

    await repos.audit.record(ctx, {
      action: 'integration.operating_system_synced',
      entityType: 'workspace',
      entityId: workspace.id,
      after: {
        snapshotGeneratedAt: snapshot.generatedAt,
        projects: snapshot.projects.length,
        capabilities: snapshot.capabilities.length,
        resources: snapshot.resources.length,
        goals: snapshot.goals.length,
        unresolvedCapabilities,
      },
    });
  });

  return {
    workspaceId: workspace.id,
    projectsSynced: snapshot.projects.length,
    capabilitiesSynced: snapshot.capabilities.length - unresolvedCapabilities.length,
    resourcesSynced: snapshot.resources.length,
    goalsSynced: snapshot.goals.length,
    unresolvedCapabilities,
  };
}
