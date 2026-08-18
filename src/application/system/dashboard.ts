import { describeConfidenceBand } from '../../domain/scoring/confidence';
import { ACTIVE_STATES } from '../../domain/state/opportunity-state';
import type { Repositories } from '../../ports/repositories/index';
import type { OpportunityRow, ScoreRow } from '../../ports/repositories/opportunities';

/**
 * What the dashboard needs, computed deterministically.
 *
 * The headline recommendation is arithmetic over stored evidence, not a
 * generated sentence, so it says the same thing every time and can be checked
 * against the numbers it cites.
 */

export interface BestMove {
  kind: 'act' | 'investigate' | 'no_action';
  opportunity: OpportunityRow | null;
  score: ScoreRow | null;
  headline: string;
  reasoning: string;
  /** What Radar is specifically saying not to do yet. */
  doNotYet: string[];
}

export interface DashboardView {
  bestMove: BestMove;
  top: Array<{ opportunity: OpportunityRow; score: ScoreRow | null }>;
  changes: Array<{
    opportunityId: string;
    opportunityTitle: string;
    composite: string;
    delta: number;
    cause: string;
    at: Date;
  }>;
  counts: {
    signals: number;
    evidenceUnits: number;
    opportunities: number;
    active: number;
  };
}

/** Enough certainty to justify spending real money rather than more research. */
const ACT_CONFIDENCE = 0.5;
const ACT_SCORE = 60;

export async function buildDashboard(
  repos: Repositories,
  workspaceId: string,
  since: Date,
): Promise<DashboardView> {
  const opportunities = await repos.opportunities.list(workspaceId, { includeDemo: true, limit: 200 });
  const scores = await repos.scores.currentForMany(
    workspaceId,
    opportunities.map((row) => row.id),
  );

  const live = opportunities.filter(
    (row) => !['rejected', 'archived'].includes(row.state),
  );

  const ranked = live
    .map((opportunity) => ({ opportunity, score: scores.get(opportunity.id) ?? null }))
    .sort((a, b) => (b.score?.attractiveness ?? -1) - (a.score?.attractiveness ?? -1));

  const deltas = await repos.scores.recentDeltas(workspaceId, since, 20);
  const titleById = new Map(opportunities.map((row) => [row.id, row.title]));

  const [signalCount, evidenceCount] = await Promise.all([
    repos.signals.list(workspaceId, { limit: 1, includeDemo: true }).then((result) => result.total),
    Promise.resolve(0),
  ]);

  return {
    bestMove: chooseBestMove(ranked),
    top: ranked.slice(0, 5),
    changes: deltas
      // Composite movements only; confidence is reported alongside them.
      .filter((delta) => Math.abs(delta.delta) >= 3)
      .map((delta) => ({
        opportunityId: delta.opportunityId,
        opportunityTitle: titleById.get(delta.opportunityId) ?? 'Unknown',
        composite: delta.composite,
        delta: delta.delta,
        cause: delta.cause,
        at: delta.createdAt,
      })),
    counts: {
      signals: signalCount,
      evidenceUnits: evidenceCount,
      opportunities: opportunities.length,
      active: opportunities.filter((row) => ACTIVE_STATES.includes(row.state)).length,
    },
  };
}

/**
 * Choosing what to say.
 *
 * "Nothing warrants action" is a legitimate and useful answer, and the system
 * says it plainly rather than promoting the least-bad option to fill the space.
 */
function chooseBestMove(
  ranked: Array<{ opportunity: OpportunityRow; score: ScoreRow | null }>,
): BestMove {
  const scored = ranked.filter((entry) => entry.score !== null) as Array<{
    opportunity: OpportunityRow;
    score: ScoreRow;
  }>;

  if (scored.length === 0) {
    return {
      kind: 'no_action',
      opportunity: null,
      score: null,
      headline: 'NO HIGH-CONFIDENCE OPPORTUNITY CURRENTLY WARRANTS ACTION',
      reasoning:
        'Nothing has been scored yet. Record evidence and score an opportunity, and Radar will start ranking where effort should go.',
      doNotYet: ['Do not build anything on the strength of an unscored idea.'],
    };
  }

  const actionable = scored.filter(
    (entry) =>
      (entry.score.attractiveness ?? 0) >= ACT_SCORE && entry.score.confidence >= ACT_CONFIDENCE,
  );

  if (actionable.length > 0) {
    const best = actionable[0]!;
    return {
      kind: 'act',
      opportunity: best.opportunity,
      score: best.score,
      headline: `Validate: ${best.opportunity.title}`,
      reasoning: `Scores ${best.score.attractiveness} with ${Math.round(best.score.confidence * 100)}% confidence — ${describeConfidenceBand(best.score.confidence).meaning.toLowerCase()}`,
      doNotYet: [
        'Do not build the full product yet.',
        'Do not add billing, integrations or a second user role before the main uncertainty is settled.',
      ],
    };
  }

  // Something looks good but is not sufficiently evidenced. The honest move is
  // to reduce that uncertainty, not to start building on it.
  const promising = scored.find((entry) => (entry.score.attractiveness ?? 0) >= ACT_SCORE);

  if (promising) {
    const gaps = (promising.score.gaps ?? []) as Array<{ label: string; reason: string }>;
    return {
      kind: 'investigate',
      opportunity: promising.opportunity,
      score: promising.score,
      headline: `Reduce uncertainty on: ${promising.opportunity.title}`,
      reasoning: `This scores ${promising.score.attractiveness}, but confidence is only ${Math.round(promising.score.confidence * 100)}%. ${
        gaps[0]?.reason ?? 'The evidence does not yet support acting on it.'
      }`,
      doNotYet: ['Do not build. The cheapest useful next step is evidence, not code.'],
    };
  }

  return {
    kind: 'no_action',
    opportunity: null,
    score: null,
    headline: 'NO HIGH-CONFIDENCE OPPORTUNITY CURRENTLY WARRANTS ACTION',
    reasoning: `${scored.length} scored ${scored.length === 1 ? 'opportunity' : 'opportunities'}, none of which is both attractive and sufficiently evidenced. Continuing to watch is the correct move.`,
    doNotYet: ['Do not start building to feel productive.'],
  };
}
