import { z } from 'zod';
import { computeCalibration, type CalibrationResult } from '../../domain/calibration/index';
import { errors } from '../../domain/types/errors';
import { actorUserId, type ActorCtx } from '../../domain/types/identity';
import { can } from '../../domain/types/permissions';
import type { Repositories } from '../../ports/repositories/index';
import type { ExecutionHistoryRow } from '../../ports/repositories/graph';
import type { MemoryDeps } from './triggers';

/**
 * What actually happened, recorded so the system can be held to its own
 * estimates.
 *
 * This is the closed loop. Without an outcome written back, every estimate the
 * product makes is unfalsifiable, and an unfalsifiable estimate is a guess with
 * a number attached.
 */

export const OUTCOMES = [
  'succeeded',
  'profitable',
  'shipped_and_used',
  'shipped_unused',
  'failed',
  'abandoned',
  'ongoing',
] as const;

export const recordOutcomeInput = z.object({
  opportunityId: z.string().uuid().nullable().optional(),
  outcome: z.enum(OUTCOMES),
  reason: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  predictedBuildDays: z.number().min(0).max(3650).nullable().optional(),
  actualBuildDays: z.number().min(0).max(3650).nullable().optional(),
  predictedCost: z.number().min(0).max(10_000_000).nullable().optional(),
  actualCost: z.number().min(0).max(10_000_000).nullable().optional(),
  actualRevenue: z.number().min(0).max(1_000_000_000).nullable().optional(),
  source: z.string().trim().max(60).optional(),
});

export type RecordOutcomeInput = z.infer<typeof recordOutcomeInput>;

/**
 * Records an outcome, capturing what Radar predicted at the time.
 *
 * The prediction is read from the stored score rather than supplied by the
 * caller. Letting the caller state what was predicted would make calibration
 * self-serving: the numbers would always look better than they were.
 */
export async function recordExecutionOutcome(
  deps: MemoryDeps,
  ctx: ActorCtx,
  input: RecordOutcomeInput,
): Promise<ExecutionHistoryRow> {
  if (!can(ctx, 'intelligence.write')) {
    throw errors.forbidden('intelligence.write_denied', 'Your role cannot record outcomes.');
  }
  const parsed = recordOutcomeInput.parse(input);

  let predictedConfidence: number | null = null;
  let predictedScore: number | null = null;

  if (parsed.opportunityId) {
    const opportunity = await deps.repos.opportunities.findById(ctx.workspaceId, parsed.opportunityId);
    if (!opportunity) throw errors.notFound('Opportunity');

    const score = await deps.repos.scores.current(ctx.workspaceId, parsed.opportunityId);
    predictedConfidence = score?.confidence ?? null;
    predictedScore = score?.attractiveness ?? null;
  }

  const row = await deps.repos.executionHistory.record(ctx.workspaceId, {
    opportunityId: parsed.opportunityId ?? null,
    predictedBuildDays: parsed.predictedBuildDays ?? null,
    actualBuildDays: parsed.actualBuildDays ?? null,
    predictedCost: parsed.predictedCost ?? null,
    actualCost: parsed.actualCost ?? null,
    predictedConfidence,
    predictedScore,
    actualRevenue: parsed.actualRevenue ?? null,
    outcome: parsed.outcome,
    reason: parsed.reason ?? null,
    notes: parsed.notes ?? null,
    source: parsed.source ?? 'manual',
    recordedByUserId: actorUserId(ctx),
  });

  await deps.repos.audit.record(ctx, {
    action: 'execution.outcome_recorded',
    entityType: 'opportunity',
    entityId: parsed.opportunityId ?? null,
    after: { outcome: parsed.outcome, actualBuildDays: parsed.actualBuildDays ?? null },
  });

  return row;
}

/**
 * The calibration, computed from history each time rather than cached.
 *
 * Cheap enough, and it removes any chance of the displayed calibration
 * disagreeing with the history it claims to summarise.
 */
export async function readCalibration(
  repos: Repositories,
  workspaceId: string,
): Promise<CalibrationResult> {
  const history = await repos.executionHistory.list(workspaceId, 500);
  return computeCalibration(history);
}
