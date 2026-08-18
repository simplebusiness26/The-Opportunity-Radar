import { z } from 'zod';
import {
  estimateBuildLeverage,
  matchCapabilities,
  type LeverageEstimate,
  type OwnedCapability,
  type RequiredCapability,
} from '../../domain/leverage/index';
import { computeFit, type FitResult } from '../../domain/fit/index';
import { resolveCapability } from '../../domain/taxonomy/capabilities';
import { errors } from '../../domain/types/errors';
import type { ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';

export interface IntelligenceDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export const recordCapabilityInput = z.object({
  name: z.string().trim().min(2).max(160),
  /** Free text; resolved against the taxonomy, never guessed at. */
  capability: z.string().trim().min(2).max(160),
  maturity: z.enum(['experimental', 'working', 'production', 'battle_tested']),
  evidenceStrength: z.number().min(0).max(1).default(0.6),
  notes: z.string().trim().max(2000).optional().nullable(),
  /** Assets that provide it, by name. Created if they do not exist. */
  providedBy: z.array(z.string().trim().min(1).max(160)).max(20).default([]),
});

export type RecordCapabilityInput = z.infer<typeof recordCapabilityInput>;

export interface RecordCapabilityResult {
  nodeId: string;
  taxonomyKey: string | null;
  /** Set when the wording could not be matched to the shared vocabulary. */
  unresolvedWarning: string | null;
}

/**
 * Records something the team can do.
 *
 * The free-text capability is resolved to a taxonomy key so it can later be
 * compared with what an opportunity requires. When it will not resolve, the
 * capability is still stored, but the owner is told plainly that it will not
 * participate in leverage matching until it is named in known terms -- which is
 * better than silently mapping it to something adjacent.
 */
export async function recordCapability(
  deps: IntelligenceDeps,
  ctx: ActorCtx,
  input: RecordCapabilityInput,
): Promise<RecordCapabilityResult> {
  if (!can(ctx, 'intelligence.write')) throw errors.forbidden('intelligence.write');
  const parsed = recordCapabilityInput.parse(input);
  const resolution = resolveCapability(parsed.capability);

  return deps.tx.transaction(async (repos) => {
    const node = await repos.graph.upsertNode(ctx.workspaceId, {
      kind: 'capability',
      name: parsed.name,
      summary: parsed.notes ?? null,
      attrs: { declaredAs: parsed.capability, resolvedBy: resolution.method },
      verifiedAt: deps.clock.now(),
    });

    if (resolution.key) {
      await repos.graph.setCapability(ctx.workspaceId, node.id, {
        taxonomyKey: resolution.key,
        maturity: parsed.maturity,
        evidenceStrength: parsed.evidenceStrength,
        notes: parsed.notes ?? null,
        lastVerifiedAt: deps.clock.now(),
      });
    }

    for (const assetName of parsed.providedBy) {
      const assetNode = await repos.graph.upsertNode(ctx.workspaceId, {
        kind: 'asset',
        name: assetName,
      });
      await repos.graph.connect(ctx.workspaceId, {
        fromNodeId: assetNode.id,
        toNodeId: node.id,
        kind: 'provides_capability',
      });
    }

    await repos.audit.record(ctx, {
      action: 'intelligence.capability_recorded',
      entityType: 'ig_node',
      entityId: node.id,
      after: { capability: parsed.capability, resolved: resolution.key, maturity: parsed.maturity },
    });

    return {
      nodeId: node.id,
      taxonomyKey: resolution.key,
      unresolvedWarning: resolution.key
        ? null
        : `"${parsed.capability}" is not in the capability vocabulary, so it will not count towards build leverage until it is described in known terms.`,
    };
  });
}

export const recordAssetInput = z.object({
  name: z.string().trim().min(2).max(160),
  assetKind: z.string().trim().min(2).max(80),
  reuseReadiness: z.enum(['concept', 'needs_work', 'lift_and_shift', 'drop_in']),
  location: z.string().trim().max(500).optional().nullable(),
  licence: z.string().trim().max(120).optional().nullable(),
  summary: z.string().trim().max(2000).optional().nullable(),
});

export async function recordAsset(
  deps: IntelligenceDeps,
  ctx: ActorCtx,
  input: z.infer<typeof recordAssetInput>,
): Promise<{ nodeId: string }> {
  if (!can(ctx, 'intelligence.write')) throw errors.forbidden('intelligence.write');
  const parsed = recordAssetInput.parse(input);

  return deps.tx.transaction(async (repos) => {
    const node = await repos.graph.upsertNode(ctx.workspaceId, {
      kind: 'asset',
      name: parsed.name,
      summary: parsed.summary ?? null,
    });

    await repos.graph.setAsset(ctx.workspaceId, node.id, {
      assetKind: parsed.assetKind,
      reuseReadiness: parsed.reuseReadiness,
      licence: parsed.licence ?? null,
      location: parsed.location ?? null,
      lastChangeAt: deps.clock.now(),
    });

    await repos.audit.record(ctx, {
      action: 'intelligence.asset_recorded',
      entityType: 'ig_node',
      entityId: node.id,
      after: { name: parsed.name, kind: parsed.assetKind },
    });

    return { nodeId: node.id };
  });
}

export const recordResourceInput = z.object({
  name: z.string().trim().min(2).max(160),
  resourceKind: z.enum(['budget', 'time', 'compute', 'team']),
  amount: z.number().min(0).max(1_000_000_000),
  unit: z.string().trim().min(1).max(40),
  period: z.enum(['week', 'month', 'quarter', 'once']).default('month'),
  committed: z.number().min(0).default(0),
});

export async function recordResource(
  deps: IntelligenceDeps,
  ctx: ActorCtx,
  input: z.infer<typeof recordResourceInput>,
): Promise<{ nodeId: string }> {
  if (!can(ctx, 'intelligence.write')) throw errors.forbidden('intelligence.write');
  const parsed = recordResourceInput.parse(input);

  return deps.tx.transaction(async (repos) => {
    const node = await repos.graph.upsertNode(ctx.workspaceId, {
      kind: 'resource',
      name: parsed.name,
    });
    await repos.graph.setResource(ctx.workspaceId, node.id, parsed);
    await repos.audit.record(ctx, {
      action: 'intelligence.resource_recorded',
      entityType: 'ig_node',
      entityId: node.id,
      after: parsed,
    });
    return { nodeId: node.id };
  });
}

export const recordGoalInput = z.object({
  name: z.string().trim().min(3).max(200),
  horizon: z.enum(['month', 'quarter', 'year', 'long_term']).default('quarter'),
  priority: z.number().int().min(1).max(10).default(1),
  metric: z.string().trim().max(200).optional().nullable(),
  target: z.string().trim().max(200).optional().nullable(),
});

export async function recordGoal(
  deps: IntelligenceDeps,
  ctx: ActorCtx,
  input: z.infer<typeof recordGoalInput>,
): Promise<{ nodeId: string }> {
  if (!can(ctx, 'intelligence.write')) throw errors.forbidden('intelligence.write');
  const parsed = recordGoalInput.parse(input);

  return deps.tx.transaction(async (repos) => {
    const node = await repos.graph.upsertNode(ctx.workspaceId, { kind: 'goal', name: parsed.name });
    await repos.graph.setGoal(ctx.workspaceId, node.id, parsed);
    await repos.audit.record(ctx, {
      action: 'intelligence.goal_recorded',
      entityType: 'ig_node',
      entityId: node.id,
      after: parsed,
    });
    return { nodeId: node.id };
  });
}

/** What the team currently has, in the shape the leverage engine consumes. */
export async function readOwnedCapabilities(
  deps: IntelligenceDeps,
  ctx: ActorCtx,
): Promise<OwnedCapability[]> {
  const rows = await deps.repos.graph.listCapabilities(ctx.workspaceId);
  return rows.map((row) => ({
    taxonomyKey: row.taxonomyKey,
    maturity: row.maturity,
    evidenceStrength: row.evidenceStrength,
    assetNames: row.assetNames,
    ...(row.reuseReadiness ? { reuseReadiness: row.reuseReadiness } : {}),
  }));
}

export interface LeverageForOpportunity {
  leverage: LeverageEstimate;
  fit: FitResult;
}

/**
 * Computes leverage and fit for one opportunity against the current graph.
 *
 * Both are recomputed from live state rather than stored, because the answer
 * legitimately changes when the team's capabilities change -- which is the
 * point: shipping something new should make related opportunities cheaper.
 */
export async function assessOpportunityFit(
  deps: IntelligenceDeps,
  ctx: ActorCtx,
  opportunityId: string,
): Promise<LeverageForOpportunity> {
  if (!can(ctx, 'opportunities.read')) throw errors.forbidden('opportunities.read');

  const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, opportunityId);
  if (!opportunity) throw errors.notFound('Opportunity');

  const [requirements, owned, resources, goals] = await Promise.all([
    deps.repos.opportunities.capabilityRequirements(opportunityId),
    readOwnedCapabilities(deps, ctx),
    deps.repos.graph.listResources(ctx.workspaceId),
    deps.repos.graph.listGoals(ctx.workspaceId),
  ]);

  const required: RequiredCapability[] = requirements.map((requirement) => ({
    taxonomyKey: requirement.taxonomyKey,
    label: requirement.label,
    criticality: requirement.criticality,
  }));

  const leverage = estimateBuildLeverage(matchCapabilities(required, owned));

  const budget = resources.find((resource) => resource.resourceKind === 'budget');
  const time = resources.find((resource) => resource.resourceKind === 'time');
  const profile = (opportunity.notes.fitProfile ?? {}) as {
    domainExperience?: 'none' | 'adjacent' | 'direct';
    customerAccess?: 'none' | 'weak' | 'strong';
    hasDistribution?: boolean;
    motivation?: number;
    estimatedCost?: number;
  };

  const fit = computeFit({
    leverage,
    domainExperience: profile.domainExperience ?? null,
    customerAccess: profile.customerAccess ?? null,
    hasDistribution: profile.hasDistribution ?? null,
    capitalFit: {
      available: budget ? budget.amount - budget.committed : null,
      required: profile.estimatedCost ?? null,
    },
    timeFit: {
      availableDays: time ? time.amount - time.committed : null,
      requiredDays: leverage.requiredCount > 0 ? leverage.leveragedDays[1] : null,
    },
    // Alignment needs a stated goal to align with; without one it is unknown
    // rather than neutral.
    strategicAlignment: goals.length > 0 ? 0.6 : null,
    motivation: profile.motivation ?? null,
    priorOutcomes: await countPriorOutcomes(deps, ctx),
  });

  return { leverage, fit };
}

async function countPriorOutcomes(
  deps: IntelligenceDeps,
  ctx: ActorCtx,
): Promise<{ successes: number; failures: number }> {
  const history = await deps.repos.executionHistory.list(ctx.workspaceId, 200);
  return {
    successes: history.filter((entry) => entry.outcome === 'succeeded').length,
    failures: history.filter((entry) => entry.outcome === 'failed').length,
  };
}
