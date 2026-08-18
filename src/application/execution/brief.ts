import {
  buildBrief,
  renderBrief,
  type BriefCapability,
  type BriefInput,
  type ExecutionBrief,
} from '../../domain/execution/brief';
import { describeTrigger } from '../../domain/memory/triggers';
import { errors } from '../../domain/types/errors';
import type { ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import { assessOpportunityFit } from '../intelligence/capability-profile';

/**
 * Assembling the Execution Brief from stored records.
 *
 * Every field is read, never written here and never generated. If something is
 * missing from the brief it is because it is missing from the record, which is
 * the honest outcome and is stated in the document rather than filled in.
 */

export interface BriefDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export interface BriefResult {
  brief: ExecutionBrief;
  markdown: string;
}

export async function buildExecutionBrief(
  deps: BriefDeps,
  ctx: ActorCtx,
  opportunityId: string,
): Promise<BriefResult> {
  if (!can(ctx, 'opportunities.read')) throw errors.forbidden('opportunities.read');

  const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, opportunityId);
  if (!opportunity) throw errors.notFound('Opportunity');

  const [score, attached, requirements, uncertainty, plan, experiments, triggers, outputs, fit] =
    await Promise.all([
      deps.repos.scores.current(ctx.workspaceId, opportunityId),
      deps.repos.opportunities.evidenceFor(opportunityId),
      deps.repos.opportunities.capabilityRequirements(opportunityId),
      deps.repos.uncertainty.listFor(ctx.workspaceId, opportunityId, { openOnly: true }),
      deps.repos.validation.latestPlan(ctx.workspaceId, opportunityId),
      deps.repos.validation.listExperiments(ctx.workspaceId, { opportunityId }),
      deps.repos.triggers.listFor(ctx.workspaceId, opportunityId),
      deps.repos.investigations.outputsFor(ctx.workspaceId, 'opportunity', opportunityId),
      assessOpportunityFit(deps, ctx, opportunityId),
    ]);

  const forIds = attached.filter((row) => row.stance === 'for').map((row) => row.evidenceUnitId);
  const againstIds = attached.filter((row) => row.stance === 'against');

  const [supporting, opposing] = await Promise.all([
    deps.repos.evidence.listByIds(ctx.workspaceId, forIds),
    deps.repos.evidence.listByIds(
      ctx.workspaceId,
      againstIds.map((row) => row.evidenceUnitId),
    ),
  ]);

  const noteByEvidence = new Map(againstIds.map((row) => [row.evidenceUnitId, row.note]));
  const snapshot = score?.inputsSnapshot as
    | { evidence?: { rawMentions: number; uniqueEvidence: number; independentSources: number; aiDerivedMentions: number } }
    | undefined;

  const redTeam = latest(outputs, 'investigation.red_team');
  const objections = Array.isArray(redTeam?.objections)
    ? (redTeam.objections as Array<{ argument?: unknown; severity?: unknown; disconfirmingTest?: unknown; unsupported?: unknown }>)
    : [];

  const ownedNames = new Map(
    (fit?.leverage.matches ?? [])
      .filter((match) => match.matched)
      .map((match) => [
        match.required.label,
        match.matched!.assetNames[0] ?? match.matched!.taxonomyKey,
      ]),
  );

  const capabilities: BriefCapability[] = requirements.map((requirement) => ({
    label: requirement.label,
    criticality: requirement.criticality,
    coveredBy: ownedNames.get(requirement.label) ?? null,
  }));

  const input: BriefInput = {
    reference: opportunity.reference,
    title: opportunity.title,
    thesis: opportunity.thesis,
    state: opportunity.state,
    typeKey: opportunity.typeKey,
    targetCustomer: opportunity.targetCustomer,
    problemStatement: opportunity.problemStatement,
    whyNow: opportunity.whyNow,
    demo: opportunity.demo,

    attractiveness: score?.attractiveness ?? null,
    confidence: score?.confidence ?? 0,
    fit: score?.fit ?? null,
    leverage: score?.leverage ?? null,

    evidence: {
      rawMentions: snapshot?.evidence?.rawMentions ?? 0,
      uniqueEvidence: snapshot?.evidence?.uniqueEvidence ?? supporting.length,
      independentSources: snapshot?.evidence?.independentSources ?? 0,
      aiDerivedMentions: snapshot?.evidence?.aiDerivedMentions ?? 0,
      strongest: [...supporting]
        .sort((a, b) => b.effectiveStrength - a.effectiveStrength)
        .slice(0, 8)
        .map((unit) => ({
          claim: unit.canonicalClaim,
          evidenceClass: unit.evidenceClass,
          mentions: unit.mentionCount,
        })),
      counter: opposing.map((unit) => ({
        claim: unit.canonicalClaim,
        note: noteByEvidence.get(unit.id) ?? null,
      })),
    },

    capabilities,
    reusableAssets: fit?.leverage.reusableAssets ?? [],
    buildDaysRange: fit?.leverage.leveragedDays
      ? { low: fit.leverage.leveragedDays[0], high: fit.leverage.leveragedDays[1] }
      : null,

    knowns: uncertainty.filter((item) => item.kind === 'known_fact').map((item) => item.statement),
    assumptions: uncertainty.filter((item) => item.kind === 'assumption').map((item) => item.statement),
    criticalUnknowns: uncertainty
      .filter((item) => item.kind === 'critical_unknown')
      .map((item) => item.statement),

    // An objection that cited nothing is excluded: the brief is a document of
    // record, and an unsupported assertion has no place in one.
    objections: objections
      .filter((objection) => objection.unsupported !== true)
      .map((objection) => ({
        argument: String(objection.argument ?? ''),
        severity: String(objection.severity ?? 'serious'),
        disconfirmingTest:
          typeof objection.disconfirmingTest === 'string' ? objection.disconfirmingTest : null,
      })),

    validation: plan
      ? {
          hypothesis: plan.hypothesis,
          experimentType: plan.experimentType,
          successThreshold: plan.successThreshold.description,
          failureThreshold: plan.failureThreshold.description,
          doNotBuildYet: plan.doNotBuildYet,
        }
      : null,

    experiments: experiments.map((experiment) => ({
      name: experiment.name,
      state: experiment.state,
      verdict: experiment.verdict,
      conclusion: experiment.conclusion,
    })),

    watchingFor: triggers
      .filter((trigger) => trigger.active)
      .map((trigger) => `${trigger.description} (watching for ${describeTrigger(trigger.predicate)})`),

    // Fit's own explanation, which names the specific assets and gaps rather
    // than restating the score.
    allocationRationale: fit
      ? `${fit.leverage.explanation} ${fit.fit.explanation}`.trim()
      : null,
    generatedAt: deps.clock.now(),
  };

  const brief = buildBrief(input);
  return { brief, markdown: renderBrief(brief) };
}

function latest(
  outputs: Array<{ schemaKey: string; payload: Record<string, unknown> }>,
  schemaKey: string,
): Record<string, unknown> | null {
  const matching = outputs.filter((output) => output.schemaKey === schemaKey);
  return matching.length > 0 ? (matching[matching.length - 1]!.payload ?? null) : null;
}
