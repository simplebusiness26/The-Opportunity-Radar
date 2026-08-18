import type { z } from 'zod';
import { buildScoringInput } from '../../application/opportunities/build-scoring-input';
import { rescoreOpportunity } from '../../application/opportunities/score-opportunity';
import {
  decideDepth,
  shouldReject,
  type CandidateState,
  type DepthStage,
} from '../../domain/investigation/policy';
import { sanitiseErrorMessage } from '../../domain/text/sanitise';
import { errors } from '../../domain/types/errors';
import { actorKind, type ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import { untrustedBlock, type UntrustedBlock } from '../../domain/types/untrusted';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { OpportunityRow } from '../../ports/repositories/opportunities';
import { allowedTransitions } from '../../domain/state/opportunity-state';
import { callAi, type GatewayDeps } from '../ai-gateway';
import { assemblePrompt } from '../prompts/assembler';
import type { NonceSource } from '../prompts/nonce';
import { describeReport, type ProjectionReport } from '../projectors/index';
import type { SchemaDefinition } from '../schemas/base';
import type { InvestigationRoleKey } from '../schemas/investigation';
import { gatherEvidence, type EvidenceBriefing } from './evidence';
import {
  NON_EVIDENCE_PREFIX,
  projectCompetitors,
  projectDemand,
  projectMarket,
  projectRedTeam,
  projectUncertainty,
  projectValidation,
  stripNonEvidenceCitations,
  type ProjectedRedTeam,
} from './project';
import { INVESTIGATION_ROLES, readyRoles } from './roles';

/**
 * Running an investigation.
 *
 * The orchestration is deterministic on purpose. No model decides what to do
 * next: the depth policy decides from stored counts, the role order is fixed,
 * and every stop has a recorded reason. What the models contribute is analysis
 * inside one stage, validated on the way out.
 *
 * The runner also never takes the decision. It can recommend rejection, and it
 * can move an opportunity between working states, but killing or committing an
 * opportunity belongs to the owner -- so a background job that concludes an
 * idea is dead raises it for a person rather than closing it.
 */

export interface InvestigationDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
  gateway: GatewayDeps;
  nonce: NonceSource;
}

export interface RoleRun {
  role: InvestigationRoleKey;
  status: 'complete' | 'blocked' | 'failed' | 'skipped';
  message: string;
  costUsd: number;
  investigationId: string | null;
  /** What the projector had to correct, if anything. */
  correction: string | null;
}

export type Recommendation = 'reject' | 'promote' | 'continue' | 'hold';

export interface InvestigationOutcome {
  opportunityId: string;
  stage: DepthStage;
  proceeded: boolean;
  reason: string;
  needed: string | null;
  runs: RoleRun[];
  costUsd: number;
  recommendation: Recommendation;
  recommendationReason: string | null;
  counterEvidenceAttached: number;
  /** Set when the run stopped because something is not configured. */
  blockedBy: string | null;
}

export interface InvestigateOptions {
  jobId?: string;
  runId?: string;
  /** Ceiling for the whole run, across roles. */
  runCapUsd?: number;
}

const STAGE_ROLES: Record<DepthStage, InvestigationRoleKey[]> = {
  watch: [],
  collect_more: [],
  investigate: ['market', 'competitors', 'demand', 'uncertainty'],
  red_team: ['red_team'],
  propose_validation: ['validation'],
};

export async function investigateOpportunity(
  deps: InvestigationDeps,
  ctx: ActorCtx,
  opportunityId: string,
  options: InvestigateOptions = {},
): Promise<InvestigationOutcome> {
  if (!can(ctx, 'opportunities.write')) {
    throw errors.forbidden('opportunities.write_denied', 'Your role cannot investigate opportunities.');
  }

  const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, opportunityId);
  if (!opportunity) throw errors.notFound('Opportunity');

  const now = deps.clock.now();
  const state = await readCandidateState(deps, ctx.workspaceId, opportunity, now);
  const decision = decideDepth(state);

  const base: InvestigationOutcome = {
    opportunityId,
    stage: decision.stage,
    proceeded: false,
    reason: decision.reason,
    needed: decision.needed,
    runs: [],
    costUsd: 0,
    recommendation: 'hold',
    recommendationReason: null,
    counterEvidenceAttached: 0,
    blockedBy: null,
  };

  if (!decision.proceed) {
    // A refusal is a result. It is recorded against the opportunity so the
    // interface can say what is missing rather than showing nothing happening.
    await recordRefusal(deps, ctx, opportunity, decision.stage, decision.reason, decision.needed);
    return base;
  }

  const completed = new Set(state.completedRoles as InvestigationRoleKey[]);
  const runnable = STAGE_ROLES[decision.stage].filter((role) => !completed.has(role));

  if (runnable.length === 0) {
    return { ...base, reason: 'Everything this stage can establish has already been established.' };
  }

  if (decision.stage === 'investigate' && opportunity.state !== 'investigating') {
    await moveState(deps, ctx, opportunity, 'investigating', decision.reason);
  }

  const briefing = await gatherEvidence(deps.repos, ctx.workspaceId, opportunityId);
  if (briefing.blocks.length === 0) {
    return {
      ...base,
      reason: 'No evidence is attached to this opportunity, so there is nothing to investigate.',
      needed: 'Attach the evidence this opportunity rests on.',
    };
  }

  const runs: RoleRun[] = [];
  let spent = 0;
  const cap = options.runCapUsd ?? Number.POSITIVE_INFINITY;
  let blockedBy: string | null = null;

  for (const role of runnable) {
    const definition = INVESTIGATION_ROLES[role];

    if (spent + definition.budgetCapUsd > cap) {
      runs.push({
        role,
        status: 'skipped',
        message: `Skipped: the run's own ceiling of $${cap.toFixed(2)} would be exceeded.`,
        costUsd: 0,
        investigationId: null,
        correction: null,
      });
      continue;
    }

    // Readiness is checked here rather than up front: a role whose dependency
    // completes earlier in this same loop becomes runnable within the run.
    if (!readyRoles(completed).includes(role)) {
      runs.push({
        role,
        status: 'skipped',
        message: `Skipped: ${INVESTIGATION_ROLES[role].dependsOn.join(', ')} did not complete.`,
        costUsd: 0,
        investigationId: null,
        correction: null,
      });
      continue;
    }

    const run = await runRole(deps, ctx, opportunity, role, briefing, options);
    runs.push(run);
    spent += run.costUsd;
    if (run.status === 'complete') completed.add(role);

    if (run.status !== 'complete') {
      blockedBy = run.status === 'blocked' ? run.message : blockedBy;
      // One role failing does not invalidate the others, but a blocked one
      // means the same wall will stop every remaining role in this run.
      if (run.status === 'blocked') break;
    }
  }

  const verdictSummary = await summariseFindings(deps.repos, ctx.workspaceId, opportunityId);
  const counterEvidence = await attachCounterEvidence(deps, ctx, opportunityId, verdictSummary.redTeam);

  const rejection = shouldReject({
    redTeamVerdict: verdictSummary.redTeam?.verdict ?? null,
    fatalObjectionCount: verdictSummary.fatalObjectionCount,
    willingnessToPay: verdictSummary.willingnessToPay,
    hasFreeAlternative: verdictSummary.freeAlternativeCount > 0,
    complaintCount: verdictSummary.complaintCount,
  });

  let recommendation: Recommendation = 'continue';
  let recommendationReason: string | null = null;

  if (rejection.reject) {
    recommendation = 'reject';
    recommendationReason = rejection.reason;
    await recommendRejection(deps, ctx, opportunity, rejection.reason ?? 'The evidence does not support this.');
  } else if (
    decision.stage === 'red_team' &&
    verdictSummary.redTeam &&
    (verdictSummary.redTeam.verdict === 'survivable' ||
      verdictSummary.redTeam.verdict === 'no_material_objection')
  ) {
    recommendation = 'promote';
    recommendationReason = verdictSummary.redTeam.verdictReason;
    await moveState(
      deps,
      ctx,
      opportunity,
      'candidate',
      `Survived the red team: ${verdictSummary.redTeam.verdictReason}`.slice(0, 2000),
    );
  }

  // Counter-evidence and resolved unknowns both change the score, so it is
  // recomputed here rather than waiting for the next nightly pass.
  if (runs.some((run) => run.status === 'complete')) {
    // No context is passed: the scoring input reads the competitor counts and
    // the recorded unknowns from the same stored rows this run just wrote, so
    // every caller computes the same score.
    await rescoreOpportunity(deps, ctx, opportunityId, {
      cause: counterEvidence > 0 ? 'counter_evidence' : 'new_evidence',
    });
  }

  return {
    ...base,
    proceeded: true,
    runs,
    costUsd: Number(spent.toFixed(6)),
    recommendation,
    recommendationReason,
    counterEvidenceAttached: counterEvidence,
    blockedBy,
  };
}

/**
 * Runs one role: assemble, call, project, persist.
 *
 * Nothing is written until the output has survived both schema validation and
 * projection. A run that fails leaves an investigation row explaining why,
 * which is the difference between a system that can be debugged and one that
 * merely stops.
 */
async function runRole(
  deps: InvestigationDeps,
  ctx: ActorCtx,
  opportunity: OpportunityRow,
  role: InvestigationRoleKey,
  briefing: EvidenceBriefing,
  options: InvestigateOptions,
): Promise<RoleRun> {
  const definition = INVESTIGATION_ROLES[role];
  const now = deps.clock.now();

  const investigation = await deps.repos.investigations.start(
    ctx.workspaceId,
    {
      subjectType: 'opportunity',
      subjectId: opportunity.id,
      roleKey: role,
      budgetCapUsd: definition.budgetCapUsd,
      jobId: options.jobId ?? null,
    },
    now,
  );

  const prior = await priorFindingBlocks(deps.repos, ctx.workspaceId, opportunity.id, definition.dependsOn);
  const resources = await availableResources(deps.repos, ctx.workspaceId);

  const prompt = assemblePrompt({
    template: definition.prompt,
    // Trusted variables are only ever things the system itself holds. No model
    // output is interpolated here; earlier conclusions go in as untrusted
    // blocks below, which is what stops one stage laundering fetched text into
    // the next stage's instructions.
    trustedVars: {
      title: opportunity.title,
      thesis: opportunity.thesis,
      customer: opportunity.targetCustomer ?? 'not yet established',
      problem: opportunity.problemStatement ?? opportunity.thesis,
      priorFindings:
        prior.length > 0
          ? `${prior.length} earlier stage(s) are included below with ids beginning "${NON_EVIDENCE_PREFIX}". They are conclusions, not evidence, and must not be cited.`
          : 'No earlier stage has run.',
      assumptions:
        prior.length > 0
          ? 'The recorded unknowns are included below.'
          : 'None have been recorded yet.',
      budget: resources.budget ?? 'unspecified',
      days: resources.days ?? 'unspecified',
    },
    untrusted: [...briefing.blocks, ...prior],
    nonce: deps.nonce(`${role}:${opportunity.id}`),
  });

  const outcome = await callAi(deps.gateway, {
    workspaceId: ctx.workspaceId,
    role: definition.aiRole,
    prompt,
    schema: definition.schema as SchemaDefinition<z.ZodTypeAny>,
    promptKey: definition.prompt.key,
    promptVersion: definition.prompt.version,
    // The red team is the one role that is never dropped when money is short:
    // skipping the attempt to kill an idea while continuing to research it is
    // the worst possible way to save money.
    optional: role !== 'red_team',
    subjectType: 'opportunity',
    subjectId: opportunity.id,
    jobId: options.jobId,
    runId: options.runId,
  });

  if (!outcome.ok) {
    const blocked = outcome.reason === 'not_configured' || outcome.reason === 'budget';
    await deps.repos.investigations.finish(
      investigation.id,
      {
        state: blocked ? 'blocked' : 'failed',
        terminationReason: sanitiseErrorMessage(outcome.message, 500),
        spentUsd: 0,
      },
      deps.clock.now(),
    );

    return {
      role,
      status: blocked ? 'blocked' : 'failed',
      message: outcome.message,
      costUsd: 0,
      investigationId: investigation.id,
      correction: null,
    };
  }

  const cleaned: unknown = stripNonEvidenceCitations(outcome.value);
  const persisted = await persistRole(deps, ctx, opportunity, role, cleaned, briefing, outcome.aiCallId);

  await deps.repos.investigations.saveOutput(investigation.id, {
    schemaKey: definition.schema.key,
    schemaVersion: definition.schema.version,
    payload: persisted.payload,
    promptKey: definition.prompt.key,
    promptVersion: definition.prompt.version,
    aiCallId: outcome.aiCallId,
    projectionReport: {
      ...persisted.report,
      summary: describeReport(persisted.report),
      evidenceShown: briefing.shown,
      evidenceAttached: briefing.totalAttached,
      injectionAttempts: outcome.injectionAttempts,
    },
  });

  await deps.repos.investigations.finish(
    investigation.id,
    { state: 'complete', terminationReason: definition.termination, spentUsd: outcome.costUsd },
    deps.clock.now(),
  );

  if (outcome.injectionAttempts.length > 0) {
    await deps.repos.alerts.raise(
      ctx.workspaceId,
      {
        kind: 'injection_attempt',
        severity: 'notable',
        subjectType: 'opportunity',
        subjectId: opportunity.id,
        title: 'Source content tried to give instructions',
        body: `While running the ${definition.name.toLowerCase()}, ${outcome.injectionAttempts.length} attempt(s) to instruct the model were found inside collected content. The instructions were ignored; the content is worth reviewing.`,
        action: 'Review the evidence attached to this opportunity.',
        dedupeKey: `injection:${opportunity.id}:${role}`,
      },
      deps.clock.now(),
    );
  }

  return {
    role,
    status: 'complete',
    message: definition.termination,
    costUsd: outcome.costUsd,
    investigationId: investigation.id,
    correction: describeReport(persisted.report),
  };
}

/** Projects one role's output and writes whatever tables it owns. */
async function persistRole(
  deps: InvestigationDeps,
  ctx: ActorCtx,
  opportunity: OpportunityRow,
  role: InvestigationRoleKey,
  raw: unknown,
  briefing: EvidenceBriefing,
  _aiCallId: string,
): Promise<{ payload: Record<string, unknown>; report: ProjectionReport }> {
  const ids = briefing.suppliedIds;

  switch (role) {
    case 'market': {
      const projected = projectMarket(raw as never, ids);
      return { payload: projected.value as unknown as Record<string, unknown>, report: projected.report };
    }
    case 'competitors': {
      const projected = projectCompetitors(raw as never, ids);
      return { payload: projected.value as unknown as Record<string, unknown>, report: projected.report };
    }
    case 'demand': {
      const projected = projectDemand(raw as never, ids);
      return { payload: projected.value as unknown as Record<string, unknown>, report: projected.report };
    }
    case 'red_team': {
      const projected = projectRedTeam(raw as never, ids);
      return { payload: projected.value as unknown as Record<string, unknown>, report: projected.report };
    }
    case 'uncertainty': {
      const projected = projectUncertainty(raw as never, ids);

      // Superseded rather than deleted: what we used to be unsure about is
      // part of the record of how a conclusion was reached.
      await deps.repos.uncertainty.replaceFor(
        ctx.workspaceId,
        opportunity.id,
        projected.value.items.map((item) => ({
          kind: item.kind,
          statement: item.statement,
          impact: item.impact,
          resolvability: item.resolvability,
          costToResolve: item.costToResolve,
          daysToResolve: item.daysToResolve,
          voiScore: item.voiScore,
        })),
      );

      return { payload: projected.value as unknown as Record<string, unknown>, report: projected.report };
    }
    case 'validation': {
      const resources = await availableResources(deps.repos, ctx.workspaceId);
      const projected = projectValidation(raw as never, {
        budget: typeof resources.budget === 'number' ? resources.budget : null,
        days: typeof resources.days === 'number' ? resources.days : null,
      });

      const riskiest = await matchRiskiestAssumption(
        deps.repos,
        ctx.workspaceId,
        opportunity.id,
        projected.value.riskiestAssumption,
      );

      await deps.repos.validation.savePlan(ctx.workspaceId, opportunity.id, {
        hypothesis: projected.value.hypothesis,
        whyItMatters: projected.value.whyItMatters,
        experimentType: projected.value.experimentType,
        audience: projected.value.audience,
        steps: projected.value.steps,
        estimatedCost: projected.value.estimatedCost,
        estimatedDays: projected.value.estimatedDays,
        successThreshold: projected.value.successThreshold,
        failureThreshold: projected.value.failureThreshold,
        evidenceToCollect: projected.value.evidenceToCollect,
        doNotBuildYet: projected.value.doNotBuildYet,
        riskiestAssumptionId: riskiest,
      });

      if (opportunity.state === 'candidate') {
        await moveState(
          deps,
          ctx,
          opportunity,
          'validation_ready',
          `An experiment has been designed: ${projected.value.hypothesis}`.slice(0, 2000),
        );
      }

      return { payload: projected.value as unknown as Record<string, unknown>, report: projected.report };
    }
  }
}

async function readCandidateState(
  deps: InvestigationDeps,
  workspaceId: string,
  opportunity: OpportunityRow,
  now: Date,
): Promise<CandidateState> {
  const input = await buildScoringInput(deps.repos, workspaceId, opportunity, now);
  const score = await deps.repos.scores.current(workspaceId, opportunity.id);
  const completedRoles = await deps.repos.investigations.completedRoles(
    workspaceId,
    'opportunity',
    opportunity.id,
  );

  const summary = await summariseFindings(deps.repos, workspaceId, opportunity.id);

  return {
    uniqueEvidenceCount: input.evidence.uniqueEvidence,
    independentSourceCount: input.evidence.independentSources,
    // Before anything has been scored there is nothing to gate on, so the
    // preliminary score is treated as zero rather than assumed promising.
    preliminaryScore: score?.attractiveness ?? 0,
    confidence: score?.confidence ?? 0,
    hasSpendingEvidence: input.market.observedMonthlySpend.length > 0,
    completedRoles,
    redTeamVerdict: summary.redTeam?.verdict ?? null,
  };
}

interface FindingsSummary {
  redTeam: ProjectedRedTeam | null;
  fatalObjectionCount: number;
  willingnessToPay: string | null;
  complaintCount: number;
  freeAlternativeCount: number;
  competitorCount: number | null;
  criticalUnknownCount: number;
  assumptionCount: number;
}

/** Reads back what the roles concluded, from what was stored rather than kept in memory. */
async function summariseFindings(
  repos: Repositories,
  workspaceId: string,
  opportunityId: string,
): Promise<FindingsSummary> {
  const outputs = await repos.investigations.outputsFor(workspaceId, 'opportunity', opportunityId);

  const latest = (schemaKey: string): Record<string, unknown> | null => {
    const matching = outputs.filter((output) => output.schemaKey === schemaKey);
    return matching.length > 0 ? (matching[matching.length - 1]!.payload ?? null) : null;
  };

  const redTeamPayload = latest('investigation.red_team');
  const redTeam = redTeamPayload ? (redTeamPayload as unknown as ProjectedRedTeam) : null;
  const demand = latest('investigation.demand');
  const competitors = latest('investigation.competitors');
  const uncertainty = latest('investigation.uncertainty');

  const objections = Array.isArray(redTeam?.objections) ? redTeam.objections : [];
  const items = Array.isArray((uncertainty as { items?: unknown })?.items)
    ? ((uncertainty as { items: Array<{ kind?: string }> }).items ?? [])
    : [];

  return {
    redTeam,
    fatalObjectionCount: objections.filter(
      (objection) => objection.severity === 'fatal' && !objection.unsupported,
    ).length,
    willingnessToPay: typeof demand?.willingnessToPay === 'string' ? demand.willingnessToPay : null,
    complaintCount: typeof demand?.unpaidComplaintCount === 'number' ? demand.unpaidComplaintCount : 0,
    freeAlternativeCount: Array.isArray(competitors?.freeAlternatives)
      ? competitors.freeAlternatives.length
      : 0,
    competitorCount: Array.isArray(competitors?.competitors) ? competitors.competitors.length : null,
    criticalUnknownCount: items.filter((item) => item.kind === 'critical_unknown').length,
    assumptionCount: items.filter((item) => item.kind === 'assumption').length,
  };
}

/**
 * Attaches the evidence the red team relied on as arguing against the thesis.
 *
 * This is what makes a rejection inspectable: the reason names specific
 * evidence rows that a person can read, rather than a model's summary of them.
 */
async function attachCounterEvidence(
  deps: InvestigationDeps,
  ctx: ActorCtx,
  opportunityId: string,
  redTeam: ProjectedRedTeam | null,
): Promise<number> {
  if (!redTeam) return 0;

  const ids = Array.isArray(redTeam.counterEvidenceIds) ? redTeam.counterEvidenceIds : [];
  if (ids.length === 0) return 0;

  const existing = await deps.repos.opportunities.evidenceFor(opportunityId);
  const alreadyAgainst = new Set(
    existing.filter((row) => row.stance === 'against').map((row) => row.evidenceUnitId),
  );

  let attached = 0;
  for (const evidenceUnitId of ids) {
    if (alreadyAgainst.has(evidenceUnitId)) continue;

    await deps.repos.opportunities.attachEvidence({
      opportunityId,
      evidenceUnitId,
      stance: 'against',
      note: 'Cited by the red team as arguing against this thesis.',
      addedBy: actorKind(ctx),
    });
    attached += 1;
  }

  return attached;
}

/**
 * Raises the recommendation rather than acting on it.
 *
 * Rejecting an opportunity is a decision that belongs to the owner. Radar's job
 * is to make the case as clearly as it can and then stop, which is also why the
 * opportunity moves back to watching rather than forward.
 */
async function recommendRejection(
  deps: InvestigationDeps,
  ctx: ActorCtx,
  opportunity: OpportunityRow,
  reason: string,
): Promise<void> {
  await deps.repos.alerts.raise(
    ctx.workspaceId,
    {
      kind: 'rejection_recommended',
      severity: 'notable',
      subjectType: 'opportunity',
      subjectId: opportunity.id,
      title: `Recommend rejecting: ${opportunity.title}`,
      body: reason,
      action: 'Review the counter-evidence and either reject it or say why it stands.',
      dedupeKey: `reject:${opportunity.id}`,
      demo: opportunity.demo,
    },
    deps.clock.now(),
  );

  if (opportunity.state === 'investigating' || opportunity.state === 'candidate') {
    await moveState(deps, ctx, opportunity, 'watching', `Recommended for rejection: ${reason}`.slice(0, 2000));
  }
}

async function recordRefusal(
  deps: InvestigationDeps,
  ctx: ActorCtx,
  opportunity: OpportunityRow,
  stage: DepthStage,
  reason: string,
  needed: string | null,
): Promise<void> {
  await deps.repos.investigations.start(
    ctx.workspaceId,
    { subjectType: 'opportunity', subjectId: opportunity.id, roleKey: `gate:${stage}`, budgetCapUsd: 0 },
    deps.clock.now(),
  ).then((row) =>
    deps.repos.investigations.finish(
      row.id,
      {
        state: 'terminated',
        terminationReason: needed ? `${reason} Needed: ${needed}` : reason,
        spentUsd: 0,
      },
      deps.clock.now(),
    ),
  );

  if (stage === 'watch' && opportunity.state === 'detected') {
    await moveState(deps, ctx, opportunity, 'watching', reason);
  }
}

/**
 * Moves the opportunity, quietly declining if the move is not legal.
 *
 * The state machine is the authority. An investigation that would like an
 * opportunity to be somewhere it cannot legally be simply does not move it,
 * rather than the runner acquiring its own opinion about the lifecycle.
 */
async function moveState(
  deps: InvestigationDeps,
  ctx: ActorCtx,
  opportunity: OpportunityRow,
  to: OpportunityRow['state'],
  reason: string,
): Promise<void> {
  if (!allowedTransitions(opportunity.state).includes(to)) return;

  const now = deps.clock.now();
  await deps.tx.transaction(async (repos) => {
    await repos.opportunities.setState(opportunity.id, to, now);
    await repos.opportunities.recordTransition({
      opportunityId: opportunity.id,
      fromState: opportunity.state,
      toState: to,
      reason,
      actorKind: actorKind(ctx),
      actorUserId: null,
      evidence: { source: 'investigation' },
    });
  });

  opportunity.state = to;
}

async function priorFindingBlocks(
  repos: Repositories,
  workspaceId: string,
  opportunityId: string,
  dependsOn: readonly InvestigationRoleKey[],
): Promise<UntrustedBlock[]> {
  if (dependsOn.length === 0) return [];

  const outputs = await repos.investigations.outputsFor(workspaceId, 'opportunity', opportunityId);
  const wanted = new Set(dependsOn.map((role) => INVESTIGATION_ROLES[role].schema.key));

  const byKey = new Map<string, Record<string, unknown>>();
  for (const output of outputs) {
    if (wanted.has(output.schemaKey)) byKey.set(output.schemaKey, output.payload);
  }

  return [...byKey.entries()].map(([schemaKey, payload]) =>
    untrustedBlock(
      `${NON_EVIDENCE_PREFIX}${schemaKey}`,
      JSON.stringify(payload).slice(0, 6_000),
      { origin: schemaKey, kind: 'ai_output' },
    ),
  );
}

async function availableResources(
  repos: Repositories,
  workspaceId: string,
): Promise<{ budget: number | string | null; days: number | string | null }> {
  const resources = await repos.graph.listResources(workspaceId);
  const budget = resources.find((resource) => resource.resourceKind === 'budget');
  const time = resources.find((resource) => resource.resourceKind === 'time');

  return {
    budget: budget ? Math.max(0, budget.amount - budget.committed) : null,
    days: time ? Math.max(0, time.amount - time.committed) : null,
  };
}

/** Links a plan to the specific unknown it tests, when one matches closely enough. */
async function matchRiskiestAssumption(
  repos: Repositories,
  workspaceId: string,
  opportunityId: string,
  statement: string,
): Promise<string | null> {
  const open = await repos.uncertainty.listFor(workspaceId, opportunityId, { openOnly: true });
  if (open.length === 0) return null;

  const target = normalise(statement);
  let best: { id: string; overlap: number } | null = null;

  for (const item of open) {
    const overlap = tokenOverlap(target, normalise(item.statement));
    if (!best || overlap > best.overlap) best = { id: item.id, overlap };
  }

  // Below this the "match" is coincidence, and a wrong link is worse than none:
  // it would claim the experiment tests something it does not.
  return best && best.overlap >= 0.4 ? best.id : null;
}

function normalise(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
}

function tokenOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / Math.min(a.size, b.size);
}
