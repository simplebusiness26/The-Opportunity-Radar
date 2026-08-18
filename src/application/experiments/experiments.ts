import { z } from 'zod';
import {
  canTransition,
  confidenceEffect,
  judgeExperiment,
  EXPERIMENT_STATES,
  type ExperimentState,
} from '../../domain/state/experiment-state';
import { errors } from '../../domain/types/errors';
import { actorKind, actorUserId, type ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { ExperimentRow } from '../../ports/repositories/investigation';

/**
 * Running an experiment, and being held to what it was supposed to prove.
 *
 * The thresholds are fixed when the plan is written and are not editable
 * afterwards. That is the whole mechanism: a verdict is then a comparison
 * rather than an interpretation, and a disappointing result cannot quietly
 * become an encouraging one.
 */

export interface ExperimentDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export const createExperimentInput = z.object({
  opportunityId: z.string().uuid(),
  validationPlanId: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(3).max(200),
  budget: z.number().min(0).max(1_000_000).default(0),
  demo: z.boolean().optional(),
});

export type CreateExperimentInput = z.infer<typeof createExperimentInput>;

export async function createExperiment(
  deps: ExperimentDeps,
  ctx: ActorCtx,
  input: CreateExperimentInput,
): Promise<ExperimentRow> {
  if (!can(ctx, 'experiments.write')) {
    throw errors.forbidden('experiments.write_denied', 'Your role cannot start experiments.');
  }
  const parsed = createExperimentInput.parse(input);

  const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, parsed.opportunityId);
  if (!opportunity) throw errors.notFound('Opportunity');

  const now = deps.clock.now();

  return deps.tx.transaction(async (repos) => {
    const experiment = await repos.validation.createExperiment(
      ctx.workspaceId,
      {
        opportunityId: parsed.opportunityId,
        validationPlanId: parsed.validationPlanId ?? null,
        name: parsed.name,
        budget: parsed.budget,
        ownerUserId: actorUserId(ctx),
        demo: parsed.demo ?? opportunity.demo,
      },
      now,
    );

    await repos.validation.transitionExperiment(
      experiment.id,
      {
        fromState: null,
        toState: 'proposed',
        reason: 'Created from the validation plan.',
        actorKind: actorKind(ctx),
        actorUserId: actorUserId(ctx),
      },
      now,
    );

    await repos.audit.record(ctx, {
      action: 'experiment.created',
      entityType: 'experiment',
      entityId: experiment.id,
      after: { name: experiment.name, opportunityId: parsed.opportunityId },
    });

    return experiment;
  });
}

export const transitionExperimentInput = z.object({
  toState: z.enum(['proposed', 'approved', 'running', 'blocked', 'completed', 'abandoned']),
  reason: z.string().trim().min(3, 'Say why this is changing.').max(2000),
});

export async function moveExperiment(
  deps: ExperimentDeps,
  ctx: ActorCtx,
  experimentId: string,
  input: z.infer<typeof transitionExperimentInput>,
): Promise<ExperimentRow> {
  if (!can(ctx, 'experiments.write')) {
    throw errors.forbidden('experiments.write_denied', 'Your role cannot change experiments.');
  }
  const parsed = transitionExperimentInput.parse(input);

  const experiment = await deps.repos.validation.findExperiment(ctx.workspaceId, experimentId);
  if (!experiment) throw errors.notFound('Experiment');

  // Concluding is not a plain transition: it needs the results judged against
  // the thresholds, which conclude() does.
  if (parsed.toState === 'completed') {
    const result = await concludeExperiment(deps, ctx, experimentId);
    return result.experiment;
  }

  const verdict = canTransition(experiment.state, parsed.toState);
  if (!verdict.allowed) {
    throw errors.preconditionFailed('experiment.illegal_transition', verdict.reason, verdict.remedy);
  }

  const now = deps.clock.now();

  await deps.tx.transaction(async (repos) => {
    await repos.validation.transitionExperiment(
      experimentId,
      {
        fromState: experiment.state,
        toState: parsed.toState,
        reason: parsed.reason,
        actorKind: actorKind(ctx),
        actorUserId: actorUserId(ctx),
      },
      now,
    );

    // An experiment actually starting is a real change to the opportunity, so
    // the lifecycle follows it rather than being updated by hand later.
    if (parsed.toState === 'running') {
      const opportunity = await repos.opportunities.findById(ctx.workspaceId, experiment.opportunityId);
      if (opportunity && opportunity.state === 'validation_ready') {
        await repos.opportunities.setState(opportunity.id, 'validating', now);
        await repos.opportunities.recordTransition({
          opportunityId: opportunity.id,
          fromState: opportunity.state,
          toState: 'validating',
          reason: `Experiment started: ${experiment.name}`,
          actorKind: actorKind(ctx),
          actorUserId: actorUserId(ctx),
        });
      }
    }

    await repos.audit.record(ctx, {
      action: 'experiment.state_changed',
      entityType: 'experiment',
      entityId: experimentId,
      before: { state: experiment.state },
      after: { state: parsed.toState, reason: parsed.reason },
    });
  });

  const updated = await deps.repos.validation.findExperiment(ctx.workspaceId, experimentId);
  if (!updated) throw errors.notFound('Experiment');
  return updated;
}

export const recordResultInput = z.object({
  metricKey: z.string().trim().min(1).max(120),
  value: z.number().finite(),
  unit: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function recordExperimentResult(
  deps: ExperimentDeps,
  ctx: ActorCtx,
  experimentId: string,
  input: z.infer<typeof recordResultInput>,
): Promise<void> {
  if (!can(ctx, 'experiments.write')) {
    throw errors.forbidden('experiments.write_denied', 'Your role cannot record results.');
  }
  const parsed = recordResultInput.parse(input);

  const experiment = await deps.repos.validation.findExperiment(ctx.workspaceId, experimentId);
  if (!experiment) throw errors.notFound('Experiment');

  if (!EXPERIMENT_STATES[experiment.state].acceptsResults) {
    // Recording a result against an experiment that has not run, or that has
    // already concluded, would let the record be edited after the fact.
    throw errors.preconditionFailed(
      'experiment.not_accepting_results',
      `An experiment that is ${EXPERIMENT_STATES[experiment.state].label.toLowerCase()} cannot record results.`,
      'Move it to running first.',
    );
  }

  const now = deps.clock.now();

  await deps.tx.transaction(async (repos) => {
    await repos.validation.recordResult(
      experimentId,
      {
        metricKey: parsed.metricKey,
        value: parsed.value,
        unit: parsed.unit ?? null,
        notes: parsed.notes ?? null,
        recordedByUserId: actorUserId(ctx),
      },
      now,
    );

    await repos.audit.record(ctx, {
      action: 'experiment.result_recorded',
      entityType: 'experiment',
      entityId: experimentId,
      after: { metricKey: parsed.metricKey, value: parsed.value },
    });
  });
}

export interface ConclusionResult {
  experiment: ExperimentRow;
  verdict: 'validated' | 'partially_validated' | 'inconclusive' | 'rejected';
  explanation: string;
  confidenceDelta: number;
  /** The thresholds the verdict was measured against. */
  checks: Array<{ metric: string; value: number; required: number }>;
}

/**
 * Ends an experiment by comparing what happened with what was agreed.
 *
 * The verdict is computed, not chosen. If the plan's metrics were never
 * measured the answer is "inconclusive", which is a real outcome and is
 * recorded as one rather than being rounded toward whichever conclusion is
 * more welcome.
 */
export async function concludeExperiment(
  deps: ExperimentDeps,
  ctx: ActorCtx,
  experimentId: string,
): Promise<ConclusionResult> {
  if (!can(ctx, 'experiments.write')) {
    throw errors.forbidden('experiments.write_denied', 'Your role cannot conclude experiments.');
  }

  const experiment = await deps.repos.validation.findExperiment(ctx.workspaceId, experimentId);
  if (!experiment) throw errors.notFound('Experiment');

  const verdict = canTransition(experiment.state, 'completed');
  if (!verdict.allowed) {
    throw errors.preconditionFailed('experiment.illegal_transition', verdict.reason, verdict.remedy);
  }

  const plan = experiment.validationPlanId
    ? await deps.repos.validation.latestPlan(ctx.workspaceId, experiment.opportunityId)
    : null;

  if (!plan) {
    throw errors.preconditionFailed(
      'experiment.no_plan',
      'This experiment has no validation plan, so there are no agreed thresholds to judge it against.',
      'Attach it to a plan, or record the conclusion manually in the decision log.',
    );
  }

  const results = await deps.repos.validation.resultsFor(experimentId);
  const judgement = judgeExperiment({
    successThreshold: { metric: plan.successThreshold.metric, value: plan.successThreshold.value },
    failureThreshold: { metric: plan.failureThreshold.metric, value: plan.failureThreshold.value },
    results,
  });

  const effect = confidenceEffect(judgement.verdict);
  const now = deps.clock.now();

  await deps.tx.transaction(async (repos) => {
    await repos.validation.transitionExperiment(
      experimentId,
      {
        fromState: experiment.state,
        toState: 'completed',
        reason: judgement.explanation,
        actorKind: actorKind(ctx),
        actorUserId: actorUserId(ctx),
        verdict: judgement.verdict,
        conclusion: `${judgement.explanation} ${effect.explanation}`.trim(),
      },
      now,
    );

    // Real-world evidence is the strongest input the scoring engine takes, so
    // the recompute is immediate rather than debounced with routine changes.
    await repos.events.append(ctx.workspaceId, {
      kind: 'experiment.result_recorded',
      subjectType: 'experiment',
      subjectId: experimentId,
      payload: {
        opportunityId: experiment.opportunityId,
        verdict: judgement.verdict,
        confidenceDelta: effect.delta,
      },
    });

    await repos.audit.record(ctx, {
      action: 'experiment.concluded',
      entityType: 'experiment',
      entityId: experimentId,
      after: { verdict: judgement.verdict, explanation: judgement.explanation },
    });
  });

  const updated = await deps.repos.validation.findExperiment(ctx.workspaceId, experimentId);
  if (!updated) throw errors.notFound('Experiment');

  return {
    experiment: updated,
    verdict: judgement.verdict,
    explanation: judgement.explanation,
    confidenceDelta: effect.delta,
    checks: judgement.checks,
  };
}

export const recordContactInput = z.object({
  label: z.string().trim().min(1).max(200),
  outcome: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export async function recordExperimentContact(
  deps: ExperimentDeps,
  ctx: ActorCtx,
  experimentId: string,
  input: z.infer<typeof recordContactInput>,
): Promise<void> {
  if (!can(ctx, 'experiments.write')) {
    throw errors.forbidden('experiments.write_denied', 'Your role cannot record contacts.');
  }
  const parsed = recordContactInput.parse(input);

  const experiment = await deps.repos.validation.findExperiment(ctx.workspaceId, experimentId);
  if (!experiment) throw errors.notFound('Experiment');

  await deps.repos.validation.recordContact(
    experimentId,
    { label: parsed.label, outcome: parsed.outcome, notes: parsed.notes ?? null },
    deps.clock.now(),
  );
}

export interface ExperimentDetail {
  experiment: ExperimentRow;
  state: (typeof EXPERIMENT_STATES)[ExperimentState];
  results: Array<{ metricKey: string; value: number; unit: string | null; notes: string | null }>;
  contacts: Array<{ label: string; outcome: string; notes: string | null }>;
  plan: Awaited<ReturnType<Repositories['validation']['latestPlan']>>;
}

export async function readExperiment(
  deps: ExperimentDeps,
  ctx: ActorCtx,
  experimentId: string,
): Promise<ExperimentDetail> {
  if (!can(ctx, 'opportunities.read')) throw errors.forbidden('opportunities.read');

  const experiment = await deps.repos.validation.findExperiment(ctx.workspaceId, experimentId);
  if (!experiment) throw errors.notFound('Experiment');

  const [results, contacts, plan] = await Promise.all([
    deps.repos.validation.resultsFor(experimentId),
    deps.repos.validation.contactsFor(experimentId),
    deps.repos.validation.latestPlan(ctx.workspaceId, experiment.opportunityId),
  ]);

  return { experiment, state: EXPERIMENT_STATES[experiment.state], results, contacts, plan };
}
