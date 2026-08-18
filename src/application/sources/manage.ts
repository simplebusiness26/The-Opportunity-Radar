import { z } from 'zod';
import { errors } from '../../domain/types/errors';
import type { ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Clock } from '../../ports/clock';
import type { SecretBox } from '../../ports/secret-box';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { SourceAdapter } from '../../ports/source-adapter';

export interface ManageSourceDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
  secretBox: SecretBox;
  adapters: Map<string, SourceAdapter>;
}

export const addSourceInput = z.object({
  adapterKey: z.string().trim().min(1).max(60),
  name: z.string().trim().min(2).max(120),
  config: z.record(z.string(), z.string().max(2000)).default({}),
  pollIntervalSec: z.number().int().min(300).max(86_400).optional(),
  maxItemsPerRun: z.number().int().min(5).max(500).optional(),
  enabled: z.boolean().optional(),
});

export type AddSourceInput = z.infer<typeof addSourceInput>;

export interface AddSourceResult {
  sourceId: string;
  /** Set when the source was added but cannot run yet. */
  configWarning: string | null;
}

/**
 * Adds a source.
 *
 * A source that is missing settings is still created, because half-configuring
 * something and losing it is worse than seeing it listed as incomplete. It
 * shows as unconfigured with the specific remedy attached.
 */
export async function addSource(
  deps: ManageSourceDeps,
  ctx: ActorCtx,
  input: AddSourceInput,
): Promise<AddSourceResult> {
  if (!can(ctx, 'sources.configure')) throw errors.forbidden('sources.configure');
  const parsed = addSourceInput.parse(input);

  const adapter = deps.adapters.get(parsed.adapterKey);
  if (!adapter) {
    throw errors.validation('source.unknown_adapter', `There is no adapter called "${parsed.adapterKey}".`);
  }

  // Secret fields are split out and sealed; the rest stays readable so the
  // interface can show what a source is configured to do.
  const secretField = adapter.manifest.configFields.find((field) => field.secret);
  const config: Record<string, string> = { ...parsed.config };
  let secretValue: string | null = null;

  if (secretField && config[secretField.key]) {
    secretValue = config[secretField.key]!;
    delete config[secretField.key];
  }

  const validation = adapter.validateConfig({
    ...config,
    ...(secretField && secretValue ? { [secretField.key]: secretValue } : {}),
  });

  return deps.tx.transaction(async (repos) => {
    let secretId: string | null = null;
    if (secretValue) {
      const stored = await repos.secrets.put(ctx.workspaceId, {
        kind: 'source',
        name: `${parsed.adapterKey}:${parsed.name}`,
        sealed: deps.secretBox.seal(secretValue),
      });
      secretId = stored.id;
    }

    const source = await repos.sources.create(ctx.workspaceId, {
      adapterKey: parsed.adapterKey,
      name: parsed.name,
      category: adapter.manifest.category,
      config,
      secretId,
      enabled: parsed.enabled ?? true,
      pollIntervalSec: parsed.pollIntervalSec,
      maxItemsPerRun: parsed.maxItemsPerRun,
    });

    await repos.audit.record(ctx, {
      action: 'source.added',
      entityType: 'source',
      entityId: source.id,
      after: { adapterKey: parsed.adapterKey, name: parsed.name, hasCredential: secretId !== null },
    });

    return {
      sourceId: source.id,
      configWarning: validation.ok ? null : `${validation.message} ${validation.remedy}`,
    };
  });
}

export async function setSourceEnabled(
  deps: ManageSourceDeps,
  ctx: ActorCtx,
  sourceId: string,
  enabled: boolean,
): Promise<void> {
  if (!can(ctx, 'sources.configure')) throw errors.forbidden('sources.configure');

  await deps.tx.transaction(async (repos) => {
    await repos.sources.update(ctx.workspaceId, sourceId, { enabled }, deps.clock.now());
    await repos.audit.record(ctx, {
      action: enabled ? 'source.enabled' : 'source.disabled',
      entityType: 'source',
      entityId: sourceId,
    });
  });
}

export async function removeSource(
  deps: ManageSourceDeps,
  ctx: ActorCtx,
  sourceId: string,
): Promise<void> {
  if (!can(ctx, 'sources.configure')) throw errors.forbidden('sources.configure');

  await deps.tx.transaction(async (repos) => {
    const source = await repos.sources.findById(ctx.workspaceId, sourceId);
    if (!source) throw errors.notFound('Source');

    await repos.sources.remove(ctx.workspaceId, sourceId);
    await repos.audit.record(ctx, {
      action: 'source.removed',
      entityType: 'source',
      entityId: sourceId,
      before: { name: source.name, adapterKey: source.adapterKey },
    });
  });
}

export interface SourceView {
  id: string;
  name: string;
  adapterKey: string;
  adapterName: string;
  category: string;
  enabled: boolean;
  status: string;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  itemsLastRun: number;
  message: string | null;
  remedy: string | null;
  consecutiveFailures: number;
  /** True when this adapter can run with no credentials at all. */
  needsNoCredentials: boolean;
}

/** Every source with its live health, for the source health screen. */
export async function listSourcesWithHealth(
  deps: ManageSourceDeps,
  ctx: ActorCtx,
): Promise<SourceView[]> {
  if (!can(ctx, 'workspace.read')) throw errors.forbidden('workspace.read');

  const [sources, states] = await Promise.all([
    deps.repos.sources.list(ctx.workspaceId),
    deps.repos.sources.statesFor(ctx.workspaceId),
  ]);

  const stateBy = new Map(states.map((state) => [state.sourceId, state]));

  return sources.map((source) => {
    const adapter = deps.adapters.get(source.adapterKey);
    const state = stateBy.get(source.id);

    return {
      id: source.id,
      name: source.name,
      adapterKey: source.adapterKey,
      adapterName: adapter?.manifest.name ?? source.adapterKey,
      category: source.category,
      enabled: source.enabled,
      status: source.enabled ? (state?.status ?? 'not_configured') : 'disabled',
      lastRunAt: state?.lastRunAt ?? null,
      lastSuccessAt: state?.lastSuccessAt ?? null,
      itemsLastRun: state?.itemsLastRun ?? 0,
      message: state?.lastMessage ?? null,
      remedy: state?.lastRemedy ?? null,
      consecutiveFailures: state?.consecutiveFailures ?? 0,
      needsNoCredentials:
        adapter?.manifest.configFields.every((field) => !field.secret || !field.required) ?? false,
    };
  });
}
