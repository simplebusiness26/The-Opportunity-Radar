import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { Executor } from './_ctx';
import {
  aiCallPayloads,
  aiCalls,
  aiModels,
  aiProviders,
  aiRoleRoutes,
  budgetLedger,
  budgetReservations,
  budgets,
} from '../schema/index';
import type {
  AiModelRow,
  AiProviderRow,
  AiRepository,
  AiRouteRow,
  BudgetRepository,
  BudgetRow,
  LedgerRow,
} from '../../../ports/repositories/ai';

const num = (value: string | number | null): number | null =>
  value === null ? null : typeof value === 'number' ? value : Number(value);

export function createAiRepository(db: Executor): AiRepository {
  return {
    async listProviders(workspaceId) {
      const rows = await db
        .select()
        .from(aiProviders)
        .where(eq(aiProviders.workspaceId, workspaceId));
      return rows.map((row) => ({ ...row, health: (row.health ?? {}) as Record<string, unknown> })) as AiProviderRow[];
    },

    async countEnabled(workspaceId) {
      const conditions = [eq(aiProviders.enabled, true)];
      if (workspaceId) conditions.push(eq(aiProviders.workspaceId, workspaceId));
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(aiProviders)
        .where(and(...conditions));
      return rows[0]?.count ?? 0;
    },

    async upsertProvider(workspaceId, input) {
      const [row] = await db
        .insert(aiProviders)
        .values({
          workspaceId,
          kind: input.kind,
          label: input.label,
          baseUrl: input.baseUrl ?? null,
          secretId: input.secretId ?? null,
          enabled: input.enabled ?? false,
        })
        .onConflictDoUpdate({
          target: [aiProviders.workspaceId, aiProviders.label],
          set: {
            kind: input.kind,
            baseUrl: input.baseUrl ?? null,
            secretId: input.secretId ?? null,
            enabled: input.enabled ?? false,
          },
        })
        .returning();
      if (!row) throw new Error('upsertProvider returned no row');
      return { ...row, health: (row.health ?? {}) as Record<string, unknown> } as AiProviderRow;
    },

    async setProviderHealth(providerId, health) {
      await db.update(aiProviders).set({ health }).where(eq(aiProviders.id, providerId));
    },

    async upsertModel(workspaceId, providerId, input) {
      const [row] = await db
        .insert(aiModels)
        .values({
          workspaceId,
          providerId,
          modelKey: input.modelKey,
          label: input.label,
          inputCostPerMtok: input.inputCostPerMtok?.toString() ?? null,
          outputCostPerMtok: input.outputCostPerMtok?.toString() ?? null,
          contextWindow: input.contextWindow ?? null,
          maxOutput: input.maxOutput ?? null,
          enabled: input.enabled ?? true,
        })
        .onConflictDoUpdate({
          target: [aiModels.providerId, aiModels.modelKey],
          set: {
            label: input.label,
            inputCostPerMtok: input.inputCostPerMtok?.toString() ?? null,
            outputCostPerMtok: input.outputCostPerMtok?.toString() ?? null,
            contextWindow: input.contextWindow ?? null,
            maxOutput: input.maxOutput ?? null,
            enabled: input.enabled ?? true,
          },
        })
        .returning();
      if (!row) throw new Error('upsertModel returned no row');
      return toModel(row);
    },

    async listModels(workspaceId) {
      const rows = await db.select().from(aiModels).where(eq(aiModels.workspaceId, workspaceId));
      return rows.map(toModel);
    },

    async findModel(workspaceId, modelId) {
      const rows = await db
        .select()
        .from(aiModels)
        .where(and(eq(aiModels.workspaceId, workspaceId), eq(aiModels.id, modelId)))
        .limit(1);
      return rows[0] ? toModel(rows[0]) : null;
    },

    async routes(workspaceId) {
      const rows = await db
        .select()
        .from(aiRoleRoutes)
        .where(eq(aiRoleRoutes.workspaceId, workspaceId));
      return rows as unknown as AiRouteRow[];
    },

    async setRoute(workspaceId, role, input) {
      await db
        .insert(aiRoleRoutes)
        .values({
          workspaceId,
          role,
          primaryModelId: input.primaryModelId ?? null,
          fallbackModelId: input.fallbackModelId ?? null,
          degradedModelId: input.degradedModelId ?? null,
          maxOutputTokens: input.maxOutputTokens ?? 2048,
          temperature: input.temperature ?? 0,
        })
        .onConflictDoUpdate({
          target: [aiRoleRoutes.workspaceId, aiRoleRoutes.role],
          set: {
            primaryModelId: input.primaryModelId ?? null,
            fallbackModelId: input.fallbackModelId ?? null,
            degradedModelId: input.degradedModelId ?? null,
            maxOutputTokens: input.maxOutputTokens ?? 2048,
            temperature: input.temperature ?? 0,
          },
        });
    },

    async recordCall(workspaceId, record, now) {
      const [row] = await db
        .insert(aiCalls)
        .values({
          workspaceId,
          role: record.role,
          providerId: record.providerId,
          modelId: record.modelId,
          modelKey: record.modelKey,
          promptKey: record.promptKey ?? null,
          promptVersion: record.promptVersion ?? null,
          schemaKey: record.schemaKey ?? null,
          schemaVersion: record.schemaVersion ?? null,
          jobId: record.jobId ?? null,
          runId: record.runId ?? null,
          subjectType: record.subjectType ?? null,
          subjectId: record.subjectId ?? null,
          requestHash: record.requestHash,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          cachedInputTokens: record.cachedInputTokens,
          costUsd: record.costUsd.toFixed(6),
          costEstimated: record.costEstimated,
          latencyMs: record.latencyMs,
          status: record.status,
          attempt: record.attempt,
          errorCode: record.errorCode ?? null,
          injectionAttempts: record.injectionAttempts ?? [],
          createdAt: now,
        })
        .returning({ id: aiCalls.id });
      if (!row) throw new Error('recordCall returned no row');
      return row;
    },

    async savePayload(aiCallId, request, response) {
      await db
        .insert(aiCallPayloads)
        .values({ aiCallId, request, response })
        .onConflictDoNothing();
    },

    async spendSummary(workspaceId, since) {
      return db
        .select({
          role: aiCalls.role,
          calls: sql<number>`count(*)::int`,
          inputTokens: sql<number>`coalesce(sum(${aiCalls.inputTokens}), 0)::int`,
          outputTokens: sql<number>`coalesce(sum(${aiCalls.outputTokens}), 0)::int`,
          costUsd: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)::float8`,
        })
        .from(aiCalls)
        .where(and(eq(aiCalls.workspaceId, workspaceId), gte(aiCalls.createdAt, since)))
        .groupBy(aiCalls.role) as never;
    },

    async spendBySubject(workspaceId, subjectType, since) {
      return db
        .select({
          subjectId: aiCalls.subjectId,
          calls: sql<number>`count(*)::int`,
          costUsd: sql<number>`coalesce(sum(${aiCalls.costUsd}), 0)::float8`,
        })
        .from(aiCalls)
        .where(
          and(
            eq(aiCalls.workspaceId, workspaceId),
            eq(aiCalls.subjectType, subjectType),
            gte(aiCalls.createdAt, since),
          ),
        )
        .groupBy(aiCalls.subjectId) as never;
    },

    async recentCalls(workspaceId, limit = 50) {
      const rows = await db
        .select()
        .from(aiCalls)
        .where(eq(aiCalls.workspaceId, workspaceId))
        .orderBy(desc(aiCalls.createdAt))
        .limit(limit);
      return rows.map((row) => ({
        ...row,
        costUsd: Number(row.costUsd),
        injectionAttempts: (row.injectionAttempts ?? []) as string[],
      })) as never;
    },
  };
}

function toModel(row: typeof aiModels.$inferSelect): AiModelRow {
  return {
    id: row.id,
    providerId: row.providerId,
    modelKey: row.modelKey,
    label: row.label,
    inputCostPerMtok: num(row.inputCostPerMtok),
    outputCostPerMtok: num(row.outputCostPerMtok),
    contextWindow: row.contextWindow,
    maxOutput: row.maxOutput,
    enabled: row.enabled,
  };
}

export function createBudgetRepository(db: Executor): BudgetRepository {
  return {
    async listBudgets(workspaceId) {
      const rows = await db.select().from(budgets).where(eq(budgets.workspaceId, workspaceId));
      return rows.map(
        (row): BudgetRow => ({
          period: row.period,
          limitUsd: Number(row.limitUsd),
          warnPct: row.warnPct,
          degradePct: row.degradePct,
          criticalPct: row.criticalPct,
          enabled: row.enabled,
        }),
      );
    },

    async setBudget(workspaceId, input) {
      await db
        .insert(budgets)
        .values({
          workspaceId,
          period: input.period,
          limitUsd: input.limitUsd.toFixed(2),
          warnPct: input.warnPct ?? 0.7,
          degradePct: input.degradePct ?? 0.85,
          criticalPct: input.criticalPct ?? 0.95,
          enabled: input.enabled ?? true,
        })
        .onConflictDoUpdate({
          target: [budgets.workspaceId, budgets.period],
          set: {
            limitUsd: input.limitUsd.toFixed(2),
            warnPct: input.warnPct ?? 0.7,
            degradePct: input.degradePct ?? 0.85,
            criticalPct: input.criticalPct ?? 0.95,
            enabled: input.enabled ?? true,
          },
        });
    },

    async ledger(workspaceId, keys) {
      if (keys.length === 0) return [];
      const rows = await db
        .select()
        .from(budgetLedger)
        .where(and(eq(budgetLedger.workspaceId, workspaceId), inArray(budgetLedger.periodKey, keys)));
      return rows.map(
        (row): LedgerRow => ({
          periodKey: row.periodKey,
          period: row.period,
          spentUsd: Number(row.spentUsd),
          reservedUsd: Number(row.reservedUsd),
        }),
      );
    },

    async reserve(workspaceId, input) {
      const amount = input.amountUsd.toFixed(6);

      // Ensure a ledger row exists for every period before the conditional
      // update; without it the first call of a period would find nothing to
      // update and be refused.
      for (const period of input.periods) {
        await db
          .insert(budgetLedger)
          .values({ workspaceId, periodKey: period.key, period: period.period })
          .onConflictDoNothing();
      }

      const claimed: string[] = [];

      for (const period of input.periods) {
        /*
         * The check and the increment are one statement. Two concurrent callers
         * cannot both read the same headroom and both proceed, which is exactly
         * the race that would let a budget be exceeded.
         */
        const result = await db.execute<{ id: string }>(sql`
          update ${budgetLedger}
             set reserved_usd = reserved_usd + ${amount}::numeric,
                 updated_at = now()
           where workspace_id = ${workspaceId}
             and period_key = ${period.key}
             and spent_usd + reserved_usd + ${amount}::numeric <= ${period.limitUsd.toFixed(6)}::numeric
          returning id
        `);

        if (result.rows.length === 0) {
          // Roll back the periods already claimed, so a partial reservation
          // never leaves money committed against work that will not happen.
          for (const key of claimed) {
            await db.execute(sql`
              update ${budgetLedger}
                 set reserved_usd = greatest(0, reserved_usd - ${amount}::numeric)
               where workspace_id = ${workspaceId} and period_key = ${key}
            `);
          }
          return { ok: false, reservationId: null };
        }

        claimed.push(period.key);
      }

      const [reservation] = await db
        .insert(budgetReservations)
        .values({
          workspaceId,
          periodKeys: input.periods.map((period) => period.key),
          amountUsd: amount,
          expiresAt: input.expiresAt,
        })
        .returning({ id: budgetReservations.id });

      return { ok: true, reservationId: reservation?.id ?? null };
    },

    async settle(reservationId, input) {
      const rows = await db
        .select()
        .from(budgetReservations)
        .where(eq(budgetReservations.id, reservationId))
        .limit(1);

      const reservation = rows[0];
      if (!reservation || reservation.settledAt) return;

      const reserved = Number(reservation.amountUsd).toFixed(6);
      const actual = input.actualUsd.toFixed(6);

      for (const key of reservation.periodKeys as string[]) {
        await db.execute(sql`
          update ${budgetLedger}
             set spent_usd = spent_usd + ${actual}::numeric,
                 reserved_usd = greatest(0, reserved_usd - ${reserved}::numeric),
                 updated_at = now()
           where workspace_id = ${reservation.workspaceId} and period_key = ${key}
        `);
      }

      await db
        .update(budgetReservations)
        .set({ settledAt: new Date(reservation.expiresAt), aiCallId: input.aiCallId })
        .where(eq(budgetReservations.id, reservationId));
    },

    async release(reservationId) {
      const rows = await db
        .select()
        .from(budgetReservations)
        .where(eq(budgetReservations.id, reservationId))
        .limit(1);

      const reservation = rows[0];
      if (!reservation || reservation.settledAt) return;

      const reserved = Number(reservation.amountUsd).toFixed(6);
      for (const key of reservation.periodKeys as string[]) {
        await db.execute(sql`
          update ${budgetLedger}
             set reserved_usd = greatest(0, reserved_usd - ${reserved}::numeric), updated_at = now()
           where workspace_id = ${reservation.workspaceId} and period_key = ${key}
        `);
      }

      await db.delete(budgetReservations).where(eq(budgetReservations.id, reservationId));
    },

    async sweepExpired(now) {
      const expired = await db
        .select()
        .from(budgetReservations)
        .where(and(sql`${budgetReservations.settledAt} is null`, sql`${budgetReservations.expiresAt} < ${now}`))
        .limit(500);

      for (const reservation of expired) {
        const reserved = Number(reservation.amountUsd).toFixed(6);
        for (const key of reservation.periodKeys as string[]) {
          await db.execute(sql`
            update ${budgetLedger}
               set reserved_usd = greatest(0, reserved_usd - ${reserved}::numeric), updated_at = now()
             where workspace_id = ${reservation.workspaceId} and period_key = ${key}
          `);
        }
        await db.delete(budgetReservations).where(eq(budgetReservations.id, reservation.id));
      }

      return expired.length;
    },
  };
}
