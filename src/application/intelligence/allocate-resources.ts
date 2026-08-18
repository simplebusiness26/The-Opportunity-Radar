import {
  allocate,
  DEFAULT_POLICY,
  type AllocationCandidate,
  type AllocationResult,
  type AvailableResources,
} from '../../domain/allocation/index';
import { errors } from '../../domain/types/errors';
import type { ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import { assessOpportunityFit, type IntelligenceDeps } from './capability-profile';

export interface AllocationDeps extends IntelligenceDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export interface AllocationOptions {
  horizonDays?: number;
  /** Overrides the recorded resources, for scenario comparison. */
  budgetOverride?: number | null;
  daysOverride?: number | null;
}

/**
 * Builds the list of things that could be done next, and ranks them.
 *
 * Candidates come from real state: scored opportunities, and the validation each
 * one would need. Nothing is invented -- an empty workspace produces an empty
 * list and an honest "nothing to compare", which is the correct answer rather
 * than a failure to produce advice.
 */
export async function allocateResources(
  deps: AllocationDeps,
  ctx: ActorCtx,
  options: AllocationOptions = {},
): Promise<AllocationResult> {
  if (!can(ctx, 'opportunities.read')) throw errors.forbidden('opportunities.read');

  const horizonDays = options.horizonDays ?? 7;

  const [opportunities, resourceRows] = await Promise.all([
    deps.repos.opportunities.list(ctx.workspaceId, { limit: 100 }),
    deps.repos.graph.listResources(ctx.workspaceId),
  ]);

  const budget = resourceRows.find((resource) => resource.resourceKind === 'budget');
  const time = resourceRows.find((resource) => resource.resourceKind === 'time');

  const resources: AvailableResources = {
    days:
      options.daysOverride !== undefined
        ? options.daysOverride
        : time
          ? time.amount - time.committed
          : null,
    money:
      options.budgetOverride !== undefined
        ? options.budgetOverride
        : budget
          ? budget.amount - budget.committed
          : null,
  };

  const live = opportunities.filter(
    (opportunity) => !['rejected', 'archived'].includes(opportunity.state),
  );
  if (live.length === 0) return allocate([], resources, horizonDays);

  const scores = await deps.repos.scores.currentForMany(
    ctx.workspaceId,
    live.map((opportunity) => opportunity.id),
  );

  const candidates: AllocationCandidate[] = [];

  for (const opportunity of live) {
    const score = scores.get(opportunity.id);
    if (!score) continue;

    const { leverage, fit } = await assessOpportunityFit(deps, ctx, opportunity.id);

    const attractiveness = score.attractiveness ?? 0;
    const confidence = score.confidence;

    // Every opportunity offers two genuinely different moves: find out whether
    // it is real, or build it. Ranking them against each other is what stops the
    // engine defaulting to "build the highest score".
    candidates.push({
      id: `validate:${opportunity.id}`,
      subjectType: 'opportunity',
      subjectId: opportunity.id,
      kind: 'validate',
      title: `Test whether ${opportunity.title} is real`,
      attractiveness,
      fit: fit.score,
      confidence: Math.max(confidence, 0.4),
      costDays: 2,
      costMoney: 50,
      goalAlignment: null,
      executionRisk: 0.15,
      // A cheap test of an uncertain thesis is worth more the less we know.
      learningValue: Math.min(1, 0.4 + (1 - confidence) * 0.6),
    });

    if (leverage.requiredCount > 0) {
      candidates.push({
        id: `build:${opportunity.id}`,
        subjectType: 'opportunity',
        subjectId: opportunity.id,
        kind: opportunity.typeKey === 'existing_product_feature' ? 'improve_existing' : 'build',
        title: `Build ${opportunity.title}`,
        attractiveness,
        fit: fit.score,
        confidence,
        costDays: Math.round((leverage.leveragedDays[0] + leverage.leveragedDays[1]) / 2),
        costMoney: 0,
        goalAlignment: null,
        executionRisk: 0.2 + 0.4 * (1 - leverage.coverage),
        learningValue: 0.25,
        dependsOn: confidence < DEFAULT_POLICY.minimumConfidenceToBuild
          ? [`validate:${opportunity.id}`]
          : undefined,
      });
    }
  }

  return allocate(candidates, resources, horizonDays);
}

export interface Scenario {
  label: string;
  result: AllocationResult;
}

/**
 * Runs the same comparison under different constraints.
 *
 * The interesting output is where the recommendation *changes*: "with £50 you
 * should test it; with £500 you should build it" is a far more useful sentence
 * than either answer alone.
 */
export async function compareScenarios(
  deps: AllocationDeps,
  ctx: ActorCtx,
  scenarios: Array<{ label: string } & AllocationOptions>,
): Promise<Scenario[]> {
  const results: Scenario[] = [];
  for (const scenario of scenarios) {
    results.push({ label: scenario.label, result: await allocateResources(deps, ctx, scenario) });
  }
  return results;
}
