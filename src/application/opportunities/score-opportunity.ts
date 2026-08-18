import { diffScores, scoreOpportunity as runEngine, type ScoreResult } from '../../domain/scoring/engine';
import type { ScoringInput } from '../../domain/scoring/types';
import { errors } from '../../domain/types/errors';
import type { ActorCtx } from '../../domain/types/identity';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';
import type { ScoreRow } from '../../ports/repositories/opportunities';
import { buildScoringInput } from './build-scoring-input';

export interface ScoringDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export type ScoreCause =
  | 'new_evidence'
  | 'counter_evidence'
  | 'decay'
  | 'weight_change'
  | 'experiment_result'
  | 'capability_change'
  | 'manual'
  | 'engine_upgrade';

export interface RescoreResult {
  score: ScoreRow;
  result: ScoreResult;
  /** Absent on the first score, since there is nothing to compare against. */
  changed: boolean;
  deltas: ReturnType<typeof diffScores>;
}

/**
 * Recomputes an opportunity's scores and records what moved.
 *
 * Recomputation is idempotent: identical inputs produce an identical digest,
 * and a repeat run is skipped rather than writing a duplicate row. That is what
 * lets the event-driven pipeline fire freely without inflating history.
 */
export async function rescoreOpportunity(
  deps: ScoringDeps,
  ctx: ActorCtx,
  opportunityId: string,
  options: { cause: ScoreCause; context?: Parameters<typeof buildScoringInput>[4]; force?: boolean } = {
    cause: 'manual',
  },
): Promise<RescoreResult> {
  const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, opportunityId);
  if (!opportunity) throw errors.notFound('Opportunity');

  const now = deps.clock.now();
  const input = await buildScoringInput(
    deps.repos,
    ctx.workspaceId,
    opportunity,
    now,
    options.context,
  );

  const { profileId, weights } = await deps.repos.scores.activeWeights(ctx.workspaceId);
  const result = runEngine(input, weights);
  const previous = await deps.repos.scores.current(ctx.workspaceId, opportunityId);

  if (previous && previous.inputsDigest === result.inputsDigest && !options.force) {
    return { score: previous, result, changed: false, deltas: [] };
  }

  return deps.tx.transaction(async (repos) => {
    const saved = await repos.scores.save(ctx.workspaceId, opportunityId, {
      result,
      snapshot: input,
      profileId,
      computedAt: now,
    });

    let deltas: ReturnType<typeof diffScores> = [];
    if (previous) {
      deltas = diffScores(toScoreResult(previous), result);
      await repos.scores.recordDeltas(ctx.workspaceId, opportunityId, {
        fromScoreId: previous.id,
        toScoreId: saved.id,
        cause: options.cause,
        deltas: deltas.map((delta) => ({
          composite: delta.composite,
          from: delta.from,
          to: delta.to,
          delta: delta.delta,
          topDrivers: delta.topDrivers,
        })),
      });
    }

    return { score: saved, result, changed: true, deltas };
  });
}

/**
 * Rebuilds a stored score into the engine's own shape so two scores can be
 * compared. Only the fields diffing needs are reconstructed.
 */
function toScoreResult(row: ScoreRow): ScoreResult {
  const composite = (value: number | null) => ({
    key: 'attractiveness' as const,
    value,
    coverage: 1,
    dimensions: [],
    gaps: [],
  });

  return {
    engineVersion: row.engineVersion,
    inputsDigest: row.inputsDigest,
    composites: {
      attractiveness: { ...composite(row.attractiveness), key: 'attractiveness' },
      fit: { ...composite(row.fit), key: 'fit' },
      confidence: { ...composite(Math.round(row.confidence * 100)), key: 'confidence' },
      leverage: { ...composite(row.leverage), key: 'leverage' },
      timing: { ...composite(row.timing), key: 'timing' },
      validation_efficiency: { ...composite(row.validationEfficiency), key: 'validation_efficiency' },
      strategic_value: { ...composite(row.strategicValue), key: 'strategic_value' },
      execution_risk: { ...composite(row.executionRisk), key: 'execution_risk' },
    },
    confidence: {
      value: row.confidence,
      factors: [],
      cap: { applied: false, reason: null, ceiling: null },
      explanation: '',
    },
    confidenceBand: { label: '', meaning: '' },
    dimensions: (row.dimensions ?? []) as ScoreResult['dimensions'],
    gaps: (row.gaps ?? []) as ScoreResult['gaps'],
    headline: {
      attractiveness: row.attractiveness,
      fit: row.fit,
      confidence: row.confidence,
    },
  };
}

export type { ScoringInput };
