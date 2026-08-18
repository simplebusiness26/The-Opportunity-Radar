import { z } from 'zod';
import { errors } from '../../domain/types/errors';
import type { ActorCtx } from '../../domain/types/identity';
import { sanitiseForStorage } from '../../domain/text/sanitise';
import type { ExecutionHistoryRow } from '../../ports/repositories/graph';
import type { HandoffDeps } from './handoff';

/**
 * What came back from whoever built it.
 *
 * This closes the loop. Without an outcome written back, every estimate Radar
 * makes is unfalsifiable, and an unfalsifiable estimate is a guess with a
 * number attached. It is deliberately a small, boring endpoint: the receiving
 * system should find it trivial to call, or it will not be called.
 *
 * The predicted figures are read from the stored score rather than accepted
 * from the caller. A builder reporting both the prediction and the outcome
 * could make the calibration say anything.
 */

export const feedbackInput = z.object({
  /** Either identifies the handoff directly, or by the ref the builder gave. */
  handoffId: z.string().uuid().optional(),
  externalRef: z.string().trim().max(200).optional(),
  status: z.enum(['acknowledged', 'in_progress', 'completed']).default('completed'),
  outcome: z
    .enum(['succeeded', 'profitable', 'shipped_and_used', 'shipped_unused', 'failed', 'abandoned', 'ongoing'])
    .optional(),
  actualBuildDays: z.number().min(0).max(3650).nullable().optional(),
  actualCost: z.number().min(0).max(10_000_000).nullable().optional(),
  actualRevenue: z.number().min(0).max(1_000_000_000).nullable().optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});

export type FeedbackInput = z.infer<typeof feedbackInput>;

export interface FeedbackResult {
  handoffId: string;
  status: string;
  /** Written only when an outcome was reported. */
  record: ExecutionHistoryRow | null;
  message: string;
}

export async function recordHandoffFeedback(
  deps: HandoffDeps,
  ctx: ActorCtx,
  input: FeedbackInput,
): Promise<FeedbackResult> {
  const parsed = feedbackInput.parse(input);

  if (!parsed.handoffId && !parsed.externalRef) {
    throw errors.preconditionFailed(
      'feedback.no_subject',
      'Feedback must name the handoff it concerns.',
      'Send either handoffId or externalRef.',
    );
  }

  const handoff = parsed.handoffId
    ? await deps.repos.handoffs.findById(ctx.workspaceId, parsed.handoffId)
    : await deps.repos.handoffs.findByExternalRef(ctx.workspaceId, parsed.externalRef!);

  if (!handoff) throw errors.notFound('Handoff');

  const now = deps.clock.now();
  const opportunity = await deps.repos.opportunities.findById(
    ctx.workspaceId,
    handoff.opportunityId,
  );

  const score = opportunity
    ? await deps.repos.scores.current(ctx.workspaceId, handoff.opportunityId)
    : null;

  // Read from the brief that was actually handed over, so the prediction being
  // judged is the one the builder was given.
  const briefInput = (handoff.brief as { input?: { buildDaysRange?: { low: number; high: number } | null } })
    .input;
  const predictedBuildDays = briefInput?.buildDaysRange
    ? (briefInput.buildDaysRange.low + briefInput.buildDaysRange.high) / 2
    : null;

  let record: ExecutionHistoryRow | null = null;

  await deps.tx.transaction(async (repos) => {
    if (parsed.status === 'acknowledged') await repos.handoffs.markAcknowledged(handoff.id, now);
    if (parsed.status === 'completed') await repos.handoffs.markCompleted(handoff.id, now);

    if (parsed.outcome) {
      record = await repos.executionHistory.record(ctx.workspaceId, {
        opportunityId: handoff.opportunityId,
        predictedBuildDays,
        actualBuildDays: parsed.actualBuildDays ?? null,
        predictedCost: null,
        actualCost: parsed.actualCost ?? null,
        predictedConfidence: score?.confidence ?? null,
        predictedScore: score?.attractiveness ?? null,
        actualRevenue: parsed.actualRevenue ?? null,
        outcome: parsed.outcome,
        reason: parsed.reason ? sanitiseForStorage(parsed.reason, { maxLength: 2000 }) : null,
        notes: parsed.notes ? sanitiseForStorage(parsed.notes, { maxLength: 4000 }) : null,
        source: 'factory_feedback',
        recordedByUserId: null,
      });

      await repos.events.append(ctx.workspaceId, {
        kind: 'execution.outcome_recorded',
        subjectType: 'opportunity',
        subjectId: handoff.opportunityId,
        payload: { opportunityId: handoff.opportunityId, outcome: parsed.outcome },
      });
    }

    await repos.audit.record(ctx, {
      action: 'handoff.feedback_received',
      entityType: 'handoff',
      entityId: handoff.id,
      after: { status: parsed.status, outcome: parsed.outcome ?? null },
    });
  });

  return {
    handoffId: handoff.id,
    status: parsed.status,
    record,
    message: parsed.outcome
      ? `Recorded. This outcome now counts toward how Radar calibrates its own estimates.`
      : 'Recorded.',
  };
}
