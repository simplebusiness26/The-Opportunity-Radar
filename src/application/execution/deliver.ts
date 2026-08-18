import { sanitiseErrorMessage } from '../../domain/text/sanitise';
import type { ActorCtx } from '../../domain/types/identity';
import type { HttpFetcher } from '../../ports/http';
import type { SecretBox } from '../../ports/secret-box';
import type { HandoffDeps } from './handoff';

/**
 * Delivering a handoff to wherever the owner pointed it.
 *
 * The request goes through the same fetcher as everything else, which means
 * the same URL, address and pinning checks: a configured target is not a
 * reason to relax them. A workspace with nothing configured is not an error —
 * the brief was exported, which is a complete outcome on its own.
 */

export interface DeliverDeps extends HandoffDeps {
  http: HttpFetcher;
  secretBox: SecretBox;
}

export interface DeliveryResult {
  status: 'delivered' | 'failed' | 'not_configured';
  message: string;
  externalRef: string | null;
}

export async function deliverHandoff(
  deps: DeliverDeps,
  ctx: ActorCtx,
  handoffId: string,
): Promise<DeliveryResult> {
  const handoff = await deps.repos.handoffs.findById(ctx.workspaceId, handoffId);
  if (!handoff) {
    return { status: 'failed', message: 'That handoff no longer exists.', externalRef: null };
  }

  if (!handoff.target) {
    return {
      status: 'not_configured',
      message: 'No delivery target is configured, so the brief was exported rather than sent.',
      externalRef: null,
    };
  }

  const workspace = await deps.repos.tenancy.findWorkspace(ctx.workspaceId);
  const factory = (workspace?.settings.factory ?? {}) as { secretId?: unknown };

  let token: string | null = null;
  if (typeof factory.secretId === 'string') {
    const sealed = await deps.repos.secrets.find(factory.secretId);
    // Opened here and held only for this call.
    if (sealed) token = deps.secretBox.open(sealed);
  }

  const now = deps.clock.now();
  await deps.repos.handoffs.markDelivering(handoff.id, now);

  const outcome = await deps.http.fetch({
    url: handoff.target,
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    json: {
      handoffId: handoff.id,
      opportunityId: handoff.opportunityId,
      brief: handoff.brief,
      briefMarkdown: handoff.briefMarkdown,
      // Told plainly where to send the outcome, because a loop nobody knows
      // how to close does not get closed.
      feedbackHint: 'POST the outcome to /api/v1/execution/feedback with this handoffId.',
    },
    reason: 'handoff delivery',
    timeoutMs: 20_000,
  });

  if (!outcome.ok) {
    const message = sanitiseErrorMessage(outcome.reason, 500);
    await deps.repos.handoffs.markFailed(handoff.id, message, deps.clock.now());
    return { status: 'failed', message, externalRef: null };
  }

  // A receiving system may return its own identifier; it is used to correlate
  // later feedback and is optional.
  const externalRef = readExternalRef(String(outcome.result.body));
  await deps.repos.handoffs.markDelivered(handoff.id, { externalRef }, deps.clock.now());

  return {
    status: 'delivered',
    message: `Delivered to ${new URL(handoff.target).host}.`,
    externalRef,
  };
}

function readExternalRef(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const ref = (parsed as Record<string, unknown>).externalRef ?? (parsed as Record<string, unknown>).id;
    return typeof ref === 'string' && ref.length > 0 && ref.length <= 200 ? ref : null;
  } catch {
    return null;
  }
}
