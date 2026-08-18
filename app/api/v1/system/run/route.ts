import { container } from '../../../../../src/composition/container';
import { errors } from '../../../../../src/domain/types/errors';
import { apiSuccess } from '../../../../../src/web/http/response';
import { writeRoute } from '../../../../../src/web/http/route';

export const dynamic = 'force-dynamic';

/**
 * Runs a piece of scheduled work now instead of waiting for it.
 *
 * Everything the machine does is on a schedule or debounced behind an event,
 * which is right in normal operation and unhelpful when someone is watching and
 * wants to see the effect of what they just did. This is the "run it now"
 * button, and it is restricted to work that is safe to trigger by hand: no job
 * here spends money, changes a decision, or touches a credential.
 *
 * Deliberately enqueued without a dedupe key. Asking twice runs it twice, which
 * is what an operator pressing a button expects, and every job in the list is
 * idempotent.
 */
const OPERATOR_RUNNABLE = new Set([
  'events.project',
  'triggers.evaluate',
  'cluster.assign',
  'sources.poll',
  'evidence.refresh_decay',
  'alerts.evaluate',
  'brief.generate',
  'jobs.reap',
]);

export const POST = writeRoute('jobs.operate', async ({ ctx, body }) => {
  const kind = String((body as { kind?: unknown }).kind ?? '');

  if (!OPERATOR_RUNNABLE.has(kind)) {
    throw errors.preconditionFailed(
      'jobs.not_runnable_by_hand',
      `"${kind}" cannot be run by hand.`,
      `Runnable now: ${[...OPERATOR_RUNNABLE].join(', ')}.`,
    );
  }

  const c = container();
  const job = await c.repos.jobs.enqueue(ctx.workspaceId, {
    kind,
    payload: { requestedByHand: true },
    priority: 9,
  });

  return apiSuccess({ queued: job !== null, jobId: job?.id ?? null, kind });
});
