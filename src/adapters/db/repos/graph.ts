import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import {
  assets,
  capabilities,
  constraints,
  executionHistory,
  goals,
  igEdges,
  igNodes,
  resources,
} from '../schema/index';
import { slugify } from '../../../domain/text/slug';
import type { ReuseReadiness } from '../../../domain/leverage/index';
import type {
  AssetRow,
  CapabilityRow,
  ConstraintRow,
  ExecutionHistoryRepository,
  ExecutionHistoryRow,
  GoalRow,
  GraphRepository,
  IgNodeRow,
  ResourceRow,
} from '../../../ports/repositories/graph';

function toNode(row: typeof igNodes.$inferSelect): IgNodeRow {
  return { ...row, attrs: (row.attrs ?? {}) as Record<string, unknown> } as IgNodeRow;
}

export function createGraphRepository(db: Executor): GraphRepository {
  return {
    async upsertNode(workspaceId, input) {
      // The match key is what stops the same capability being entered twice
      // under slightly different names.
      const matchKey = slugify(input.name) || input.name.toLowerCase();

      const [row] = await db
        .insert(igNodes)
        .values({
          workspaceId,
          kind: input.kind,
          name: input.name,
          matchKey,
          summary: input.summary ?? null,
          source: input.source ?? 'manual',
          confidence: input.confidence ?? 1,
          attrs: input.attrs ?? {},
          verifiedAt: input.verifiedAt ?? null,
          demo: input.demo ?? false,
        })
        .onConflictDoUpdate({
          target: [igNodes.workspaceId, igNodes.kind, igNodes.matchKey],
          set: {
            name: input.name,
            summary: input.summary ?? null,
            confidence: input.confidence ?? 1,
            attrs: input.attrs ?? {},
            verifiedAt: input.verifiedAt ?? null,
          },
        })
        .returning();

      if (!row) throw new Error('upsertNode returned no row');
      return toNode(row);
    },

    async findNode(workspaceId, nodeId) {
      const rows = await db
        .select()
        .from(igNodes)
        .where(and(eq(igNodes.workspaceId, workspaceId), eq(igNodes.id, nodeId)))
        .limit(1);
      return rows[0] ? toNode(rows[0]) : null;
    },

    async listNodes(workspaceId, kinds) {
      const conditions = [eq(igNodes.workspaceId, workspaceId)];
      if (kinds?.length) conditions.push(inArray(igNodes.kind, kinds));
      const rows = await db
        .select()
        .from(igNodes)
        .where(and(...conditions))
        .orderBy(asc(igNodes.kind), asc(igNodes.name));
      return rows.map(toNode);
    },

    async deleteNode(workspaceId, nodeId) {
      await db.delete(igNodes).where(and(eq(igNodes.workspaceId, workspaceId), eq(igNodes.id, nodeId)));
    },

    async connect(workspaceId, input) {
      await db
        .insert(igEdges)
        .values({
          workspaceId,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          kind: input.kind,
          weight: input.weight ?? 1,
          evidence: input.evidence ?? {},
        })
        .onConflictDoUpdate({
          target: [igEdges.fromNodeId, igEdges.toNodeId, igEdges.kind],
          set: { weight: input.weight ?? 1, evidence: input.evidence ?? {} },
        });
    },

    async disconnect(workspaceId, fromNodeId, toNodeId, kind) {
      await db
        .delete(igEdges)
        .where(
          and(
            eq(igEdges.workspaceId, workspaceId),
            eq(igEdges.fromNodeId, fromNodeId),
            eq(igEdges.toNodeId, toNodeId),
            eq(igEdges.kind, kind),
          ),
        );
    },

    async edgesFor(workspaceId, nodeId) {
      return db
        .select({
          fromNodeId: igEdges.fromNodeId,
          toNodeId: igEdges.toNodeId,
          kind: igEdges.kind,
          weight: igEdges.weight,
        })
        .from(igEdges)
        .where(
          and(
            eq(igEdges.workspaceId, workspaceId),
            or(eq(igEdges.fromNodeId, nodeId), eq(igEdges.toNodeId, nodeId)),
          ),
        ) as never;
    },

    async setCapability(workspaceId, nodeId, input) {
      await db
        .insert(capabilities)
        .values({
          nodeId,
          workspaceId,
          taxonomyKey: input.taxonomyKey,
          maturity: input.maturity,
          evidenceStrength: input.evidenceStrength ?? 0.6,
          notes: input.notes ?? null,
          lastVerifiedAt: input.lastVerifiedAt ?? null,
        })
        .onConflictDoUpdate({
          target: capabilities.nodeId,
          set: {
            taxonomyKey: input.taxonomyKey,
            maturity: input.maturity,
            evidenceStrength: input.evidenceStrength ?? 0.6,
            notes: input.notes ?? null,
            lastVerifiedAt: input.lastVerifiedAt ?? null,
          },
        });
    },

    async listCapabilities(workspaceId) {
      const rows = await db
        .select({
          nodeId: capabilities.nodeId,
          name: igNodes.name,
          taxonomyKey: capabilities.taxonomyKey,
          maturity: capabilities.maturity,
          evidenceStrength: capabilities.evidenceStrength,
          lastVerifiedAt: capabilities.lastVerifiedAt,
          notes: capabilities.notes,
        })
        .from(capabilities)
        .innerJoin(igNodes, eq(capabilities.nodeId, igNodes.id))
        .where(eq(capabilities.workspaceId, workspaceId))
        .orderBy(asc(capabilities.taxonomyKey));

      if (rows.length === 0) return [];

      // The assets that actually provide each capability, so the explanation can
      // name them rather than asserting an advantage in the abstract.
      const providers = await db
        .select({
          capabilityNodeId: igEdges.toNodeId,
          assetName: igNodes.name,
          reuseReadiness: assets.reuseReadiness,
        })
        .from(igEdges)
        .innerJoin(igNodes, eq(igEdges.fromNodeId, igNodes.id))
        .leftJoin(assets, eq(assets.nodeId, igNodes.id))
        .where(
          and(
            eq(igEdges.workspaceId, workspaceId),
            eq(igEdges.kind, 'provides_capability'),
            inArray(
              igEdges.toNodeId,
              rows.map((row) => row.nodeId),
            ),
          ),
        );

      // Readiness order, best last: a capability is as reusable as its readiest
      // implementation, not its average one.
      const READINESS_ORDER: ReuseReadiness[] = ['concept', 'needs_work', 'lift_and_shift', 'drop_in'];

      const assetsBy = new Map<string, string[]>();
      const readinessBy = new Map<string, ReuseReadiness>();

      for (const provider of providers) {
        const list = assetsBy.get(provider.capabilityNodeId) ?? [];
        list.push(provider.assetName);
        assetsBy.set(provider.capabilityNodeId, list);

        if (!provider.reuseReadiness) continue;
        const current = readinessBy.get(provider.capabilityNodeId);
        if (
          !current ||
          READINESS_ORDER.indexOf(provider.reuseReadiness) > READINESS_ORDER.indexOf(current)
        ) {
          readinessBy.set(provider.capabilityNodeId, provider.reuseReadiness);
        }
      }

      return rows.map(
        (row): CapabilityRow => ({
          ...row,
          assetNames: assetsBy.get(row.nodeId) ?? [],
          reuseReadiness: readinessBy.get(row.nodeId) ?? null,
        }),
      );
    },

    async setAsset(workspaceId, nodeId, input) {
      await db
        .insert(assets)
        .values({
          nodeId,
          workspaceId,
          assetKind: input.assetKind,
          reuseReadiness: input.reuseReadiness,
          licence: input.licence ?? null,
          sizeEstimate: input.sizeEstimate ?? null,
          location: input.location ?? null,
          lastChangeAt: input.lastChangeAt ?? null,
        })
        .onConflictDoUpdate({
          target: assets.nodeId,
          set: {
            assetKind: input.assetKind,
            reuseReadiness: input.reuseReadiness,
            licence: input.licence ?? null,
            sizeEstimate: input.sizeEstimate ?? null,
            location: input.location ?? null,
            lastChangeAt: input.lastChangeAt ?? null,
          },
        });
    },

    async listAssets(workspaceId) {
      return db
        .select({
          nodeId: assets.nodeId,
          name: igNodes.name,
          assetKind: assets.assetKind,
          reuseReadiness: assets.reuseReadiness,
          licence: assets.licence,
          sizeEstimate: assets.sizeEstimate,
          lastChangeAt: assets.lastChangeAt,
          location: assets.location,
        })
        .from(assets)
        .innerJoin(igNodes, eq(assets.nodeId, igNodes.id))
        .where(eq(assets.workspaceId, workspaceId))
        .orderBy(asc(igNodes.name)) as unknown as Promise<AssetRow[]>;
    },

    async setResource(workspaceId, nodeId, input) {
      await db
        .insert(resources)
        .values({
          nodeId,
          workspaceId,
          resourceKind: input.resourceKind,
          amount: input.amount,
          unit: input.unit,
          period: input.period ?? 'month',
          committed: input.committed ?? 0,
        })
        .onConflictDoUpdate({
          target: resources.nodeId,
          set: {
            resourceKind: input.resourceKind,
            amount: input.amount,
            unit: input.unit,
            period: input.period ?? 'month',
            committed: input.committed ?? 0,
          },
        });
    },

    async listResources(workspaceId) {
      return db
        .select({
          nodeId: resources.nodeId,
          name: igNodes.name,
          resourceKind: resources.resourceKind,
          amount: resources.amount,
          unit: resources.unit,
          period: resources.period,
          committed: resources.committed,
        })
        .from(resources)
        .innerJoin(igNodes, eq(resources.nodeId, igNodes.id))
        .where(eq(resources.workspaceId, workspaceId)) as unknown as Promise<ResourceRow[]>;
    },

    async setGoal(workspaceId, nodeId, input) {
      await db
        .insert(goals)
        .values({
          nodeId,
          workspaceId,
          horizon: input.horizon ?? 'quarter',
          priority: input.priority ?? 1,
          metric: input.metric ?? null,
          target: input.target ?? null,
          weightHints: input.weightHints ?? {},
        })
        .onConflictDoUpdate({
          target: goals.nodeId,
          set: {
            horizon: input.horizon ?? 'quarter',
            priority: input.priority ?? 1,
            metric: input.metric ?? null,
            target: input.target ?? null,
            weightHints: input.weightHints ?? {},
          },
        });
    },

    async listGoals(workspaceId) {
      return db
        .select({
          nodeId: goals.nodeId,
          name: igNodes.name,
          horizon: goals.horizon,
          priority: goals.priority,
          metric: goals.metric,
          target: goals.target,
          weightHints: goals.weightHints,
        })
        .from(goals)
        .innerJoin(igNodes, eq(goals.nodeId, igNodes.id))
        .where(eq(goals.workspaceId, workspaceId))
        .orderBy(asc(goals.priority)) as unknown as Promise<GoalRow[]>;
    },

    async setConstraint(workspaceId, nodeId, input) {
      await db
        .insert(constraints)
        .values({
          nodeId,
          workspaceId,
          constraintKind: input.constraintKind,
          hard: input.hard,
          expression: input.expression ?? {},
          description: input.description,
        })
        .onConflictDoUpdate({
          target: constraints.nodeId,
          set: {
            constraintKind: input.constraintKind,
            hard: input.hard,
            expression: input.expression ?? {},
            description: input.description,
          },
        });
    },

    async listConstraints(workspaceId) {
      return db
        .select({
          nodeId: constraints.nodeId,
          name: igNodes.name,
          constraintKind: constraints.constraintKind,
          hard: constraints.hard,
          expression: constraints.expression,
          description: constraints.description,
        })
        .from(constraints)
        .innerJoin(igNodes, eq(constraints.nodeId, igNodes.id))
        .where(eq(constraints.workspaceId, workspaceId)) as unknown as Promise<ConstraintRow[]>;
    },
  };
}

export function createExecutionHistoryRepository(db: Executor): ExecutionHistoryRepository {
  return {
    async record(workspaceId, input) {
      const [row] = await db
        .insert(executionHistory)
        .values({ ...input, workspaceId })
        .returning();
      if (!row) throw new Error('record execution history returned no row');
      return row as ExecutionHistoryRow;
    },

    async list(workspaceId, limit = 50) {
      return db
        .select()
        .from(executionHistory)
        .where(eq(executionHistory.workspaceId, workspaceId))
        .orderBy(sql`${executionHistory.recordedAt} desc`)
        .limit(limit) as unknown as Promise<ExecutionHistoryRow[]>;
    },

    async forOpportunity(workspaceId, opportunityId) {
      return db
        .select()
        .from(executionHistory)
        .where(
          and(
            eq(executionHistory.workspaceId, workspaceId),
            eq(executionHistory.opportunityId, opportunityId),
          ),
        ) as unknown as Promise<ExecutionHistoryRow[]>;
    },
  };
}
