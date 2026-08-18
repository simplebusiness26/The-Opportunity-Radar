import type { z } from 'zod';
import {
  actualCost,
  estimateCost,
  govern,
  periodKeys,
  readBudget,
  type AiRole,
  type BudgetStatus,
} from '../domain/budget/index';
import type { Clock } from '../ports/clock';
import type { AIProvider } from '../ports/ai';
import { ProviderTransientError, ProviderUnavailable } from '../ports/ai';
import type { Repositories } from '../ports/repositories/index';
import type { AiModelRow } from '../ports/repositories/ai';
import type { AssembledPrompt } from './prompts/assembler';
import type { SchemaDefinition } from './schemas/base';
import { callStructured, StructuredOutputError } from './structured-call';

/**
 * The single door every AI call goes through.
 *
 * Nothing calls a provider directly. Routing, budget reservation, fallback and
 * the ledger all live here, so there is exactly one place where money can be
 * spent and exactly one place that has to be correct for the budget to hold.
 */

export interface GatewayDeps {
  repos: Repositories;
  clock: Clock;
  /** Resolves a configured provider row into something callable. */
  providerFor(workspaceId: string, providerId: string): Promise<AIProvider>;
}

export interface GatewayRequest<T extends z.ZodTypeAny> {
  workspaceId: string;
  role: AiRole;
  prompt: AssembledPrompt;
  schema: SchemaDefinition<T>;
  promptKey: string;
  promptVersion: string;
  /** Optional work is the first thing dropped when money is short. */
  optional?: boolean;
  valueOfInformation?: number;
  subjectType?: string;
  subjectId?: string;
  jobId?: string;
  runId?: string;
}

export type GatewayOutcome<T> =
  | { ok: true; value: T; aiCallId: string; costUsd: number; status: 'ok' | 'repaired'; injectionAttempts: string[] }
  | { ok: false; reason: 'not_configured'; message: string; remedy: string }
  | { ok: false; reason: 'budget'; message: string; status: BudgetStatus }
  | { ok: false; reason: 'invalid_output'; message: string; issues: string[] }
  | { ok: false; reason: 'provider_error'; message: string };

export class BudgetExceeded extends Error {
  readonly status: BudgetStatus;
  constructor(message: string, status: BudgetStatus) {
    super(message);
    this.name = 'BudgetExceeded';
    this.status = status;
  }
}

export async function callAi<T extends z.ZodTypeAny>(
  deps: GatewayDeps,
  request: GatewayRequest<T>,
): Promise<GatewayOutcome<z.infer<T>>> {
  const now = deps.clock.now();

  const routes = await deps.repos.ai.routes(request.workspaceId);
  const route = routes.find((entry) => entry.role === request.role);
  if (!route?.primaryModelId) {
    return {
      ok: false,
      reason: 'not_configured',
      message: `No model is assigned to the ${request.role.replace(/_/g, ' ')} role.`,
      remedy: 'Assign one in Settings → AI. Radar continues to work in manual mode without it.',
    };
  }

  const status = await readBudgetStatus(deps, request.workspaceId, now);
  const decision = govern(status, {
    role: request.role,
    optional: request.optional ?? false,
    valueOfInformation: request.valueOfInformation,
  });

  if (!decision.allowed) {
    // Recorded even though nothing was spent, so the ledger shows what the
    // budget prevented rather than the work simply vanishing.
    await deps.repos.ai.recordCall(
      request.workspaceId,
      {
        role: request.role,
        providerId: null,
        modelId: null,
        modelKey: 'none',
        requestHash: request.prompt.hash,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        costUsd: 0,
        costEstimated: true,
        latencyMs: null,
        status: 'blocked_by_budget',
        attempt: 1,
        errorCode: status.posture,
        subjectType: request.subjectType ?? null,
        subjectId: request.subjectId ?? null,
        jobId: request.jobId ?? null,
      },
      now,
    );

    return { ok: false, reason: 'budget', message: decision.reason, status };
  }

  const modelId =
    decision.tier === 'degraded' ? (route.degradedModelId ?? route.primaryModelId) : route.primaryModelId;

  const model = await deps.repos.ai.findModel(request.workspaceId, modelId);
  if (!model) {
    return {
      ok: false,
      reason: 'not_configured',
      message: 'The model assigned to this role no longer exists.',
      remedy: 'Reassign it in Settings → AI.',
    };
  }

  const estimate = estimateCost({
    inputTokens: request.prompt.estimatedInputTokens,
    // Reserving for a possible repair too: a call that repairs must not be able
    // to overshoot the limit that its first attempt fitted inside.
    maxOutputTokens: route.maxOutputTokens * 2,
    inputCostPerMtok: model.inputCostPerMtok,
    outputCostPerMtok: model.outputCostPerMtok,
  });

  const reservation = await reserveBudget(deps, request.workspaceId, estimate.maxCostUsd, now);
  if (!reservation.ok) {
    return {
      ok: false,
      reason: 'budget',
      message:
        'This call would take the workspace past its budget, so it was refused rather than allowed through.',
      status,
    };
  }

  const startedAt = deps.clock.epochMs();

  try {
    const provider = await deps.providerFor(request.workspaceId, model.providerId);

    const result = await runWithFallback(deps, request, {
      provider,
      model,
      route,
      workspaceId: request.workspaceId,
    });

    const cost = actualCost({
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      inputCostPerMtok: result.model.inputCostPerMtok,
      outputCostPerMtok: result.model.outputCostPerMtok,
    });

    const call = await deps.repos.ai.recordCall(
      request.workspaceId,
      {
        role: request.role,
        providerId: result.model.providerId,
        modelId: result.model.id,
        modelKey: result.model.modelKey,
        promptKey: request.promptKey,
        promptVersion: request.promptVersion,
        schemaKey: request.schema.key,
        schemaVersion: request.schema.version,
        jobId: request.jobId ?? null,
        runId: request.runId ?? null,
        subjectType: request.subjectType ?? null,
        subjectId: request.subjectId ?? null,
        requestHash: request.prompt.hash,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedInputTokens: result.usage.cachedInputTokens,
        costUsd: cost,
        // Derived from configured prices, not from a bill. Labelled as such
        // everywhere it is shown.
        costEstimated: true,
        latencyMs: deps.clock.epochMs() - startedAt,
        status: result.status,
        attempt: result.attempts,
        injectionAttempts: result.injectionAttempts,
      },
      now,
    );

    if (reservation.reservationId) {
      await deps.repos.budgets.settle(reservation.reservationId, {
        actualUsd: cost,
        aiCallId: call.id,
      });
    }

    return {
      ok: true,
      value: result.value,
      aiCallId: call.id,
      costUsd: cost,
      status: result.status,
      injectionAttempts: result.injectionAttempts,
    };
  } catch (error) {
    if (reservation.reservationId) await deps.repos.budgets.release(reservation.reservationId);

    if (error instanceof ProviderUnavailable) {
      return { ok: false, reason: 'not_configured', message: error.message, remedy: error.remedy };
    }

    const failureStatus = error instanceof StructuredOutputError ? 'invalid_output' : 'error';

    await deps.repos.ai.recordCall(
      request.workspaceId,
      {
        role: request.role,
        providerId: model.providerId,
        modelId: model.id,
        modelKey: model.modelKey,
        promptKey: request.promptKey,
        promptVersion: request.promptVersion,
        schemaKey: request.schema.key,
        schemaVersion: request.schema.version,
        subjectType: request.subjectType ?? null,
        subjectId: request.subjectId ?? null,
        jobId: request.jobId ?? null,
        requestHash: request.prompt.hash,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        costUsd: 0,
        costEstimated: true,
        latencyMs: deps.clock.epochMs() - startedAt,
        status: failureStatus,
        attempt: 1,
        errorCode: error instanceof Error ? error.name : 'unknown',
      },
      now,
    );

    if (error instanceof StructuredOutputError) {
      return {
        ok: false,
        reason: 'invalid_output',
        message: error.message,
        issues: error.issues,
      };
    }

    return {
      ok: false,
      reason: 'provider_error',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Runs the call, moving to the fallback model on a transient provider failure.
 *
 * Only transient failures fall back. A rejected key or an unknown model will
 * fail identically on the second provider, so retrying there just doubles the
 * latency before reporting the same problem.
 */
async function runWithFallback<T extends z.ZodTypeAny>(
  deps: GatewayDeps,
  request: GatewayRequest<T>,
  context: { provider: AIProvider; model: AiModelRow; route: { fallbackModelId: string | null; maxOutputTokens: number; temperature: number }; workspaceId: string },
) {
  try {
    const result = await callStructured({
      provider: context.provider,
      modelKey: context.model.modelKey,
      prompt: request.prompt,
      schema: request.schema,
      maxOutputTokens: context.route.maxOutputTokens,
      temperature: context.route.temperature,
    });
    return { ...result, model: context.model };
  } catch (error) {
    if (!(error instanceof ProviderTransientError) || !context.route.fallbackModelId) throw error;

    const fallback = await deps.repos.ai.findModel(context.workspaceId, context.route.fallbackModelId);
    if (!fallback) throw error;

    const fallbackProvider = await deps.providerFor(context.workspaceId, fallback.providerId);
    const result = await callStructured({
      provider: fallbackProvider,
      modelKey: fallback.modelKey,
      prompt: request.prompt,
      schema: request.schema,
      maxOutputTokens: context.route.maxOutputTokens,
      temperature: context.route.temperature,
    });
    return { ...result, model: fallback };
  }
}

export async function readBudgetStatus(
  deps: { repos: Repositories },
  workspaceId: string,
  now: Date,
): Promise<BudgetStatus> {
  const keys = periodKeys(now);
  const [configured, ledger] = await Promise.all([
    deps.repos.budgets.listBudgets(workspaceId),
    deps.repos.budgets.ledger(workspaceId, [keys.daily, keys.monthly]),
  ]);

  const monthly = configured.find((budget) => budget.period === 'monthly' && budget.enabled);
  if (!monthly) {
    // No budget set means no limit to enforce. The interface says so rather
    // than implying a cap that does not exist.
    return {
      posture: 'normal',
      usedFraction: 0,
      remainingUsd: Number.POSITIVE_INFINITY,
      explanation: 'No monthly budget is set, so spend is not capped.',
    };
  }

  const row = ledger.find((entry) => entry.periodKey === keys.monthly);

  return readBudget({
    limitUsd: monthly.limitUsd,
    spentUsd: row?.spentUsd ?? 0,
    reservedUsd: row?.reservedUsd ?? 0,
    warnPct: monthly.warnPct,
    degradePct: monthly.degradePct,
    criticalPct: monthly.criticalPct,
  });
}

async function reserveBudget(
  deps: GatewayDeps,
  workspaceId: string,
  amountUsd: number,
  now: Date,
): Promise<{ ok: boolean; reservationId: string | null }> {
  const configured = await deps.repos.budgets.listBudgets(workspaceId);
  const enabled = configured.filter((budget) => budget.enabled);
  if (enabled.length === 0 || amountUsd <= 0) return { ok: true, reservationId: null };

  const keys = periodKeys(now);

  return deps.repos.budgets.reserve(workspaceId, {
    periods: enabled.map((budget) => ({
      key: budget.period === 'daily' ? keys.daily : keys.monthly,
      period: budget.period,
      limitUsd: budget.limitUsd,
    })),
    amountUsd,
    // Long enough for a slow call plus its repair, short enough that a crashed
    // caller's money is not held for the rest of the period.
    expiresAt: new Date(now.getTime() + 10 * 60 * 1000),
  });
}
