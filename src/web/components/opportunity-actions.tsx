'use client';

import { useState } from 'react';
import { OPPORTUNITY_STATES } from '../../domain/state/opportunity-state';
import { Button, Callout, Field, inputClass, Panel, PanelHeader } from '../ui/primitives';

/**
 * Moving an opportunity, and rescoring it.
 *
 * A reason is required for every state change, so the control asks for one
 * rather than letting the server refuse afterwards.
 */
export function OpportunityActions({
  opportunityId,
  state,
  allowed,
  csrfToken,
  canInvestigate,
}: {
  opportunityId: string;
  state: string;
  allowed: string[];
  csrfToken: string;
  /** False when no AI provider is connected; the control says so rather than failing. */
  canInvestigate: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remedy, setRemedy] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [queued, setQueued] = useState<string | null>(null);

  async function call(path: string, body?: unknown): Promise<boolean> {
    setError(null);
    setRemedy(null);
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
      body: JSON.stringify(body ?? {}),
    });
    if (!response.ok) {
      const payload = (await response.json()) as { error?: { message: string; remedy?: string } };
      setError(payload.error?.message ?? 'That did not work.');
      setRemedy(payload.error?.remedy ?? null);
      return false;
    }
    return true;
  }

  async function rescore() {
    setPending('score');
    if (await call(`/api/v1/opportunities/${opportunityId}/score`)) window.location.reload();
    setPending(null);
  }

  /**
   * Asks for an investigation rather than performing one.
   *
   * The work is queued and drained by the machine, so it obeys the same budget
   * and concurrency limits as everything else. The button reports what happened
   * to the request, not a result it cannot yet have.
   */
  async function investigate() {
    setPending('investigate');
    setQueued(null);
    const response = await fetch(`/api/v1/opportunities/${opportunityId}/investigation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
      body: JSON.stringify({}),
    });

    if (response.ok) {
      const payload = (await response.json()) as {
        data?: { queued: boolean; reason: string | null };
      };
      setQueued(
        payload.data?.queued
          ? 'Queued. It runs on the next pass of the machine, and the findings appear below.'
          : (payload.data?.reason ?? 'Nothing was queued.'),
      );
    } else {
      const payload = (await response.json()) as { error?: { message: string; remedy?: string } };
      setError(payload.error?.message ?? 'That did not work.');
      setRemedy(payload.error?.remedy ?? null);
    }
    setPending(null);
  }

  async function transition() {
    if (!target) return;
    setPending('transition');
    if (
      await call(`/api/v1/opportunities/${opportunityId}/transition`, { toState: target, reason })
    ) {
      window.location.reload();
    }
    setPending(null);
  }

  return (
    <Panel>
      <PanelHeader title="Actions" hint={OPPORTUNITY_STATES[state as keyof typeof OPPORTUNITY_STATES]?.meaning} />
      <div className="space-y-4 px-4 py-3">
        {error ? <Callout tone="negative" title={error}>{remedy ?? 'Check and try again.'}</Callout> : null}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={rescore} disabled={pending !== null}>
            {pending === 'score' ? 'Scoring…' : 'Recalculate score'}
          </Button>
          <Button
            variant="secondary"
            onClick={investigate}
            disabled={pending !== null || !canInvestigate}
          >
            {pending === 'investigate' ? 'Queueing…' : 'Investigate'}
          </Button>
        </div>

        {!canInvestigate ? (
          <p className="text-xs text-ink-muted">
            Investigation needs an AI provider. Everything else here works without one.
          </p>
        ) : null}
        {queued ? <p className="text-xs text-ink-muted">{queued}</p> : null}

        <div className="space-y-3 border-t border-line pt-3">
          <Field id="toState" label="Move to">
            <select
              id="toState"
              value={target ?? ''}
              onChange={(event) => setTarget(event.target.value || null)}
              className={inputClass}
            >
              <option value="">Choose a state…</option>
              {allowed.map((next) => (
                <option key={next} value={next}>
                  {OPPORTUNITY_STATES[next as keyof typeof OPPORTUNITY_STATES]?.label ?? next}
                </option>
              ))}
            </select>
          </Field>

          {target ? (
            <>
              <p className="text-xs leading-relaxed text-ink-muted">
                {OPPORTUNITY_STATES[target as keyof typeof OPPORTUNITY_STATES]?.meaning}
              </p>
              <Field
                id="reason"
                label="Why"
                hint="Recorded permanently. This is what makes the decision reviewable later."
              >
                <textarea
                  id="reason"
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <Button
                onClick={transition}
                disabled={pending !== null || reason.trim().length < 3}
                variant={target === 'rejected' ? 'danger' : 'primary'}
              >
                {pending === 'transition' ? 'Applying…' : 'Apply'}
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
