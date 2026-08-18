'use client';

import { useState } from 'react';
import { Button, Callout } from '../ui/primitives';

/**
 * Downloading the brief, and committing the work.
 *
 * Downloading is always available: reading the document is how you decide.
 * Handing over is a decision that commits real resources, so it is restricted
 * to an owner, and overruling a "not ready" verdict is a second, explicit act
 * that gets recorded.
 */
export function HandoffActions({
  opportunityId,
  ready,
  canDecide,
  csrfToken,
}: {
  opportunityId: string;
  ready: boolean;
  canDecide: boolean;
  csrfToken: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remedy, setRemedy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  async function send(): Promise<void> {
    setPending(true);
    setError(null);
    setRemedy(null);

    const response = await fetch(`/api/v1/opportunities/${opportunityId}/handoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
      body: JSON.stringify({ acknowledgeNotReady: confirmed }),
    });

    if (response.ok) {
      const payload = (await response.json()) as { data?: { target: string | null } };
      setDone(
        payload.data?.target
          ? 'Handed over. Delivery runs on the next pass of the machine.'
          : 'Handed over. No delivery target is configured, so export the brief and send it yourself.',
      );
      setPending(false);
      return;
    }

    const payload = (await response.json()) as { error?: { message: string; remedy?: string } };
    setError(payload.error?.message ?? 'That did not work.');
    setRemedy(payload.error?.remedy ?? null);
    setPending(false);
  }

  return (
    <div className="space-y-3">
      {error ? <Callout tone="negative" title={error}>{remedy ?? 'Check and try again.'}</Callout> : null}
      {done ? <Callout tone="positive" title={done}>The brief is stored exactly as it was sent.</Callout> : null}

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={`/api/v1/opportunities/${opportunityId}/brief?format=markdown`}
          className="inline-flex items-center rounded-sm border border-line px-3 py-1.5 text-sm text-ink hover:border-ink-faint"
        >
          Download brief
        </a>

        {canDecide ? (
          <Button onClick={send} disabled={pending || (!ready && !confirmed)}>
            {pending ? 'Handing over…' : 'Hand over to be built'}
          </Button>
        ) : (
          <span className="text-xs text-ink-muted">
            Committing work to be built is an owner&rsquo;s decision.
          </span>
        )}
      </div>

      {!ready && canDecide ? (
        <label className="flex items-start gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            className="mt-0.5"
          />
          <span>
            Hand it over anyway. Radar says it is not ready; the overrule is recorded in the
            decision log against the reason it gave.
          </span>
        </label>
      ) : null}
    </div>
  );
}
