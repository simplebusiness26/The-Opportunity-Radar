import { isOwnerFacingOpportunity } from '../opportunities/commercial-visibility';
import { describeConfidenceBand } from '../../domain/scoring/confidence';
import { ACTIVE_STATES } from '../../domain/state/opportunity-state';
import type { Repositories } from '../../ports/repositories/index';
import type { OpportunityRow, ScoreRow } from '../../ports/repositories/opportunities';

export interface BestMove {
  kind: 'act' | 'investigate' | 'no_action';
  opportunity: OpportunityRow | null;
  score: ScoreRow | null;
  headline: string;
  reasoning: string;
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

const ACT_CONFIDENCE = 0.5;
const ACT_SCORE = 60;

export async function buildDashboard(
  repos: Repositories,
  workspaceId: string,
  since: Date,
): Promise<DashboardView> {
  const allOpportunities = await repos.opportunities.list(workspaceId, { includeDemo: true, limit: 200 });
  const opportunities = allOpportunities.filter(isOwnerFacingOpportunity);
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
      .filter((delta) => titleById.has(delta.opportunityId) && Math.abs(delta.delta) >= 3)
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

function chooseBestMove(
  ranked: Array<{ opportunity: OpportunityRow; score: ScoreRow | null }>,
): BestMove {
  const scored = ranked.filter((entry) => entry.score !== null) as Array<{
    opportunity: OpportunityRow;
    score: ScoreRow;
  }>;

  if (scored.length === 0) {
    if (ranked.length > 0) {
      return {
        kind: 'no_action',
        opportunity: null,
        score: null,
        headline: 'Qualified opportunities found — Radar is not ready to pick one yet',
        reasoning:
          `Radar has ${ranked.length} commercially qualified ${ranked.length === 1 ? 'opportunity' : 'opportunities'}, but none has been scored yet. Open the cards below to see the actual problem, the commercial opening and the next validation step.`,
        doNotYet: ['Do not start building just because an opportunity has been detected.'],
      };
    }

    return {
      kind: 'no_action',
      opportunity: null,
      score: null,
      headline: 'No commercially qualified opportunity yet',
      reasoning:
        'Radar is still collecting signals and grouping genuine problems. Trends and product chatter stay out of this list until there is evidence of a real problem and a commercial mechanism.',
      doNotYet: ['Do not build without a clear problem and evidence that people care enough to change behaviour, spend money or use a workaround.'],
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
      headline: `Best thing to validate: ${best.opportunity.title}`,
      reasoning: `Radar scores this ${best.score.attractiveness}/100 with ${Math.round(best.score.confidence * 100)}% confidence. ${describeConfidenceBand(best.score.confidence).meaning}`,
      doNotYet: [
        'Do not build the full product yet.',
        'Do not add billing, integrations or extra complexity before the main uncertainty is settled.',
      ],
    };
  }

  const promising = scored.find((entry) => (entry.score.attractiveness ?? 0) >= ACT_SCORE);

  if (promising) {
    const gaps = (promising.score.gaps ?? []) as Array<{ label: string; reason: string }>;
    return {
      kind: 'investigate',
      opportunity: promising.opportunity,
      score: promising.score,
      headline: `Interesting, but prove this first: ${promising.opportunity.title}`,
      reasoning: `The opportunity scores ${promising.score.attractiveness}/100, but confidence is only ${Math.round(promising.score.confidence * 100)}%. ${
        gaps[0]?.reason ?? 'The evidence is not strong enough to act yet.'
      }`,
      doNotYet: ['Do not build yet. The useful next step is evidence, not code.'],
    };
  }

  return {
    kind: 'no_action',
    opportunity: null,
    score: null,
    headline: 'Nothing is strong enough to commit time to yet',
    reasoning: `${scored.length} ${scored.length === 1 ? 'qualified opportunity has' : 'qualified opportunities have'} been scored, but none is both attractive enough and proven enough. Keep watching rather than forcing a build.`,
    doNotYet: ['Do not start building just to stay busy.'],
  };
}
