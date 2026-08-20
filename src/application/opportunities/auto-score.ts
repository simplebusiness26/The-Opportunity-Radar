import type { ActorCtx } from '../../domain/types/identity';
import type { ScoringDeps } from './score-opportunity';
import { rescoreOpportunity } from './score-opportunity';

export interface AutoScoreResult {
  available: number;
  attempted: number;
  scored: number;
  failed: number;
  remaining: number;
}

/**
 * Scores a bounded slice of opportunities that Radar has framed but has never
 * scored. This is deliberately separate from clustering so a large evidence
 * pass cannot consume the same serverless request budget as scoring.
 *
 * First scores have no delta history, so `new_evidence` is only provenance for
 * the computation request. Existing scores are left alone; normal evidence and
 * capability events remain responsible for subsequent rescoring.
 */
export async function scoreUnscoredOpportunities(
  deps: ScoringDeps,
  ctx: ActorCtx,
  options: { limit?: number } = {},
): Promise<AutoScoreResult> {
  const limit = Math.min(Math.max(1, options.limit ?? 12), 25);
  const opportunities = await deps.repos.opportunities.list(ctx.workspaceId, {
    includeDemo: false,
    limit: 250,
  });

  const active = opportunities.filter(
    (opportunity) => !['rejected', 'archived'].includes(opportunity.state),
  );
  const current = await deps.repos.scores.currentForMany(
    ctx.workspaceId,
    active.map((opportunity) => opportunity.id),
  );

  const unscored = active
    .filter((opportunity) => !current.has(opportunity.id))
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.reference - b.reference,
    );
  const batch = unscored.slice(0, limit);

  let scored = 0;
  let failed = 0;

  for (const opportunity of batch) {
    try {
      await rescoreOpportunity(deps, ctx, opportunity.id, { cause: 'new_evidence' });
      scored += 1;
    } catch {
      // One malformed/temporarily unscorable item must not block the backlog.
      // The returned failure count keeps the problem observable to the caller.
      failed += 1;
    }
  }

  return {
    available: unscored.length,
    attempted: batch.length,
    scored,
    failed,
    remaining: Math.max(0, unscored.length - batch.length),
  };
}
