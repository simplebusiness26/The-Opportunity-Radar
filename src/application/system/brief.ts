import type { ActorCtx } from '../../domain/types/identity';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { BriefRow } from '../../ports/repositories/ops';

export interface BriefDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export interface BriefMetrics {
  signalsRecorded: number;
  uniqueEvidence: number;
  duplicatesFolded: number;
  clustersUpdated: number;
  opportunitiesStrengthened: number;
  opportunitiesWeakened: number;
  newCandidates: number;
}

export interface BriefChange {
  opportunityId: string;
  title: string;
  composite: string;
  from: number | null;
  to: number;
  delta: number;
  because: string;
}

/**
 * Writes the daily brief.
 *
 * This is not a news digest. It reports what changed in Radar's own beliefs and
 * why, and it is assembled entirely from `score_deltas` and the evidence
 * counters -- no model decides what mattered. The consequence is that the brief
 * is reproducible: the same day's data always produces the same brief, and every
 * line in it can be traced to a row.
 *
 * A quiet day produces a short brief that says so, rather than padding.
 */
export async function generateBrief(
  deps: BriefDeps,
  ctx: ActorCtx,
  options: { for?: Date } = {},
): Promise<BriefRow> {
  const now = options.for ?? deps.clock.now();
  const briefDate = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [deltas, stats, clusters, opportunities] = await Promise.all([
    deps.repos.scores.recentDeltas(ctx.workspaceId, since, 200),
    deps.repos.runStats.summary(ctx.workspaceId, since),
    deps.repos.clusters.list(ctx.workspaceId, { limit: 200 }),
    deps.repos.opportunities.list(ctx.workspaceId, { limit: 200 }),
  ]);

  const titles = new Map(opportunities.map((opportunity) => [opportunity.id, opportunity.title]));

  const attractiveness = deltas.filter(
    (delta) => delta.composite === 'attractiveness' && delta.toValue !== null,
  );

  const strengthened: BriefChange[] = [];
  const weakened: BriefChange[] = [];

  for (const delta of attractiveness) {
    const change: BriefChange = {
      opportunityId: delta.opportunityId,
      title: titles.get(delta.opportunityId) ?? 'Untitled opportunity',
      composite: delta.composite,
      from: delta.fromValue,
      to: delta.toValue!,
      delta: delta.delta,
      because: explainCause(delta.cause, delta.topDrivers),
    };
    if (delta.delta > 0) strengthened.push(change);
    else if (delta.delta < 0) weakened.push(change);
  }

  strengthened.sort((a, b) => b.delta - a.delta);
  weakened.sort((a, b) => a.delta - b.delta);

  const ingest = stats.find((entry) => entry.kind === 'ingest');
  const newCandidates = opportunities.filter(
    (opportunity) => opportunity.state === 'candidate' && opportunity.stateSince >= since,
  ).length;

  const metrics: BriefMetrics = {
    signalsRecorded: ingest?.itemsSeen ?? 0,
    uniqueEvidence: ingest?.itemsRetained ?? 0,
    duplicatesFolded: ingest?.duplicatesDropped ?? 0,
    clustersUpdated: clusters.filter((cluster) => cluster.lastEvidenceAt >= since).length,
    opportunitiesStrengthened: strengthened.length,
    opportunitiesWeakened: weakened.length,
    newCandidates,
  };

  const bestMove = await chooseBestMove(deps, ctx);

  return deps.repos.briefs.save(
    ctx.workspaceId,
    {
      briefDate,
      metrics: metrics as unknown as Record<string, unknown>,
      bestMove,
      sections: {
        strengthened: strengthened.slice(0, 5),
        weakened: weakened.slice(0, 5),
        quiet: strengthened.length === 0 && weakened.length === 0,
      },
    },
    now,
  );
}

function explainCause(
  cause: string,
  drivers: Array<{ key: string; label: string; delta: number }>,
): string {
  const named = drivers
    .slice(0, 2)
    .map((driver) => driver.label)
    .join(' and ');

  const reason: Record<string, string> = {
    new_evidence: 'new evidence arrived',
    counter_evidence: 'counter-evidence was recorded',
    decay: 'existing evidence aged',
    weight_change: 'the scoring weights changed',
    experiment_result: 'an experiment reported',
    capability_change: 'what we can build changed',
    manual: 'it was rescored by hand',
    engine_upgrade: 'the scoring engine changed',
  };

  const base = reason[cause] ?? 'inputs changed';
  return named ? `${base}, moving ${named}` : base;
}

/**
 * The single recommendation on the dashboard.
 *
 * Deliberately capable of returning nothing. An empty or weakly-evidenced
 * workspace should be told that no move is warranted, because inventing a
 * recommendation from thin evidence is precisely the failure this product
 * exists to avoid.
 */
async function chooseBestMove(
  deps: BriefDeps,
  ctx: ActorCtx,
): Promise<Record<string, unknown> | null> {
  const opportunities = await deps.repos.opportunities.list(ctx.workspaceId, { limit: 100 });
  if (opportunities.length === 0) return null;

  const scores = await deps.repos.scores.currentForMany(
    ctx.workspaceId,
    opportunities.map((opportunity) => opportunity.id),
  );

  let best: { id: string; title: string; score: number; confidence: number } | null = null;

  for (const opportunity of opportunities) {
    const score = scores.get(opportunity.id);
    if (!score) continue;
    if (['rejected', 'archived'].includes(opportunity.state)) continue;

    const attractiveness = score.attractiveness ?? 0;
    if (!best || attractiveness > best.score) {
      best = {
        id: opportunity.id,
        title: opportunity.title,
        score: attractiveness,
        confidence: score.confidence,
      };
    }
  }

  if (!best) return null;

  // A high score held with low confidence is not a reason to act -- it is a
  // reason to find evidence. Saying so is the honest recommendation.
  const actionable = best.confidence >= 0.5;

  return {
    opportunityId: best.id,
    title: best.title,
    score: Math.round(best.score),
    confidence: best.confidence,
    actionable,
    recommendation: actionable
      ? `Move ${best.title} forward.`
      : `Do not build ${best.title} yet. It scores ${Math.round(best.score)} but confidence is only ${Math.round(best.confidence * 100)}%. Reduce the uncertainty first.`,
  };
}
