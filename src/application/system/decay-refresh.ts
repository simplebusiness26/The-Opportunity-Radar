import { computeDecay, crossedThreshold } from '../../domain/decay/index';
import type { ActorCtx } from '../../domain/types/identity';
import type { Clock } from '../../ports/clock';
import type { Repositories, Transactor } from '../../ports/repositories/index';

export interface DecayDeps {
  repos: Repositories;
  tx: Transactor;
  clock: Clock;
}

export interface DecayRefreshResult {
  examined: number;
  updated: number;
  /** Units that crossed a freshness band, and so are worth recomputing around. */
  crossings: number;
  eventsEmitted: number;
}

/**
 * Reapplies time decay to stored evidence.
 *
 * Strength is materialised rather than computed on read so the dashboard stays
 * cheap. The important restraint is what this does *not* do: it emits an event
 * only when a piece of evidence crosses a freshness band, not merely because a
 * day passed. Without that, every score in the workspace would recompute every
 * night for no change anyone would notice.
 */
export async function refreshEvidenceStrength(
  deps: DecayDeps,
  ctx: ActorCtx,
  options: { limit?: number } = {},
): Promise<DecayRefreshResult> {
  const now = deps.clock.now();
  const units = await deps.repos.evidence.listClusterable(ctx.workspaceId, {
    limit: options.limit ?? 1000,
  });

  const result: DecayRefreshResult = { examined: units.length, updated: 0, crossings: 0, eventsEmitted: 0 };

  for (const unit of units) {
    const decayed = computeDecay({
      signalType: unit.signalTypeKey,
      evidenceClass: unit.evidenceClass,
      observedAt: unit.lastSeenAt,
      halfLifeDaysOverride: unit.halfLifeDaysOverride,
      supersededAt: unit.supersededAt,
      now,
    });

    // Floating point noise is not a change worth a write.
    if (Math.abs(decayed.effectiveStrength - unit.strength) < 0.001) continue;

    await deps.repos.evidence.updateStrength(unit.id, decayed.effectiveStrength, now);
    result.updated += 1;

    if (crossedThreshold(unit.strength, decayed.effectiveStrength)) {
      result.crossings += 1;
      await deps.repos.events.append(ctx.workspaceId, {
        kind: 'evidence.decayed',
        subjectType: 'evidence_unit',
        subjectId: unit.id,
        payload: {
          previousStrength: unit.strength,
          strength: decayed.effectiveStrength,
          evidenceClass: unit.evidenceClass,
        },
      });
      result.eventsEmitted += 1;
    }
  }

  return result;
}
