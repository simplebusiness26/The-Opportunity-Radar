import {
  allocate,
  DEFAULT_POLICY,
  type AllocationCandidate,
  type AllocationResult,
  type AvailableResources,
  type CapitalRequirement,
  type CapitalRequirementCategory,
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

export interface RecordedCapitalPlan {
  currency: 'GBP';
  required: number;
  requirements: CapitalRequirement[];
}

const CAPITAL_CATEGORIES = new Set<CapitalRequirementCategory>([
  'validation',
  'infrastructure',
  'data',
  'distribution',
  'compliance',
  'inventory',
  'contractor',
  'software',
  'other',
]);

const PERIOD_DAYS: Record<string, number> = {
  week: 7,
  month: 30,
  quarter: 90,
};

function capitalRequirement(value: unknown): CapitalRequirement | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const amount = Number(row.amount);
  const category = String(row.category ?? 'other') as CapitalRequirementCategory;
  const label = typeof row.label === 'string' ? row.label.trim() : '';

  if (!label || !Number.isFinite(amount) || amount < 0 || !CAPITAL_CATEGORIES.has(category)) {
    return null;
  }

  return {
    category,
    label: label.slice(0, 200),
    amount,
    ...(typeof row.note === 'string' && row.note.trim()
      ? { note: row.note.trim().slice(0, 1000) }
      : {}),
    ...(Array.isArray(row.evidenceRefs)
      ? {
          evidenceRefs: row.evidenceRefs
            .filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0)
            .map((ref) => ref.trim().slice(0, 500))
            .slice(0, 50),
        }
      : {}),
  };
}

/**
 * Capital plans live in opportunity notes until they deserve their own table.
 * Only explicit, valid GBP amounts count. Missing or malformed plans remain
 * unknown rather than being silently interpreted as £0.
 */
export function readCapitalPlan(
  notes: Record<string, unknown>,
  key: 'capitalPlan' | 'validationCapitalPlan' = 'capitalPlan',
): RecordedCapitalPlan | null {
  const raw = notes[key];
  if (!raw || typeof raw !== 'object') return null;

  const row = raw as Record<string, unknown>;
  if (row.currency !== undefined && row.currency !== 'GBP') return null;

  const required = Number(row.required);
  if (!Number.isFinite(required) || required < 0) return null;

  const requirements = Array.isArray(row.requirements)
    ? row.requirements
        .map(capitalRequirement)
        .filter((item): item is CapitalRequirement => item !== null)
        .slice(0, 30)
    : [];

  return { currency: 'GBP', required, requirements };
}

export function availableTimeForHorizon(
  resource: { amount: number; committed: number; period: string },
  horizonDays: number,
): number {
  const availableInPeriod = Math.max(0, resource.amount - resource.committed);
  if (resource.period === 'once') return availableInPeriod;

  const periodDays = PERIOD_DAYS[resource.period];
  // Persisted rows should only contain the validated periods, but if a legacy or
  // corrupted row does not, refusing to multiply it is safer than inventing a cadence.
  if (!periodDays) return availableInPeriod;
  return availableInPeriod * (horizonDays / periodDays);
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
          ? availableTimeForHorizon(time, horizonDays)
          : null,
    money:
      options.budgetOverride !== undefined
        ? options.budgetOverride
        : budget
          ? Math.max(0, budget.amount - budget.committed)
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
    const validationPlan = readCapitalPlan(opportunity.notes, 'validationCapitalPlan');
    const buildPlan = readCapitalPlan(opportunity.notes, 'capitalPlan');

    // Basic validation can be done with free methods: interviews, outreach,
    // public-source research and free-tier prototypes. If an opportunity really
    // requires paid validation, that must be recorded explicitly in its notes.
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
      costMoney: validationPlan?.required ?? 0,
      capitalCostKnown: true,
      capitalRequirements: validationPlan?.requirements ?? [],
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
        costMoney: buildPlan?.required ?? 0,
        capitalCostKnown: buildPlan !== null,
        capitalRequirements: buildPlan?.requirements ?? [],
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
