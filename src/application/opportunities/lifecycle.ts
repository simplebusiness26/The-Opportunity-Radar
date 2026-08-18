import { z } from 'zod';
import {
  OPPORTUNITY_STATE_KEYS,
  allowedTransitions,
  evaluateTransition,
  type OpportunityState,
} from '../../domain/state/opportunity-state';
import { OPPORTUNITY_TYPE_KEYS } from '../../domain/taxonomy/opportunity-types';
import { errors } from '../../domain/types/errors';
import { actorKind, actorUserId, type ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { OpportunityRow } from '../../ports/repositories/opportunities';

export interface LifecycleDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export const createOpportunityInput = z.object({
  title: z.string().trim().min(3).max(200),
  thesis: z.string().trim().min(10, 'State what you believe and why.').max(5000),
  typeKey: z.enum(OPPORTUNITY_TYPE_KEYS as [string, ...string[]]),
  clusterId: z.string().uuid().optional().nullable(),
  targetCustomer: z.string().trim().max(300).optional().nullable(),
  problemStatement: z.string().trim().max(2000).optional().nullable(),
  whyNow: z.string().trim().max(2000).optional().nullable(),
  /** Evidence to attach at creation, so a new opportunity is never empty. */
  evidenceUnitIds: z.array(z.string().uuid()).max(200).optional(),
  demo: z.boolean().optional(),
});

export type CreateOpportunityInput = z.infer<typeof createOpportunityInput>;

export async function createOpportunity(
  deps: LifecycleDeps,
  ctx: ActorCtx,
  input: CreateOpportunityInput,
): Promise<OpportunityRow> {
  if (!can(ctx, 'opportunities.write')) {
    throw errors.forbidden('opportunities.write_denied', 'Your role cannot create opportunities.');
  }
  const parsed = createOpportunityInput.parse(input);

  return deps.tx.transaction(async (repos) => {
    const opportunity = await repos.opportunities.create(ctx.workspaceId, {
      ...parsed,
      typeKey: parsed.typeKey as never,
      createdBy: actorKind(ctx) === 'user' ? 'manual' : 'auto',
      ownerUserId: actorUserId(ctx),
    });

    for (const evidenceUnitId of parsed.evidenceUnitIds ?? []) {
      await repos.opportunities.attachEvidence({
        opportunityId: opportunity.id,
        evidenceUnitId,
        stance: 'for',
        addedBy: actorKind(ctx),
      });
    }

    // Every opportunity begins at 'detected' with a recorded reason, so the
    // lifecycle has no unexplained starting point.
    await repos.opportunities.recordTransition({
      opportunityId: opportunity.id,
      fromState: null,
      toState: 'detected',
      reason:
        parsed.evidenceUnitIds?.length
          ? `Created from ${parsed.evidenceUnitIds.length} existing pieces of evidence.`
          : 'Created manually.',
      actorKind: actorKind(ctx),
      actorUserId: actorUserId(ctx),
    });

    await repos.audit.record(ctx, {
      action: 'opportunity.created',
      entityType: 'opportunity',
      entityId: opportunity.id,
      after: { title: opportunity.title, typeKey: opportunity.typeKey },
    });

    return opportunity;
  });
}

export const transitionInput = z.object({
  toState: z.enum(OPPORTUNITY_STATE_KEYS as [OpportunityState, ...OpportunityState[]]),
  reason: z.string().trim().min(3, 'Say why this is changing.').max(2000),
  evidence: z.record(z.string(), z.unknown()).optional(),
});

export type TransitionInput = z.infer<typeof transitionInput>;

/**
 * Moves an opportunity through its lifecycle.
 *
 * The rules live in the domain and are checked here, so an illegal jump is
 * refused whether it comes from the interface, the API or a background job.
 * Rejections are recorded in the decision log as well, because a killed idea is
 * a result worth keeping rather than an absence.
 */
export async function transitionOpportunity(
  deps: LifecycleDeps,
  ctx: ActorCtx,
  opportunityId: string,
  input: TransitionInput,
): Promise<OpportunityRow> {
  const parsed = transitionInput.parse(input);

  const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, opportunityId);
  if (!opportunity) throw errors.notFound('Opportunity');

  const decisive = ['rejected', 'execution', 'archived'].includes(parsed.toState);
  const permission = decisive ? 'opportunities.decide' : 'opportunities.write';
  if (!can(ctx, permission)) {
    throw errors.forbidden(
      'opportunities.transition_denied',
      decisive
        ? 'Only an owner can take a decision that commits or ends work.'
        : 'Your role cannot change an opportunity.',
    );
  }

  const verdict = evaluateTransition({
    from: opportunity.state,
    to: parsed.toState,
    reason: parsed.reason,
    actorKind: actorKind(ctx),
  });

  if (!verdict.ok) {
    throw errors.preconditionFailed(
      `opportunity.${verdict.code}`,
      verdict.message,
      verdict.code === 'illegal_transition'
        ? `From ${opportunity.state} you can move to: ${allowedTransitions(opportunity.state).join(', ')}.`
        : undefined,
    );
  }

  const now = deps.clock.now();

  return deps.tx.transaction(async (repos) => {
    await repos.opportunities.setState(opportunityId, parsed.toState, now);
    await repos.opportunities.recordTransition({
      opportunityId,
      fromState: opportunity.state,
      toState: parsed.toState,
      reason: parsed.reason,
      actorKind: actorKind(ctx),
      actorUserId: actorUserId(ctx),
      evidence: parsed.evidence ?? {},
    });

    if (decisive) {
      const current = await repos.scores.current(ctx.workspaceId, opportunityId);
      await repos.decisions.record(ctx.workspaceId, {
        subjectType: 'opportunity',
        subjectId: opportunityId,
        decision: parsed.toState,
        rationale: parsed.reason,
        radarConfidence: current?.confidence ?? null,
        radarRecommendation: current ? describeRecommendation(current.attractiveness, current.confidence) : null,
        actorUserId: actorUserId(ctx),
        context: { fromState: opportunity.state },
      });
    }

    await repos.audit.record(ctx, {
      action: 'opportunity.state_changed',
      entityType: 'opportunity',
      entityId: opportunityId,
      before: { state: opportunity.state },
      after: { state: parsed.toState, reason: parsed.reason },
    });

    const updated = await repos.opportunities.findById(ctx.workspaceId, opportunityId);
    if (!updated) throw errors.notFound('Opportunity');
    return updated;
  });
}

/**
 * What Radar itself would have said, captured at the moment a person decides,
 * so recommendations can later be compared against outcomes.
 */
function describeRecommendation(attractiveness: number | null, confidence: number): string {
  if (attractiveness === null) return 'no recommendation: not enough scored evidence';
  if (confidence < 0.2) return 'do not act yet: evidence too thin';
  if (attractiveness >= 70 && confidence >= 0.5) return 'pursue';
  if (attractiveness < 40) return 'unattractive';
  return 'investigate further';
}

export async function attachEvidence(
  deps: LifecycleDeps,
  ctx: ActorCtx,
  opportunityId: string,
  input: { evidenceUnitId: string; stance: 'for' | 'against'; note?: string | null; weight?: number },
): Promise<void> {
  if (!can(ctx, 'opportunities.write')) {
    throw errors.forbidden('opportunities.write_denied', 'Your role cannot change opportunities.');
  }

  const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, opportunityId);
  if (!opportunity) throw errors.notFound('Opportunity');

  const unit = await deps.repos.evidence.findById(ctx.workspaceId, input.evidenceUnitId);
  if (!unit) throw errors.notFound('Evidence');

  await deps.tx.transaction(async (repos) => {
    await repos.opportunities.attachEvidence({
      opportunityId,
      evidenceUnitId: input.evidenceUnitId,
      stance: input.stance,
      weight: input.weight,
      note: input.note ?? null,
      addedBy: actorKind(ctx),
    });
    await repos.audit.record(ctx, {
      action: 'opportunity.evidence_attached',
      entityType: 'opportunity',
      entityId: opportunityId,
      after: { evidenceUnitId: input.evidenceUnitId, stance: input.stance },
    });
  });
}
