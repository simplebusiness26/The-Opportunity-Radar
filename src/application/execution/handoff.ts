import { z } from 'zod';
import { errors } from '../../domain/types/errors';
import { actorKind, actorUserId, type ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import { checkUrl } from '../../domain/net/url-rules';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { HandoffRow } from '../../ports/repositories/execution';
import type { SecretBox } from '../../ports/secret-box';
import { buildExecutionBrief, type BriefDeps } from './brief';

/**
 * Sending work across the boundary.
 *
 * Radar's job ends at "this deserves the next unit of effort, and here is
 * everything known about it". Something else builds it. What crosses is a
 * snapshotted brief, so what the builder was given survives every later edit
 * to the opportunity.
 *
 * Handing over is a decision that commits real resources, so it requires a
 * person with the authority to make it. Radar will say plainly that something
 * is not ready; it will not refuse to let its owner overrule that, and it
 * records the overrule.
 */

export interface HandoffDeps extends BriefDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export const handOffInput = z.object({
  /** Required when the brief says this is not ready. Recorded as an overrule. */
  acknowledgeNotReady: z.boolean().optional(),
  note: z.string().trim().max(2000).optional(),
});

export interface HandoffResult {
  handoff: HandoffRow;
  ready: boolean;
  /** Set when the owner proceeded despite the brief saying otherwise. */
  overruled: string | null;
  /** Where it will be delivered, or null when it is an export only. */
  target: string | null;
}

export async function handOff(
  deps: HandoffDeps,
  ctx: ActorCtx,
  opportunityId: string,
  input: z.infer<typeof handOffInput> = {},
): Promise<HandoffResult> {
  if (!can(ctx, 'opportunities.decide')) {
    throw errors.forbidden(
      'opportunities.decide_denied',
      'Committing work to be built is a decision only an owner can take.',
    );
  }
  const parsed = handOffInput.parse(input);

  const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, opportunityId);
  if (!opportunity) throw errors.notFound('Opportunity');

  const { brief, markdown } = await buildExecutionBrief(deps, ctx, opportunityId);

  if (!brief.readiness.ready && !parsed.acknowledgeNotReady) {
    throw errors.preconditionFailed(
      'handoff.not_ready',
      brief.readiness.reason,
      `${brief.readiness.remedy} To hand it over anyway, confirm explicitly; the overrule is recorded.`,
    );
  }

  const target = await readFactoryTarget(deps.repos, ctx.workspaceId);
  const now = deps.clock.now();
  const overruled = brief.readiness.ready ? null : brief.readiness.reason;

  const handoff = await deps.tx.transaction(async (repos) => {
    const row = await repos.handoffs.create(ctx.workspaceId, {
      opportunityId,
      brief: brief as unknown as Record<string, unknown>,
      briefMarkdown: markdown,
      target,
      createdByUserId: actorUserId(ctx),
    });

    // The lifecycle follows the commitment rather than being updated by hand
    // afterwards. 'execution' is a human-only state, which is why this
    // use-case requires a person.
    if (opportunity.state === 'validated') {
      await repos.opportunities.setState(opportunityId, 'execution', now);
      await repos.opportunities.recordTransition({
        opportunityId,
        fromState: opportunity.state,
        toState: 'execution',
        reason: parsed.note ?? 'Handed over to be built.',
        actorKind: actorKind(ctx),
        actorUserId: actorUserId(ctx),
        evidence: { handoffId: row.id, overruled },
      });
    }

    await repos.decisions.record(ctx.workspaceId, {
      subjectType: 'opportunity',
      subjectId: opportunityId,
      decision: 'handed_off',
      rationale: parsed.note ?? brief.headline,
      radarRecommendation: brief.readiness.ready ? 'ready to build' : 'not ready to build',
      radarConfidence: brief.input.confidence,
      actorUserId: actorUserId(ctx),
      context: { handoffId: row.id, overruled },
    });

    await repos.events.append(ctx.workspaceId, {
      kind: 'opportunity.handed_off',
      subjectType: 'handoff',
      subjectId: row.id,
      payload: { workspace: ctx.workspaceId, handoffId: row.id, opportunityId },
    });

    await repos.audit.record(ctx, {
      action: 'opportunity.handed_off',
      entityType: 'opportunity',
      entityId: opportunityId,
      after: { handoffId: row.id, ready: brief.readiness.ready, target },
    });

    return row;
  });

  return { handoff, ready: brief.readiness.ready, overruled, target };
}

/**
 * Where handoffs are delivered, when the owner has configured somewhere.
 *
 * Validated through the same URL rules as any other outbound request. A
 * configured target that would not survive those rules is treated as absent,
 * because delivering to it would be the SSRF the rules exist to prevent.
 */
export async function readFactoryTarget(
  repos: Repositories,
  workspaceId: string,
): Promise<string | null> {
  const workspace = await repos.tenancy.findWorkspace(workspaceId);
  const factory = (workspace?.settings.factory ?? {}) as { url?: unknown };
  if (typeof factory.url !== 'string' || factory.url.length === 0) return null;

  return checkUrl(factory.url).allowed ? factory.url : null;
}

export const configureFactoryInput = z.object({
  url: z.string().trim().max(2000).nullable(),
  /** Sent as a bearer token, stored encrypted. */
  token: z.string().trim().max(500).nullable().optional(),
});

export async function configureFactory(
  deps: HandoffDeps & { secretBox: SecretBox },
  ctx: ActorCtx,
  input: z.infer<typeof configureFactoryInput>,
): Promise<{ configured: boolean; message: string }> {
  if (!can(ctx, 'workspace.manage')) {
    throw errors.forbidden('workspace.manage_denied', 'Only an owner can configure where work is sent.');
  }
  const parsed = configureFactoryInput.parse(input);

  const workspace = await deps.repos.tenancy.findWorkspace(ctx.workspaceId);
  if (!workspace) throw errors.notFound('Workspace');

  if (parsed.url === null) {
    await deps.repos.tenancy.updateSettings(
      ctx.workspaceId,
      { ...workspace.settings, factory: null },
      deps.clock.now(),
    );
    return { configured: false, message: 'Handoffs will be exported rather than delivered.' };
  }

  const verdict = checkUrl(parsed.url);
  if (!verdict.allowed) {
    throw errors.preconditionFailed('factory.blocked_url', verdict.reason, 'Use an https URL on a public host.');
  }

  let secretId: string | null = null;
  if (parsed.token) {
    const secret = await deps.repos.secrets.put(ctx.workspaceId, {
      kind: 'factory',
      name: 'Handoff bearer token',
      sealed: deps.secretBox.seal(parsed.token),
    });
    secretId = secret.id;
  }

  await deps.repos.tenancy.updateSettings(
    ctx.workspaceId,
    { ...workspace.settings, factory: { url: parsed.url, secretId } },
    deps.clock.now(),
  );

  await deps.repos.audit.record(ctx, {
    action: 'factory.configured',
    entityType: 'workspace',
    entityId: ctx.workspaceId,
    // The URL is recorded; the token never is.
    after: { url: parsed.url, hasToken: Boolean(parsed.token) },
  });

  return { configured: true, message: `Handoffs will be delivered to ${verdict.hostname}.` };
}
