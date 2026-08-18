import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import {
  experimentContacts,
  experimentResults,
  experimentTransitions,
  experiments,
  investigationOutputs,
  investigations,
  uncertaintyItems,
  validationPlans,
} from '../schema/index';
import type {
  ExperimentRow,
  InvestigationOutputRow,
  InvestigationRepository,
  InvestigationRow,
  UncertaintyRepository,
  UncertaintyRow,
  ValidationPlanRow,
  ValidationRepository,
} from '../../../ports/repositories/investigation';

export function createInvestigationRepository(db: Executor): InvestigationRepository {
  return {
    async start(workspaceId, input, now) {
      const [row] = await db
        .insert(investigations)
        .values({
          workspaceId,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          roleKey: input.roleKey,
          state: 'running',
          budgetCapUsd: input.budgetCapUsd.toFixed(4),
          jobId: input.jobId ?? null,
          startedAt: now,
        })
        .returning();
      if (!row) throw new Error('start investigation returned no row');
      return { ...row, spentUsd: Number(row.spentUsd) } as InvestigationRow;
    },

    async finish(investigationId, input, now) {
      await db
        .update(investigations)
        .set({
          state: input.state,
          terminationReason: input.terminationReason,
          spentUsd: input.spentUsd.toFixed(6),
          endedAt: now,
        })
        .where(eq(investigations.id, investigationId));
    },

    async saveOutput(investigationId, input) {
      await db.insert(investigationOutputs).values({ investigationId, ...input });
    },

    async completedRoles(workspaceId, subjectType, subjectId) {
      const rows = await db
        .select({ roleKey: investigations.roleKey })
        .from(investigations)
        .where(
          and(
            eq(investigations.workspaceId, workspaceId),
            eq(investigations.subjectType, subjectType),
            eq(investigations.subjectId, subjectId),
            eq(investigations.state, 'complete'),
          ),
        );
      return [...new Set(rows.map((row) => row.roleKey))];
    },

    async outputsFor(workspaceId, subjectType, subjectId) {
      const rows = await db
        .select({ output: investigationOutputs })
        .from(investigationOutputs)
        .innerJoin(investigations, eq(investigationOutputs.investigationId, investigations.id))
        .where(
          and(
            eq(investigations.workspaceId, workspaceId),
            eq(investigations.subjectType, subjectType),
            eq(investigations.subjectId, subjectId),
          ),
        )
        .orderBy(desc(investigationOutputs.createdAt));

      return rows.map(
        (row): InvestigationOutputRow => ({
          ...row.output,
          payload: (row.output.payload ?? {}) as Record<string, unknown>,
          projectionReport: (row.output.projectionReport ?? {}) as Record<string, unknown>,
        }),
      );
    },

    async listFor(workspaceId, subjectType, subjectId) {
      const rows = await db
        .select()
        .from(investigations)
        .where(
          and(
            eq(investigations.workspaceId, workspaceId),
            eq(investigations.subjectType, subjectType),
            eq(investigations.subjectId, subjectId),
          ),
        )
        .orderBy(asc(investigations.createdAt));
      return rows.map((row) => ({ ...row, spentUsd: Number(row.spentUsd) }) as InvestigationRow);
    },
  };
}

export function createUncertaintyRepository(db: Executor): UncertaintyRepository {
  return {
    async replaceFor(workspaceId, opportunityId, items) {
      // Superseded rather than deleted: a question that was open and has since
      // been dropped is itself part of the record of how thinking changed.
      await db
        .update(uncertaintyItems)
        .set({ status: 'superseded' })
        .where(
          and(
            eq(uncertaintyItems.opportunityId, opportunityId),
            eq(uncertaintyItems.status, 'open'),
          ),
        );

      if (items.length === 0) return;

      await db.insert(uncertaintyItems).values(
        items.map((item) => ({
          workspaceId,
          opportunityId,
          kind: item.kind,
          statement: item.statement,
          impact: item.impact,
          resolvability: item.resolvability,
          costToResolve: item.costToResolve,
          daysToResolve: item.daysToResolve,
          voiScore: item.voiScore,
        })),
      );
    },

    async listFor(workspaceId, opportunityId, options = {}) {
      const conditions = [
        eq(uncertaintyItems.workspaceId, workspaceId),
        eq(uncertaintyItems.opportunityId, opportunityId),
      ];
      if (options.openOnly) conditions.push(eq(uncertaintyItems.status, 'open'));

      const rows = await db
        .select()
        .from(uncertaintyItems)
        .where(and(...conditions))
        .orderBy(desc(uncertaintyItems.voiScore));
      return rows as unknown as UncertaintyRow[];
    },

    async resolve(workspaceId, itemId, resolution) {
      await db
        .update(uncertaintyItems)
        .set({ status: 'resolved', resolution })
        .where(and(eq(uncertaintyItems.workspaceId, workspaceId), eq(uncertaintyItems.id, itemId)));
    },

    async countCritical(workspaceId, opportunityId) {
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(uncertaintyItems)
        .where(
          and(
            eq(uncertaintyItems.workspaceId, workspaceId),
            eq(uncertaintyItems.opportunityId, opportunityId),
            eq(uncertaintyItems.kind, 'critical_unknown'),
            eq(uncertaintyItems.status, 'open'),
          ),
        );
      return rows[0]?.count ?? 0;
    },
  };
}

export function createValidationRepository(db: Executor): ValidationRepository {
  const toPlan = (row: typeof validationPlans.$inferSelect): ValidationPlanRow =>
    ({
      ...row,
      steps: (row.steps ?? []) as string[],
      successThreshold: row.successThreshold as ValidationPlanRow['successThreshold'],
      failureThreshold: row.failureThreshold as ValidationPlanRow['failureThreshold'],
      evidenceToCollect: (row.evidenceToCollect ?? []) as string[],
      doNotBuildYet: (row.doNotBuildYet ?? []) as string[],
    }) as ValidationPlanRow;

  return {
    async savePlan(workspaceId, opportunityId, input) {
      const [row] = await db
        .insert(validationPlans)
        .values({
          workspaceId,
          opportunityId,
          hypothesis: input.hypothesis,
          riskiestAssumptionId: input.riskiestAssumptionId ?? null,
          whyItMatters: input.whyItMatters,
          experimentType: input.experimentType,
          audience: input.audience,
          steps: input.steps,
          estimatedCost: input.estimatedCost,
          estimatedDays: input.estimatedDays,
          successThreshold: input.successThreshold,
          failureThreshold: input.failureThreshold,
          evidenceToCollect: input.evidenceToCollect,
          doNotBuildYet: input.doNotBuildYet,
          createdByUserId: input.createdByUserId ?? null,
        })
        .returning();
      if (!row) throw new Error('savePlan returned no row');
      return toPlan(row);
    },

    async latestPlan(workspaceId, opportunityId) {
      const rows = await db
        .select()
        .from(validationPlans)
        .where(
          and(
            eq(validationPlans.workspaceId, workspaceId),
            eq(validationPlans.opportunityId, opportunityId),
          ),
        )
        .orderBy(desc(validationPlans.createdAt))
        .limit(1);
      return rows[0] ? toPlan(rows[0]) : null;
    },

    async createExperiment(workspaceId, input, now) {
      const [row] = await db
        .insert(experiments)
        .values({
          workspaceId,
          opportunityId: input.opportunityId,
          validationPlanId: input.validationPlanId,
          name: input.name,
          budget: input.budget,
          ownerUserId: input.ownerUserId ?? null,
          demo: input.demo ?? false,
          stateSince: now,
        })
        .returning();
      if (!row) throw new Error('createExperiment returned no row');

      await db.insert(experimentTransitions).values({
        experimentId: row.id,
        fromState: null,
        toState: 'proposed',
        reason: 'Designed from the validation plan.',
        actorKind: 'system',
      });

      return row as ExperimentRow;
    },

    async findExperiment(workspaceId, experimentId) {
      const rows = await db
        .select()
        .from(experiments)
        .where(and(eq(experiments.workspaceId, workspaceId), eq(experiments.id, experimentId)))
        .limit(1);
      return (rows[0] as ExperimentRow | undefined) ?? null;
    },

    async listExperiments(workspaceId, options = {}) {
      const conditions = [eq(experiments.workspaceId, workspaceId)];
      if (options.opportunityId) conditions.push(eq(experiments.opportunityId, options.opportunityId));

      const rows = await db
        .select()
        .from(experiments)
        .where(and(...conditions))
        .orderBy(desc(experiments.createdAt))
        .limit(options.limit ?? 50);
      return rows as ExperimentRow[];
    },

    async transitionExperiment(experimentId, input, now) {
      await db
        .update(experiments)
        .set({
          state: input.toState as ExperimentRow['state'],
          stateSince: now,
          updatedAt: now,
          ...(input.verdict ? { verdict: input.verdict as ExperimentRow['verdict'] } : {}),
          ...(input.conclusion ? { conclusion: input.conclusion } : {}),
          ...(input.toState === 'running' ? { startedAt: now } : {}),
          ...(input.toState === 'completed' || input.toState === 'abandoned' ? { endedAt: now } : {}),
        })
        .where(eq(experiments.id, experimentId));

      await db.insert(experimentTransitions).values({
        experimentId,
        fromState: input.fromState,
        toState: input.toState,
        reason: input.reason,
        actorKind: input.actorKind,
        actorUserId: input.actorUserId,
      });
    },

    async recordResult(experimentId, input, now) {
      await db
        .insert(experimentResults)
        .values({
          experimentId,
          metricKey: input.metricKey,
          value: input.value,
          unit: input.unit ?? null,
          notes: input.notes ?? null,
          recordedByUserId: input.recordedByUserId ?? null,
          recordedAt: now,
        })
        .onConflictDoUpdate({
          target: [experimentResults.experimentId, experimentResults.metricKey],
          set: { value: input.value, notes: input.notes ?? null, recordedAt: now },
        });
    },

    async resultsFor(experimentId) {
      return db
        .select({
          metricKey: experimentResults.metricKey,
          value: experimentResults.value,
          unit: experimentResults.unit,
          notes: experimentResults.notes,
        })
        .from(experimentResults)
        .where(eq(experimentResults.experimentId, experimentId));
    },

    async recordContact(experimentId, input, now) {
      await db.insert(experimentContacts).values({
        experimentId,
        label: input.label,
        outcome: input.outcome,
        notes: input.notes ?? null,
        contactedAt: now,
      });
    },

    async contactsFor(experimentId) {
      return db
        .select({
          label: experimentContacts.label,
          outcome: experimentContacts.outcome,
          notes: experimentContacts.notes,
        })
        .from(experimentContacts)
        .where(eq(experimentContacts.experimentId, experimentId))
        .orderBy(desc(experimentContacts.contactedAt));
    },
  };
}
