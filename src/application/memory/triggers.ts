import { z } from 'zod';
import {
  describeTrigger,
  evaluateTrigger,
  hasAnyCondition,
  triggersForRejection,
  type TriggerPredicate,
} from '../../domain/memory/triggers';
import { keywordsFor } from '../../domain/memory/relationships';
import { EVIDENCE_CLASS_KEYS } from '../../domain/taxonomy/evidence-class';
import { SIGNAL_TYPE_KEYS } from '../../domain/taxonomy/signal-types';
import { errors } from '../../domain/types/errors';
import { actorKind, actorUserId, type ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { TriggerRow } from '../../ports/repositories/memory';

/**
 * Watching for the thing that would change our mind.
 *
 * A rejection is a conclusion drawn from the evidence available at the time.
 * Recording what would overturn it is what turns a rejection into memory
 * rather than a dead end -- and it is what stops the same idea being
 * rediscovered from scratch, reasoned through identically, and rejected again.
 */

export interface MemoryDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export const triggerPredicateInput = z.object({
  signalTypes: z.array(z.enum(SIGNAL_TYPE_KEYS as [string, ...string[]])).max(8).optional(),
  evidenceClasses: z.array(z.enum(EVIDENCE_CLASS_KEYS as [string, ...string[]])).max(8).optional(),
  allOf: z.array(z.string().trim().min(2).max(80)).max(6).optional(),
  anyOf: z.array(z.string().trim().min(2).max(80)).max(12).optional(),
  noneOf: z.array(z.string().trim().min(2).max(80)).max(6).optional(),
  minMonthlyAmount: z.number().min(0).max(1_000_000).optional(),
  requireIndependent: z.boolean().optional(),
});

export const createTriggerInput = z.object({
  kind: z.string().trim().min(2).max(60),
  description: z.string().trim().min(5, 'Say what would change our mind.').max(500),
  predicate: triggerPredicateInput,
});

export async function createTrigger(
  deps: MemoryDeps,
  ctx: ActorCtx,
  opportunityId: string,
  input: z.infer<typeof createTriggerInput>,
): Promise<TriggerRow> {
  if (!can(ctx, 'opportunities.write')) {
    throw errors.forbidden('opportunities.write_denied', 'Your role cannot set re-evaluation triggers.');
  }
  const parsed = createTriggerInput.parse(input);

  const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, opportunityId);
  if (!opportunity) throw errors.notFound('Opportunity');

  const predicate = parsed.predicate as TriggerPredicate;
  if (!hasAnyCondition(predicate)) {
    // A trigger with no conditions would match the first piece of evidence
    // that arrived and reopen everything at once.
    throw errors.preconditionFailed(
      'trigger.no_conditions',
      'A trigger with no conditions would fire on everything, so it is refused.',
      'Name at least a signal type, a phrase, or an amount to watch for.',
    );
  }

  const trigger = await deps.repos.triggers.create(
    ctx.workspaceId,
    { opportunityId, kind: parsed.kind, description: parsed.description, predicate },
    deps.clock.now(),
  );

  await deps.repos.audit.record(ctx, {
    action: 'trigger.created',
    entityType: 'opportunity',
    entityId: opportunityId,
    after: { kind: parsed.kind, watching: describeTrigger(predicate) },
  });

  return trigger;
}

/**
 * The triggers a rejection implies, offered rather than applied.
 *
 * Derived deterministically from why it was rejected, because those reasons
 * are Radar's own. They are proposals: a person decides which to arm, and a
 * trigger nobody armed never fires.
 */
export async function proposeTriggers(
  deps: MemoryDeps,
  ctx: ActorCtx,
  opportunityId: string,
): Promise<Array<{ kind: string; description: string; predicate: TriggerPredicate; watching: string }>> {
  if (!can(ctx, 'opportunities.read')) throw errors.forbidden('opportunities.read');

  const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, opportunityId);
  if (!opportunity) throw errors.notFound('Opportunity');

  const outputs = await deps.repos.investigations.outputsFor(
    ctx.workspaceId,
    'opportunity',
    opportunityId,
  );

  const demand = latest(outputs, 'investigation.demand');
  const competitors = latest(outputs, 'investigation.competitors');
  const redTeam = latest(outputs, 'investigation.red_team');

  const objections = Array.isArray(redTeam?.objections)
    ? (redTeam.objections as Array<{ category?: unknown }>)
    : [];

  const proposals = triggersForRejection({
    willingnessToPay: typeof demand?.willingnessToPay === 'string' ? demand.willingnessToPay : null,
    hasFreeAlternative: Array.isArray(competitors?.freeAlternatives)
      ? competitors.freeAlternatives.length > 0
      : false,
    objectionCategories: objections
      .map((objection) => objection.category)
      .filter((category): category is string => typeof category === 'string'),
    keywords: keywordsFor(
      `${opportunity.title} ${opportunity.problemStatement ?? ''} ${opportunity.targetCustomer ?? ''}`,
    ),
  });

  return proposals.map((proposal) => ({ ...proposal, watching: describeTrigger(proposal.predicate) }));
}

export interface TriggerEvaluation {
  triggersChecked: number;
  signalsChecked: number;
  fired: Array<{
    triggerId: string;
    opportunityId: string;
    signalId: string;
    reason: string;
    reopened: boolean;
  }>;
}

/**
 * Evaluates every armed trigger against the evidence that has arrived since it
 * was last checked.
 *
 * Deterministic, and incremental: each trigger records when it was last
 * checked, so re-running this costs nothing and cannot fire twice on the same
 * evidence. No model is involved, which is what makes a reopening traceable to
 * the exact signal that caused it.
 */
export async function evaluateTriggers(
  deps: MemoryDeps,
  ctx: ActorCtx,
  options: { limit?: number } = {},
): Promise<TriggerEvaluation> {
  if (!can(ctx, 'opportunities.write')) throw errors.forbidden('opportunities.write');

  const triggers = await deps.repos.triggers.listActive(ctx.workspaceId);
  if (triggers.length === 0) return { triggersChecked: 0, signalsChecked: 0, fired: [] };

  /*
   * A trigger only considers evidence that arrived after it was armed. What
   * came before was already known when the opportunity was rejected, so
   * matching it would reopen the opportunity on the very evidence that closed
   * it.
   */
  const floorFor = (trigger: TriggerRow): Date => trigger.lastCheckedAt ?? trigger.createdAt;

  // One query for the whole sweep, from the oldest floor any trigger holds;
  // each trigger then filters to what it has not already seen.
  const earliest = triggers
    .map(floorFor)
    .reduce((oldest, at) => (at < oldest ? at : oldest), floorFor(triggers[0]!));

  const { rows: signals } = await deps.repos.signals.list(ctx.workspaceId, {
    observedAfter: earliest,
    limit: options.limit ?? 500,
  });

  const now = deps.clock.now();
  const fired: TriggerEvaluation['fired'] = [];

  for (const trigger of triggers) {
    const floor = floorFor(trigger);
    const candidates = signals.filter((signal) => signal.observedAt > floor);

    for (const signal of candidates) {
      const verdict = evaluateTrigger(trigger.predicate, {
        title: signal.title,
        bodyText: signal.bodyText,
        signalTypeKey: signal.signalTypeKey,
        evidenceClass: signal.evidenceClass,
        monthlyAmount: signal.monetaryEvidence?.monthlyAmount ?? null,
      });

      if (!verdict.fires) continue;

      const reopened = await fireTrigger(deps, ctx, trigger, signal.id, verdict.reason, now);
      fired.push({
        triggerId: trigger.id,
        opportunityId: trigger.opportunityId,
        signalId: signal.id,
        reason: verdict.reason,
        reopened,
      });
      break;
    }
  }

  await deps.repos.triggers.markChecked(
    triggers.map((trigger) => trigger.id),
    now,
  );

  return { triggersChecked: triggers.length, signalsChecked: signals.length, fired };
}

/**
 * Acts on a trigger that has been satisfied.
 *
 * The opportunity is reopened, not resurrected: reopened means somebody should
 * look again, and the transition names the signal that caused it so the
 * reasoning survives.
 */
async function fireTrigger(
  deps: MemoryDeps,
  ctx: ActorCtx,
  trigger: TriggerRow,
  signalId: string,
  reason: string,
  now: Date,
): Promise<boolean> {
  const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, trigger.opportunityId);
  if (!opportunity) return false;

  const signal = await deps.repos.signals.findById(ctx.workspaceId, signalId);
  const reopenable = opportunity.state === 'rejected' || opportunity.state === 'archived';

  await deps.tx.transaction(async (repos) => {
    await repos.triggers.fire(trigger.id, { signalId, at: now });

    if (reopenable) {
      await repos.opportunities.setState(opportunity.id, 'reopened', now);
      await repos.opportunities.recordTransition({
        opportunityId: opportunity.id,
        fromState: opportunity.state,
        toState: 'reopened',
        reason: `${trigger.description} ${reason}`.trim(),
        actorKind: actorKind(ctx),
        actorUserId: actorUserId(ctx),
        // The specific signal, so the reopening can be checked rather than
        // taken on trust.
        evidence: { triggerId: trigger.id, triggerKind: trigger.kind, signalId },
      });
    }

    // The evidence that changed our mind belongs on the opportunity.
    if (signal?.evidenceUnitId) {
      await repos.opportunities.attachEvidence({
        opportunityId: opportunity.id,
        evidenceUnitId: signal.evidenceUnitId,
        stance: 'for',
        note: `Satisfied the re-evaluation trigger: ${trigger.description}`,
        addedBy: actorKind(ctx),
      });
    }

    await repos.events.append(ctx.workspaceId, {
      kind: 'opportunity.evidence_changed',
      subjectType: 'opportunity',
      subjectId: opportunity.id,
      payload: { opportunityId: opportunity.id, cause: 'reevaluation_trigger' },
    });
  });

  await deps.repos.alerts.raise(
    ctx.workspaceId,
    {
      kind: 'opportunity_reopened',
      severity: 'urgent',
      subjectType: 'opportunity',
      subjectId: opportunity.id,
      title: reopenable
        ? `Reopened: ${opportunity.title}`
        : `Something changed for: ${opportunity.title}`,
      body: `${trigger.description} ${reason}`.trim(),
      action: 'Review what changed and decide whether to pick this up again.',
      dedupeKey: `trigger:${trigger.id}`,
      demo: opportunity.demo,
    },
    now,
  );

  return reopenable;
}

export async function listTriggers(
  deps: MemoryDeps,
  ctx: ActorCtx,
  opportunityId: string,
): Promise<Array<TriggerRow & { watching: string }>> {
  if (!can(ctx, 'opportunities.read')) throw errors.forbidden('opportunities.read');

  const rows = await deps.repos.triggers.listFor(ctx.workspaceId, opportunityId);
  return rows.map((row) => ({ ...row, watching: describeTrigger(row.predicate) }));
}

function latest(
  outputs: Array<{ schemaKey: string; payload: Record<string, unknown> }>,
  schemaKey: string,
): Record<string, unknown> | null {
  const matching = outputs.filter((output) => output.schemaKey === schemaKey);
  return matching.length > 0 ? (matching[matching.length - 1]!.payload ?? null) : null;
}
