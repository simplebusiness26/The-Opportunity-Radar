import { rankByValueOfInformation, type RankedUncertainty } from '../../domain/investigation/policy';
import { errors } from '../../domain/types/errors';
import type { ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Repositories } from '../../ports/repositories/index';
import type {
  ExperimentRow,
  InvestigationRow,
  ValidationPlanRow,
} from '../../ports/repositories/investigation';

/**
 * What an investigation actually found, assembled for reading.
 *
 * Every conclusion is shown with the run that produced it, what the projector
 * had to correct, and what it cost. A finding with no visible provenance is
 * indistinguishable from an assertion, and this product's whole claim is that
 * its conclusions are traceable.
 */

export interface InvestigationLogEntry {
  run: InvestigationRow;
  schemaKey: string | null;
  payload: Record<string, unknown> | null;
  /** What projection had to drop, clamp or correct. */
  correction: string | null;
  aiCallId: string | null;
  createdAt: Date | null;
}

export interface InvestigationLog {
  opportunityId: string;
  entries: InvestigationLogEntry[];
  /** Open unknowns, most worth resolving first. */
  uncertainty: RankedUncertainty[];
  plan: ValidationPlanRow | null;
  experiments: ExperimentRow[];
  totalSpentUsd: number;
}

export async function readInvestigationLog(
  repos: Repositories,
  ctx: ActorCtx,
  opportunityId: string,
): Promise<InvestigationLog> {
  if (!can(ctx, 'opportunities.read')) throw errors.forbidden('opportunities.read');

  const opportunity = await repos.opportunities.findById(ctx.workspaceId, opportunityId);
  if (!opportunity) throw errors.notFound('Opportunity');

  const [runs, outputs, unknowns, plan, experiments] = await Promise.all([
    repos.investigations.listFor(ctx.workspaceId, 'opportunity', opportunityId),
    repos.investigations.outputsFor(ctx.workspaceId, 'opportunity', opportunityId),
    repos.uncertainty.listFor(ctx.workspaceId, opportunityId, { openOnly: true }),
    repos.validation.latestPlan(ctx.workspaceId, opportunityId),
    repos.validation.listExperiments(ctx.workspaceId, { opportunityId }),
  ]);

  const outputByInvestigation = new Map(outputs.map((output) => [output.investigationId, output]));

  const entries = runs.map((run) => {
    const output = outputByInvestigation.get(run.id) ?? null;
    const report = output?.projectionReport as { summary?: unknown } | undefined;

    return {
      run,
      schemaKey: output?.schemaKey ?? null,
      payload: output?.payload ?? null,
      correction: typeof report?.summary === 'string' ? report.summary : null,
      aiCallId: output?.aiCallId ?? null,
      createdAt: output?.createdAt ?? null,
    };
  });

  return {
    opportunityId,
    entries,
    // Re-ranked on read rather than trusting the stored order, so a change to
    // the value-of-information rule takes effect everywhere at once.
    uncertainty: rankByValueOfInformation(
      unknowns.map((item) => ({
        id: item.id,
        statement: item.statement,
        kind: item.kind,
        impact: item.impact,
        resolvability: item.resolvability,
        costToResolve: item.costToResolve,
        daysToResolve: item.daysToResolve,
      })),
    ),
    plan,
    experiments,
    totalSpentUsd: Number(runs.reduce((sum, run) => sum + run.spentUsd, 0).toFixed(6)),
  };
}
