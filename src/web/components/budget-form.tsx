'use client';

import { useState } from 'react';
import { Button, Callout, Field, inputClass, Panel, PanelHeader } from '../ui/primitives';

/**
 * Sets the monthly spend limit.
 *
 * Raising it is the only route past a hard stop, so the change is audited
 * specifically rather than as an ordinary settings edit.
 */
export function BudgetForm({
  csrfToken,
  current,
}: {
  csrfToken: string;
  current: number | null;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/settings/budget', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-radar-csrf': csrfToken },
        body: JSON.stringify({
          period: 'monthly',
          limitUsd: Number(form.get('limitUsd')),
          enabled: true,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: { message: string } };
        setError(payload.error?.message ?? 'That did not work.');
        return;
      }

      formElement.reset();
      window.location.reload();
    } catch {
      setError('Radar could not be reached.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel>
      <PanelHeader
        title="Monthly spend limit"
        hint="Radar stops rather than quietly exceeding this."
      />
      <form onSubmit={submit} className="space-y-4 px-4 py-4">
        {error ? <Callout tone="negative" title={error}>Check the amount and try again.</Callout> : null}

        <Field
          id="limitUsd"
          label="Limit in USD"
          hint={
            current === null
              ? 'No limit is set, so spend is not currently capped.'
              : `Currently $${current.toFixed(2)}.`
          }
        >
          <input
            id="limitUsd"
            name="limitUsd"
            type="number"
            step="1"
            min="0"
            required
            defaultValue={current ?? 30}
            className={inputClass}
          />
        </Field>

        <p className="text-xs text-ink-faint">
          As the limit approaches, Radar reduces scan depth, then suppresses low-value
          investigations, then switches to cheaper models, then runs only high-value decisions.
          At the limit it stops entirely — and holds the work rather than failing it, so it
          resumes next month. Manual mode is unaffected throughout.
        </p>

        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Set limit'}
        </Button>
      </form>
    </Panel>
  );
}
