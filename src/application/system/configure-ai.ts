import { z } from 'zod';
import { errors } from '../../domain/types/errors';
import type { ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Clock } from '../../ports/clock';
import type { SecretBox } from '../../ports/secret-box';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { AiRole } from '../../domain/budget/index';

export interface ConfigureAiDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
  secretBox: SecretBox;
}

export const connectProviderInput = z.object({
  kind: z.enum(['openai', 'anthropic', 'gemini', 'openai_compatible']),
  label: z.string().trim().min(2).max(80),
  apiKey: z.string().trim().min(8).max(500),
  baseUrl: z.string().url().max(500).optional().nullable(),
  models: z
    .array(
      z.object({
        modelKey: z.string().trim().min(1).max(120),
        label: z.string().trim().min(1).max(120),
        /**
         * Supplied by the owner from the provider's own pricing page. Radar
         * never guesses a price: an unverified cost figure would be a
         * fabricated metric, and the interface would rather say "unknown".
         */
        inputCostPerMtok: z.number().min(0).max(10_000).optional().nullable(),
        outputCostPerMtok: z.number().min(0).max(10_000).optional().nullable(),
        contextWindow: z.number().int().min(1).optional().nullable(),
        maxOutput: z.number().int().min(1).optional().nullable(),
      }),
    )
    .max(20)
    .default([]),
});

export type ConnectProviderInput = z.infer<typeof connectProviderInput>;

/**
 * Connects a provider.
 *
 * The key is sealed before it touches the database and never leaves again: the
 * API exposes only whether a value exists and a four-character hint.
 */
export async function connectProvider(
  deps: ConfigureAiDeps,
  ctx: ActorCtx,
  input: ConnectProviderInput,
): Promise<{ providerId: string; modelIds: string[] }> {
  if (!can(ctx, 'ai.configure')) throw errors.forbidden('ai.configure');
  if (!can(ctx, 'secrets.write')) throw errors.forbidden('secrets.write');

  const parsed = connectProviderInput.parse(input);

  return deps.tx.transaction(async (repos) => {
    const sealed = deps.secretBox.seal(parsed.apiKey);
    const secret = await repos.secrets.put(ctx.workspaceId, {
      kind: 'ai_provider',
      name: parsed.label,
      sealed,
    });

    const provider = await repos.ai.upsertProvider(ctx.workspaceId, {
      kind: parsed.kind,
      label: parsed.label,
      baseUrl: parsed.baseUrl ?? null,
      secretId: secret.id,
      enabled: true,
    });

    const modelIds: string[] = [];
    for (const model of parsed.models) {
      const created = await repos.ai.upsertModel(ctx.workspaceId, provider.id, model);
      modelIds.push(created.id);
    }

    await repos.audit.record(ctx, {
      action: 'ai.provider_connected',
      entityType: 'ai_provider',
      entityId: provider.id,
      // The key itself is never written to the audit log, only its shape.
      after: { kind: parsed.kind, label: parsed.label, models: parsed.models.length, keyHint: sealed.hint },
    });

    return { providerId: provider.id, modelIds };
  });
}

export const setRouteInput = z.object({
  role: z.enum([
    'cheap_extraction',
    'classification',
    'research',
    'reasoning',
    'high_value_decision',
    'embedding',
  ]),
  primaryModelId: z.string().uuid().nullable(),
  fallbackModelId: z.string().uuid().nullable().optional(),
  degradedModelId: z.string().uuid().nullable().optional(),
  maxOutputTokens: z.number().int().min(64).max(32_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
});

export async function setRoleRoute(
  deps: ConfigureAiDeps,
  ctx: ActorCtx,
  input: z.infer<typeof setRouteInput>,
): Promise<void> {
  if (!can(ctx, 'ai.configure')) throw errors.forbidden('ai.configure');
  const parsed = setRouteInput.parse(input);

  await deps.tx.transaction(async (repos) => {
    await repos.ai.setRoute(ctx.workspaceId, parsed.role as AiRole, parsed);
    await repos.audit.record(ctx, {
      action: 'ai.route_changed',
      entityType: 'ai_role_route',
      after: parsed,
    });
  });
}

export const setBudgetInput = z.object({
  period: z.enum(['daily', 'monthly']),
  limitUsd: z.number().min(0).max(1_000_000),
  warnPct: z.number().min(0.1).max(0.99).optional(),
  degradePct: z.number().min(0.1).max(0.99).optional(),
  criticalPct: z.number().min(0.1).max(0.999).optional(),
  enabled: z.boolean().optional(),
});

/**
 * Sets a spend limit.
 *
 * Raising a limit is audited specifically, because it is the only route past a
 * hard stop and therefore the one action that can turn a refusal into spend.
 */
export async function setBudget(
  deps: ConfigureAiDeps,
  ctx: ActorCtx,
  input: z.infer<typeof setBudgetInput>,
): Promise<void> {
  if (!can(ctx, 'budget.configure')) throw errors.forbidden('budget.configure');
  const parsed = setBudgetInput.parse(input);

  await deps.tx.transaction(async (repos) => {
    const existing = (await repos.budgets.listBudgets(ctx.workspaceId)).find(
      (budget) => budget.period === parsed.period,
    );

    await repos.budgets.setBudget(ctx.workspaceId, parsed);

    await repos.audit.record(ctx, {
      action:
        existing && parsed.limitUsd > existing.limitUsd ? 'budget.raised' : 'budget.set',
      entityType: 'budget',
      before: existing ? { limitUsd: existing.limitUsd } : null,
      after: { period: parsed.period, limitUsd: parsed.limitUsd },
    });
  });
}
